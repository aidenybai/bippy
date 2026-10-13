import type { SourceFile } from "typescript/unstable/ast";
import {
  findNodeAtLocation,
  getContextKey,
  getDeclarationKey,
  getReactExportName,
  isLibraryType,
  isReactElementType,
  isReactType,
} from "./utils/typescript";
import {
  isBindingElement,
  isCallExpression,
  isElementAccessExpression,
  isExpression,
  isIdentifier,
  isNumericLiteral,
  isPropertyAccessExpression,
  isStringLiteral,
} from "typescript/unstable/ast/is";
import { SignatureKind, SymbolFlags, TypeFlags } from "typescript/unstable/sync";
import type { Checker, Type } from "typescript/unstable/sync";
import type { SourceLocation } from "../react-compiler/HIR/HIR";
import { GeneratedSource } from "../react-compiler/HIR/HIR";
import type {
  AbstractValue,
  Domain,
  PrimitiveTypeName,
  PrimitiveValue,
  Sample,
  SymbolicValue,
} from "./types";
import { forEachSymbolicValue } from "./utils/traverse";
import { SAMPLE_DATE, TEXT_SAMPLE, getStringSamples } from "./string-samples";
import { EQUALITY_OPERATORS } from "./constraints";

const MAX_SAMPLE_ALTERNATIVES = 6;
const MAX_SAMPLE_DEPTH = 3;
const MAX_SAMPLE_FIELDS = 24;
const ELEMENT_TYPE_PATTERN = /^(?:ReactElement|Element)$/;
const PROMISE_TYPE_PATTERN = /^Promise$/;
const DATE_TYPE_PATTERN = /^Date$/;
const SET_TYPE_NAMES = new Set(["Set", "ReadonlySet"]);
const MAP_TYPE_NAMES = new Set(["Map", "ReadonlyMap"]);
const CONTEXT_TYPE_PATTERN = /^Context$/;
// Throws beside `children`, which is sampled everywhere.
const UNSAMPLED_FIELDS = new Set(["dangerouslySetInnerHTML"]);
// No plain value can stand in for a DOM node.
const DOM_NODE_TYPE_PATTERN =
  /^(?:Node|Element|HTML\w*Element|SVG\w*Element|DocumentFragment|Document|ShadowRoot)$/;
const NODE_TYPE_PATTERN = /^(?:ReactNode|ReactChild|ReactPortal)$/;
const NON_MUTATING_ARRAY_METHODS = new Set([
  "at",
  "concat",
  "entries",
  "every",
  "filter",
  "find",
  "findIndex",
  "findLast",
  "findLastIndex",
  "flat",
  "flatMap",
  "forEach",
  "includes",
  "indexOf",
  "join",
  "keys",
  "lastIndexOf",
  "map",
  "reduce",
  "reduceRight",
  "slice",
  "some",
  "toReversed",
  "toSorted",
  "toSpliced",
  "values",
  "with",
]);
const NON_MUTATING_STRING_METHODS = new Set([
  "at",
  "charAt",
  "charCodeAt",
  "codePointAt",
  "concat",
  "endsWith",
  "includes",
  "indexOf",
  "lastIndexOf",
  "localeCompare",
  "match",
  "matchAll",
  "normalize",
  "padEnd",
  "padStart",
  "repeat",
  "replace",
  "replaceAll",
  "search",
  "slice",
  "split",
  "startsWith",
  "substring",
  "toLocaleLowerCase",
  "toLocaleUpperCase",
  "toLowerCase",
  "toUpperCase",
  "trim",
  "trimEnd",
  "trimStart",
]);

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

const getDomainOfType = (checker: Checker, type: Type | undefined): Domain => {
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

const getDomainWithUndefined = (checker: Checker, type: Type | undefined): Domain => {
  const domain = getDomainOfType(checker, type);
  const undefinedCase: AbstractValue = { kind: "Literal", value: undefined };
  if (domain.kind === "Cases")
    return domain.cases.some((value) => value.kind === "Literal" && value.value === undefined)
      ? domain
      : { ...domain, cases: [...domain.cases, undefinedCase] };
  if (domain.kind === "Opaque" && type)
    return {
      kind: "Cases",
      cases: [getAbstractValue(checker, type), undefinedCase],
      origin: "type",
    };
  return domain;
};

const getSampleKey = (sample: Sample): string => JSON.stringify(sample);

const dedupeSamples = (samples: Sample[]): Sample[] => [
  ...new Map(samples.map((sample) => [getSampleKey(sample), sample])).values(),
];

// Past the depth or field cap the object is open: a mount answers other fields with a stand-in.
const getObjectSample = (checker: Checker, type: Type, depth: number): Sample => {
  if (depth >= MAX_SAMPLE_DEPTH) return { kind: "Object", fields: {}, isOpen: true };
  const properties = checker
    .getPropertiesOfType(type)
    .filter((property) => !UNSAMPLED_FIELDS.has(property.name));
  const fields: Record<string, Sample> = {};
  for (const property of properties.slice(0, MAX_SAMPLE_FIELDS)) {
    const definedSample = getSamples(
      checker,
      checker.getTypeOfSymbol(property),
      depth + 1,
      property.name,
    ).find((sample) => sample.kind !== "Undefined");
    if (definedSample) fields[property.name] = definedSample;
  }
  return { kind: "Object", fields, isOpen: properties.length > MAX_SAMPLE_FIELDS };
};

const getSamples = (
  checker: Checker,
  type: Type | undefined,
  depth = 0,
  name: string | null = null,
): Sample[] => {
  if (!type || type.isErrorType() || type.flags & TypeFlags.AnyOrUnknown)
    return getStringSamples(name).slice(0, 1);
  if (isLibraryType(type, DOM_NODE_TYPE_PATTERN)) return [{ kind: "Undefined" }];
  if (isReactType(type, ELEMENT_TYPE_PATTERN)) return [{ kind: "Element" }];
  if (isReactType(type, NODE_TYPE_PATTERN)) return [TEXT_SAMPLE];
  if (type.isUnionType()) {
    const samples = dedupeSamples(
      type.getTypes().flatMap((member) => getSamples(checker, member, depth, name)),
    );
    return [
      ...samples.filter((sample) => sample.kind !== "Undefined"),
      ...samples.filter((sample) => sample.kind === "Undefined"),
    ].slice(0, MAX_SAMPLE_ALTERNATIVES);
  }
  if (type.isStringLiteralType() || type.isNumberLiteralType())
    return [{ kind: "Value", value: type.value }];
  if (type.isBooleanLiteralType())
    return [{ kind: "Value", value: checker.typeToString(type) === "true" }];
  if (type.flags & TypeFlags.Null) return [{ kind: "Value", value: null }];
  if (type.flags & (TypeFlags.Undefined | TypeFlags.Void)) return [{ kind: "Undefined" }];
  if (type.flags & TypeFlags.StringLike) return getStringSamples(name);
  if (isLibraryType(type, DATE_TYPE_PATTERN)) return [{ kind: "Date", value: SAMPLE_DATE }];
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
  const [signature] = checker.getSignaturesOfType(type, SignatureKind.Call);
  if (signature) {
    const [returns] =
      depth < MAX_SAMPLE_DEPTH
        ? getSamples(checker, checker.getReturnTypeOfSignature(signature), depth + 1)
        : [];
    return [{ kind: "Function", returns: returns ?? null }];
  }
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
  // Match by symbol name, since an alias like `type Cache = Map<…>` prints as the alias.
  const symbolName = type.getSymbol()?.name;
  if (symbolName && SET_TYPE_NAMES.has(symbolName) && type.isTypeReference()) {
    const [itemType] = checker.getTypeArguments(type);
    const [item] = depth < MAX_SAMPLE_DEPTH ? getSamples(checker, itemType, depth + 1) : [];
    return [{ kind: "Set", items: item ? [item] : [] }];
  }
  if (symbolName && MAP_TYPE_NAMES.has(symbolName) && type.isTypeReference()) {
    const [keyType, valueType] = checker.getTypeArguments(type);
    const [key] = depth < MAX_SAMPLE_DEPTH ? getSamples(checker, keyType, depth + 1) : [];
    const [value] = depth < MAX_SAMPLE_DEPTH ? getSamples(checker, valueType, depth + 1) : [];
    return [{ kind: "Map", entries: key && value ? [[key, value]] : [] }];
  }
  if (isLibraryType(type, PROMISE_TYPE_PATTERN) && type.isTypeReference()) {
    const [valueType] = checker.getTypeArguments(type);
    const [value] = depth < MAX_SAMPLE_DEPTH ? getSamples(checker, valueType, depth + 1) : [];
    return [{ kind: "Promise", value: value ?? { kind: "Undefined" } }];
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
  if (type.flags & (TypeFlags.Object | TypeFlags.Intersection))
    return [getObjectSample(checker, type, depth)];
  return [TEXT_SAMPLE];
};

export const getSampleOfValue = (value: PrimitiveValue): Sample =>
  value === undefined ? { kind: "Undefined" } : { kind: "Value", value };

/** Samples each literal a prop is compared to, so branches like `role === "admin"` run. */
export const addComparedSamples = (render: SymbolicValue): void => {
  forEachSymbolicValue(render, (value) => {
    if (value.kind !== "BinaryExpression" || !EQUALITY_OPERATORS.has(value.operator)) return;
    const [place, literal] =
      value.left.kind === "Binding" ? [value.left, value.right] : [value.right, value.left];
    if (place.kind !== "Binding" || literal.kind !== "Primitive") return;
    const { binding } = place;
    if (binding.kind !== "prop" || place.path.length > 0) return;
    if (typeof literal.value !== "string" && typeof literal.value !== "number") return;
    const hasSample = binding.samples.some(
      (sample) => sample.kind === "Value" && sample.value === literal.value,
    );
    if (!hasSample) binding.samples.push({ kind: "Value", value: literal.value });
  });
};

export class DomainResolver {
  readonly #checker: Checker;
  readonly #sourceFile: SourceFile;
  readonly #types = new Map<string, Type | undefined>();
  readonly #isStrictNullChecks: boolean;

  constructor(checker: Checker, sourceFile: SourceFile, isStrictNullChecks: boolean) {
    this.#checker = checker;
    this.#sourceFile = sourceFile;
    this.#isStrictNullChecks = isStrictNullChecks;
  }

  get fileName(): string {
    return this.#sourceFile.fileName;
  }

  #getType(loc: SourceLocation): Type | undefined {
    if (loc === GeneratedSource) return undefined;
    const key = `${loc.start.index}:${loc.end.index}`;
    if (!this.#types.has(key)) {
      const node = findNodeAtLocation(this.#sourceFile, loc);
      this.#types.set(key, node ? this.#checker.getTypeAtLocation(node) : undefined);
    }
    return this.#types.get(key);
  }

  getDomain(loc: SourceLocation): Domain {
    const type = this.#getType(loc);
    return this.#isIndexedRead(loc) || this.#isOptionalRead(loc) || this.#isDefaultedBinding(loc)
      ? getDomainWithUndefined(this.#checker, type)
      : getDomainOfType(this.#checker, type);
  }

  /** The type a variable is declared with, not the narrower one where it's read. */
  getDeclaredDomain(loc: SourceLocation): Domain | null {
    if (loc === GeneratedSource) return null;
    // Babel's identifier spans its type annotation, so fall back to the name alone.
    const nameLoc = loc.identifierName
      ? { ...loc, end: { ...loc.end, index: loc.start.index + loc.identifierName.length } }
      : loc;
    const node =
      findNodeAtLocation(this.#sourceFile, loc) ?? findNodeAtLocation(this.#sourceFile, nameLoc);
    const symbol = node && isIdentifier(node) ? this.#checker.getSymbolAtLocation(node) : undefined;
    return symbol ? getDomainOfType(this.#checker, this.#checker.getTypeOfSymbol(symbol)) : null;
  }

  // Without `strictNullChecks`, optional properties and call results omit `undefined`.
  #isOptionalRead(loc: SourceLocation): boolean {
    if (this.#isStrictNullChecks) return false;
    const node = findNodeAtLocation(this.#sourceFile, loc);
    if (!node) return false;
    if (isCallExpression(node)) return true;
    const element = isBindingElement(node)
      ? node
      : node.parent && isBindingElement(node.parent)
        ? node.parent
        : null;
    const objectNode = isPropertyAccessExpression(node) ? node.expression : element?.parent;
    const nameNode = isPropertyAccessExpression(node)
      ? node.name
      : (element?.propertyName ?? element?.name);
    if (!objectNode || !nameNode || !isIdentifier(nameNode)) return false;
    const objectType = this.#checker.getTypeAtLocation(objectNode);
    const property = objectType && this.#checker.getPropertyOfType(objectType, nameNode.text);
    return property !== undefined && (property.flags & SymbolFlags.Optional) !== 0;
  }

  // A destructuring default's type omits the `undefined` the default replaces.
  #isDefaultedBinding(loc: SourceLocation): boolean {
    const node = findNodeAtLocation(this.#sourceFile, loc);
    if (!node) return false;
    const element = isBindingElement(node) ? node : node.parent;
    return element !== undefined && isBindingElement(element) && element.initializer !== undefined;
  }

  // An index signature promises nothing about which keys exist.
  #isIndexedRead(loc: SourceLocation): boolean {
    const node = findNodeAtLocation(this.#sourceFile, loc);
    if (!node || !(isElementAccessExpression(node) || isPropertyAccessExpression(node)))
      return false;
    const objectType = this.#checker.getTypeAtLocation(node.expression);
    if (!objectType || this.#checker.getIndexInfosOfType(objectType).length === 0) return false;
    const key = isPropertyAccessExpression(node)
      ? node.name.text
      : isStringLiteral(node.argumentExpression) || isNumericLiteral(node.argumentExpression)
        ? node.argumentExpression.text
        : null;
    return key === null || !this.#checker.getPropertyOfType(objectType, key);
  }

  /** For each member of a union of objects, the values it gives a field, like a query's status. */
  getUnionMemberValues(loc: SourceLocation, field: string): AbstractValue[][] | null {
    const type = this.#getType(loc);
    if (!type?.isUnionType()) return null;
    const members = type.getTypes();
    const unionMemberValues: AbstractValue[][] = [];
    for (const member of members) {
      if (member.flags & (TypeFlags.Null | TypeFlags.Undefined)) {
        unionMemberValues.push([{ kind: "Literal", value: undefined }]);
        continue;
      }
      if (!(member.flags & (TypeFlags.Object | TypeFlags.Intersection))) return null;
      const property = this.#checker.getPropertyOfType(member, field);
      if (!property) {
        unionMemberValues.push([{ kind: "Literal", value: undefined }]);
        continue;
      }
      const propertyType = this.#checker.getTypeOfSymbol(property);
      if (!propertyType) return null;
      unionMemberValues.push(
        (propertyType.isUnionType() ? propertyType.getTypes() : [propertyType]).map((memberType) =>
          getAbstractValue(this.#checker, memberType),
        ),
      );
    }
    return unionMemberValues;
  }

  getSamples(loc: SourceLocation, name: string | null = null): Sample[] {
    return getSamples(this.#checker, this.#getType(loc), 0, name);
  }

  // The name before the compiler renames shadowed ones (`todo` rather than `todo_0`).
  getSourceName(loc: SourceLocation): string | null {
    const node = findNodeAtLocation(this.#sourceFile, loc);
    return node && isIdentifier(node) ? node.text : null;
  }

  getSourceText(loc: SourceLocation): string | null {
    return loc === GeneratedSource
      ? null
      : this.#sourceFile.text.slice(loc.start.index, loc.end.index).replace(/\s+/g, " ").trim();
  }

  getReactExportName(loc: SourceLocation): string | null {
    const node = findNodeAtLocation(this.#sourceFile, loc);
    if (!node) return null;
    return getReactExportName(this.#checker, isCallExpression(node) ? node.expression : node);
  }

  getCalleeText(loc: SourceLocation): string | null {
    const node = findNodeAtLocation(this.#sourceFile, loc);
    return node && isCallExpression(node) ? node.expression.getText(this.#sourceFile) : null;
  }

  // Compiler-generated tests, like a destructuring default's `=== undefined`, aren't wrappable.
  isExpression(loc: SourceLocation): boolean {
    const node = findNodeAtLocation(this.#sourceFile, loc);
    return node !== null && isExpression(node);
  }

  getDeclarationKey(loc: SourceLocation): string | null {
    const node = findNodeAtLocation(this.#sourceFile, loc);
    return node ? getDeclarationKey(this.#checker, node) : null;
  }

  getContextKey(loc: SourceLocation): string | null {
    const node = findNodeAtLocation(this.#sourceFile, loc);
    return node ? getContextKey(this.#checker, node) : null;
  }

  // Nullish members are skipped because `items?.find()` never calls on them.
  isNonMutatingMethod(calleeLoc: SourceLocation): boolean {
    const node = findNodeAtLocation(this.#sourceFile, calleeLoc);
    if (!node || !isPropertyAccessExpression(node)) return false;
    const method = node.name.text;
    const type = this.#checker.getTypeAtLocation(node.expression);
    if (!type) return false;
    const members = (type.isUnionType() ? type.getTypes() : [type]).filter(
      (member) => !(member.flags & (TypeFlags.Null | TypeFlags.Undefined)),
    );
    return (
      members.length > 0 &&
      members.every((member) =>
        member.flags & TypeFlags.StringLike
          ? NON_MUTATING_STRING_METHODS.has(method)
          : (this.#checker.isArrayType(member) || member.isTupleType()) &&
            NON_MUTATING_ARRAY_METHODS.has(method),
      )
    );
  }

  getRequiredSample(loc: SourceLocation): Sample | null {
    const type = this.#getType(loc);
    if (!type) return null;
    const fields: Record<string, Sample> = {};
    for (const property of this.#checker.getPropertiesOfType(type)) {
      if (property.flags & SymbolFlags.Optional) continue;
      const [sample] = getSamples(
        this.#checker,
        this.#checker.getTypeOfSymbol(property),
        1,
        property.name,
      );
      if (sample) fields[property.name] = sample;
    }
    return Object.keys(fields).length > 0 ? { kind: "Object", fields, isOpen: false } : null;
  }

  isContext(loc: SourceLocation): boolean {
    const type = this.#getType(loc);
    return type !== undefined && isReactType(type, CONTEXT_TYPE_PATTERN);
  }

  isReactElement(loc: SourceLocation): boolean {
    const type = this.#getType(loc);
    return type !== undefined && isReactElementType(type);
  }
}
