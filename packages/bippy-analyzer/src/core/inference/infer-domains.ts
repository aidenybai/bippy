import type { Node, SourceFile } from "typescript/unstable/ast";
import * as t from "typescript/unstable/ast/is";
import { SignatureKind, TypeFlags } from "typescript/unstable/sync";
import type { Checker, Type } from "typescript/unstable/sync";
import type { SourceLocation } from "../hir/hir.js";
import { GeneratedSource } from "../hir/hir.js";
import type { AbstractValue, Domain, PrimitiveTypeName, PrimitiveValue, Sample } from "./types.js";

const MAX_SAMPLE_ALTERNATIVES = 6;
const MAX_SAMPLE_DEPTH = 3;
const MAX_SAMPLE_FIELDS = 24;
const RENDERABLE_TYPE_PATTERN = /ReactNode|ReactElement|JSX\.Element|ReactChild|ReactPortal/;
const TEXT_SAMPLE: Sample = { kind: "Value", value: "text" };

/**
 * Finds the TypeScript node a HIR location was lowered from: the innermost node whose
 * range is exactly `[start, end)`.
 */
export const findNodeAtLocation = (sourceFile: SourceFile, loc: SourceLocation): Node | null => {
  if (loc === GeneratedSource) return null;
  let match: Node | null = null;
  const visit = (node: Node): void => {
    const start = node.getStart(sourceFile);
    const end = node.getEnd();
    if (start > loc.start || end < loc.end) return;
    if (start === loc.start && end === loc.end) match = node;
    node.forEachChild(visit);
  };
  sourceFile.forEachChild(visit);
  return match;
};

const getPrimitiveTypeName = (type: Type): PrimitiveTypeName | null => {
  if (type.flags & TypeFlags.StringLike) return "string";
  if (type.flags & TypeFlags.NumberLike) return "number";
  if (type.flags & TypeFlags.BigIntLike) return "bigint";
  if (type.flags & TypeFlags.BooleanLike) return "boolean";
  return null;
};

const getAbstractValue = (checker: Checker, type: Type): AbstractValue => {
  if (type.isStringLiteralType() || type.isNumberLiteralType())
    return { kind: "Literal", value: type.value };
  if (type.isBooleanLiteralType())
    return { kind: "Literal", value: checker.typeToString(type) === "true" };
  if (type.flags & TypeFlags.Null) return { kind: "Literal", value: null };
  if (type.flags & TypeFlags.Undefined) return { kind: "Literal", value: undefined };
  return { kind: "Type", text: checker.typeToString(type), primitive: getPrimitiveTypeName(type) };
};

export const getDomainOfType = (checker: Checker, type: Type | undefined): Domain => {
  if (!type || type.isErrorType()) return { kind: "Unknown", reason: "unresolved" };
  if (type.flags & TypeFlags.Any) return { kind: "Unknown", reason: "any" };
  if (type.flags & TypeFlags.Unknown) return { kind: "Unknown", reason: "unknown" };
  if (type.flags & TypeFlags.Never) return { kind: "Unknown", reason: "never" };
  if (type.isUnionType())
    return {
      kind: "Cases",
      cases: type.getTypes().map((member) => getAbstractValue(checker, member)),
      origin: "type",
    };
  if (type.isLiteralType() || type.flags & (TypeFlags.Null | TypeFlags.Undefined)) {
    return { kind: "Cases", cases: [getAbstractValue(checker, type)], origin: "type" };
  }
  return { kind: "Opaque", typeText: checker.typeToString(type) };
};

const getSampleKey = (sample: Sample): string => JSON.stringify(sample);

const dedupeSamples = (samples: Sample[]): Sample[] => [
  ...new Map(samples.map((sample) => [getSampleKey(sample), sample])).values(),
];

const getObjectSample = (checker: Checker, type: Type, depth: number): Sample => {
  if (depth >= MAX_SAMPLE_DEPTH) return { kind: "Object", fields: {} };
  const fields: Record<string, Sample> = {};
  for (const property of checker.getPropertiesOfType(type).slice(0, MAX_SAMPLE_FIELDS)) {
    const definedSample = getSamples(checker, checker.getTypeOfSymbol(property), depth + 1).find(
      (sample) => sample.kind !== "Undefined",
    );
    if (definedSample) fields[property.name] = definedSample;
  }
  return { kind: "Object", fields };
};

/**
 * Concrete values a prop of this type can be mounted with: every case of a union, an empty
 * and a one-item array, and so on.
 */
export const getSamples = (checker: Checker, type: Type | undefined, depth = 0): Sample[] => {
  if (!type || type.isErrorType() || type.flags & TypeFlags.AnyOrUnknown) return [TEXT_SAMPLE];
  if (RENDERABLE_TYPE_PATTERN.test(checker.typeToString(type))) return [TEXT_SAMPLE];
  if (type.isUnionType()) {
    return dedupeSamples(
      type.getTypes().flatMap((member) => getSamples(checker, member, depth)),
    ).slice(0, MAX_SAMPLE_ALTERNATIVES);
  }
  if (type.isStringLiteralType() || type.isNumberLiteralType())
    return [{ kind: "Value", value: type.value }];
  if (type.isBooleanLiteralType())
    return [{ kind: "Value", value: checker.typeToString(type) === "true" }];
  if (type.flags & TypeFlags.Null) return [{ kind: "Value", value: null }];
  if (type.flags & (TypeFlags.Undefined | TypeFlags.Void)) return [{ kind: "Undefined" }];
  if (type.flags & TypeFlags.StringLike) return [TEXT_SAMPLE, { kind: "Value", value: "" }];
  if (type.flags & (TypeFlags.NumberLike | TypeFlags.BigIntLike))
    return [
      { kind: "Value", value: 0 },
      { kind: "Value", value: 1 },
    ];
  if (type.flags & TypeFlags.BooleanLike)
    return [
      { kind: "Value", value: true },
      { kind: "Value", value: false },
    ];
  if (checker.getSignaturesOfType(type, SignatureKind.Call).length > 0)
    return [{ kind: "Function" }];
  if (checker.isArrayType(type) && type.isTypeReference()) {
    const [elementType] = checker.getTypeArguments(type);
    const [elementSample] =
      depth < MAX_SAMPLE_DEPTH ? getSamples(checker, elementType, depth + 1) : [];
    return elementSample
      ? [
          { kind: "Array", items: [] },
          { kind: "Array", items: [elementSample] },
        ]
      : [{ kind: "Array", items: [] }];
  }
  if (type.isTupleType() && type.isTypeReference()) {
    return [
      {
        kind: "Array",
        items: checker
          .getTypeArguments(type)
          .map((itemType) => getSamples(checker, itemType, depth + 1)[0] ?? TEXT_SAMPLE),
      },
    ];
  }
  if (type.flags & TypeFlags.Object) return [getObjectSample(checker, type, depth)];
  return [TEXT_SAMPLE];
};

export const getSampleOfValue = (value: PrimitiveValue): Sample =>
  value === undefined ? { kind: "Undefined" } : { kind: "Value", value };

/**
 * Looks up domains and samples for HIR locations through the type checker, caching by
 * location so each node is asked about once.
 */
export class DomainResolver {
  readonly #checker: Checker;
  readonly #sourceFile: SourceFile;
  readonly #types = new Map<string, Type | undefined>();

  constructor(checker: Checker, sourceFile: SourceFile) {
    this.#checker = checker;
    this.#sourceFile = sourceFile;
  }

  #getType(loc: SourceLocation): Type | undefined {
    if (loc === GeneratedSource) return undefined;
    const key = `${loc.start}:${loc.end}`;
    if (!this.#types.has(key)) {
      const node = findNodeAtLocation(this.#sourceFile, loc);
      this.#types.set(key, node ? this.#checker.getTypeAtLocation(node) : undefined);
    }
    return this.#types.get(key);
  }

  getDomain(loc: SourceLocation): Domain {
    return getDomainOfType(this.#checker, this.#getType(loc));
  }

  getSamples(loc: SourceLocation): Sample[] {
    return getSamples(this.#checker, this.#getType(loc));
  }

  /**
   * Gives the name a declaration has in the source, before the compiler renames shadowed
   * names (`todo` rather than `todo_0`).
   */
  getSourceName(loc: SourceLocation): string | null {
    const node = findNodeAtLocation(this.#sourceFile, loc);
    return node && t.isIdentifier(node) ? node.text : null;
  }

  /**
   * Whether the source at this location is an expression a probe can wrap. Tests the
   * compiler generates, like the `=== undefined` check of a destructuring default, are not.
   */
  isExpression(loc: SourceLocation): boolean {
    const node = findNodeAtLocation(this.#sourceFile, loc);
    return node !== null && t.isExpression(node);
  }

  getTypeText(loc: SourceLocation): string | null {
    const type = this.#getType(loc);
    return type ? this.#checker.typeToString(type) : null;
  }
}
