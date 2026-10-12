import type { SourceFile } from "typescript/unstable/ast";
import {
  findNodeAtLocation,
  getContextKey,
  getDeclarationKey,
  isReactElementType,
} from "./utils/typescript.js";
import * as t from "typescript/unstable/ast/is";
import { SignatureKind, SymbolFlags, TypeFlags } from "typescript/unstable/sync";
import type { Checker, Type } from "typescript/unstable/sync";
import type { SourceLocation } from "../react-compiler/HIR/HIR.js";
import { GeneratedSource } from "../react-compiler/HIR/HIR.js";
import type {
  AbstractValue,
  Domain,
  PrimitiveTypeName,
  PrimitiveValue,
  Sample,
  SymbolicValue,
} from "./types.js";
import { forEachSymbolicValue } from "./utils/traverse.js";
import { EQUALITY_OPERATORS } from "./constraints.js";

const MAX_SAMPLE_ALTERNATIVES = 6;
const MAX_SAMPLE_DEPTH = 3;
const MAX_SAMPLE_FIELDS = 24;
const ELEMENT_TYPE_PATTERN = /^(?:React\.)?(?:ReactElement|JSX\.Element)(?:<.*>)?$/;
const PROMISE_TYPE_PATTERN = /^Promise</;
const SET_TYPE_NAMES = new Set(["Set", "ReadonlySet"]);
const MAP_TYPE_NAMES = new Set(["Map", "ReadonlyMap"]);
const CONTEXT_TYPE_PATTERN = /^(?:React\.)?Context</;
/** React's own escape hatch, which throws beside `children`, a prop sampled everywhere. */
const UNSAMPLED_FIELDS = new Set(["dangerouslySetInnerHTML"]);
/** A DOM node, which no plain value can stand in for, like a portal's container. */
const DOM_NODE_TYPE_PATTERN =
  /^(?:Node|Element|HTML\w*Element|SVG\w*Element|DocumentFragment|Document|ShadowRoot)$/;
const NODE_TYPE_PATTERN = /^(?:React\.)?(?:ReactNode|ReactChild|ReactPortal)$/;
const TEXT_SAMPLE: Sample = { kind: "Value", value: "text" };
const EMPTY_TEXT_SAMPLE: Sample = { kind: "Value", value: "" };
const SAMPLE_DATE = "2024-01-01T00:00:00.000Z";
const DATE_NAME_PATTERN = /(?:^date|^time|Date|Time|At|_at)$/;
const CURRENCY_NAME_PATTERN = /(?:^currency|Currency)(?:Code)?$/;
const LOCALE_NAME_PATTERN = /^(?:locale|lang|language)$|Locale$/;
const COLOR_NAME_PATTERN = /^(?:color|background)$|(?:Color|Background)$/;
const PURE_ARRAY_METHODS = new Set([
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
const PURE_STRING_METHODS = new Set([
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

/** A domain that may also be `undefined`, like a key an index signature may not have. */
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

/**
 * An object of the type's fields. One with more fields than are sampled, or past the depth
 * sampled, is open: a mount answers its other fields with a stand-in for any value.
 */
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

/**
 * Strings to mount with, which a name like `createdAt`, `currencyCode`, `locale` or
 * `primaryColor` says are a date, a currency code, a locale or a color that the component
 * parses, as `new Date("text")` would be invalid.
 */
export const getStringSamples = (name: string | null): Sample[] => {
  if (name !== null && DATE_NAME_PATTERN.test(name))
    return [{ kind: "Value", value: SAMPLE_DATE }, EMPTY_TEXT_SAMPLE];
  if (name !== null && CURRENCY_NAME_PATTERN.test(name))
    return [{ kind: "Value", value: "USD" }, EMPTY_TEXT_SAMPLE];
  if (name !== null && LOCALE_NAME_PATTERN.test(name))
    return [{ kind: "Value", value: "en" }, EMPTY_TEXT_SAMPLE];
  if (name !== null && COLOR_NAME_PATTERN.test(name))
    return [{ kind: "Value", value: "#808080" }, EMPTY_TEXT_SAMPLE];
  return [TEXT_SAMPLE, EMPTY_TEXT_SAMPLE];
};

/**
 * Concrete values a prop of this type can be mounted with: every case of a union, an empty
 * and a one-item array, and so on.
 */
const getSamples = (
  checker: Checker,
  type: Type | undefined,
  depth = 0,
  name: string | null = null,
): Sample[] => {
  if (!type || type.isErrorType() || type.flags & TypeFlags.AnyOrUnknown)
    return getStringSamples(name).slice(0, 1);
  const typeText = checker.typeToString(type);
  if (ELEMENT_TYPE_PATTERN.test(typeText)) return [{ kind: "Element" }];
  if (NODE_TYPE_PATTERN.test(typeText)) return [TEXT_SAMPLE];
  if (DOM_NODE_TYPE_PATTERN.test(typeText)) return [{ kind: "Undefined" }];
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
  if (typeText === "Date") return [{ kind: "Date", value: SAMPLE_DATE }];
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
  // By the type's own name, as an alias like `type SvgCache = Map<…>` prints as its alias.
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
  if (PROMISE_TYPE_PATTERN.test(typeText) && type.isTypeReference()) {
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

/**
 * Adds each string or number a prop is compared against in the render as a sample, so a
 * branch like `role === "admin"` runs when the component is mounted.
 */
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

/**
 * Looks up domains and samples for HIR locations through the type checker, caching by
 * location so each node is asked about once.
 */
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

  /**
   * Whether the value at this location is an optional property, like an `isOpen?: boolean`
   * prop, or a call's result, in a project without `strictNullChecks`, whose types leave out
   * the `undefined` an unset property or a `ShareTheme | undefined` return is.
   */
  #isOptionalRead(loc: SourceLocation): boolean {
    if (this.#isStrictNullChecks) return false;
    const node = findNodeAtLocation(this.#sourceFile, loc);
    if (!node) return false;
    if (t.isCallExpression(node)) return true;
    const element = t.isBindingElement(node)
      ? node
      : node.parent && t.isBindingElement(node.parent)
        ? node.parent
        : null;
    const objectNode = t.isPropertyAccessExpression(node) ? node.expression : element?.parent;
    const nameNode = t.isPropertyAccessExpression(node)
      ? node.name
      : (element?.propertyName ?? element?.name);
    if (!objectNode || !nameNode || !t.isIdentifier(nameNode)) return false;
    const objectType = this.#checker.getTypeAtLocation(objectNode);
    const property = objectType && this.#checker.getPropertyOfType(objectType, nameNode.text);
    return property !== undefined && (property.flags & SymbolFlags.Optional) !== 0;
  }

  /**
   * Whether the value at this location is destructured with a default, like `min = 0`,
   * whose type leaves out the `undefined` the default replaces.
   */
  #isDefaultedBinding(loc: SourceLocation): boolean {
    const node = findNodeAtLocation(this.#sourceFile, loc);
    if (!node) return false;
    const element = t.isBindingElement(node) ? node : node.parent;
    return (
      element !== undefined && t.isBindingElement(element) && element.initializer !== undefined
    );
  }

  /**
   * Whether the value at this location is read through an index signature, like
   * `envKeyMap["azure"]` of a `Record<string, Key>` or `items[0]` of an array, whose type
   * promises nothing about which keys exist.
   */
  #isIndexedRead(loc: SourceLocation): boolean {
    const node = findNodeAtLocation(this.#sourceFile, loc);
    if (!node || !(t.isElementAccessExpression(node) || t.isPropertyAccessExpression(node)))
      return false;
    const objectType = this.#checker.getTypeAtLocation(node.expression);
    if (!objectType || this.#checker.getIndexInfosOfType(objectType).length === 0) return false;
    const key = t.isPropertyAccessExpression(node)
      ? node.name.text
      : t.isStringLiteral(node.argumentExpression) || t.isNumericLiteral(node.argumentExpression)
        ? node.argumentExpression.text
        : null;
    return key === null || !this.#checker.getPropertyOfType(objectType, key);
  }

  /** Samples of the type at a location, of a value named `name`, like a prop's. */
  getSamples(loc: SourceLocation, name: string | null = null): Sample[] {
    return getSamples(this.#checker, this.#getType(loc), 0, name);
  }

  /**
   * Gives the name a declaration has in the source, before the compiler renames shadowed
   * names (`todo` rather than `todo_0`).
   */
  getSourceName(loc: SourceLocation): string | null {
    const node = findNodeAtLocation(this.#sourceFile, loc);
    return node && t.isIdentifier(node) ? node.text : null;
  }

  /** The source text at a location, with its whitespace collapsed. */
  getSourceText(loc: SourceLocation): string | null {
    return loc === GeneratedSource
      ? null
      : this.#sourceFile.text.slice(loc.start.index, loc.end.index).replace(/\s+/g, " ").trim();
  }

  /**
   * Gives the callee's source text for a call, like `checkAccess` for
   * `checkAccess({ allowedRoles })`.
   */
  getCalleeText(loc: SourceLocation): string | null {
    const node = findNodeAtLocation(this.#sourceFile, loc);
    return node && t.isCallExpression(node) ? node.expression.getText(this.#sourceFile) : null;
  }

  /**
   * Whether the source at this location is an expression a probe can wrap. Tests the
   * compiler generates, like the `=== undefined` check of a destructuring default, are not.
   */
  isExpression(loc: SourceLocation): boolean {
    const node = findNodeAtLocation(this.#sourceFile, loc);
    return node !== null && t.isExpression(node);
  }

  getDeclarationKey(loc: SourceLocation): string | null {
    const node = findNodeAtLocation(this.#sourceFile, loc);
    return node ? getDeclarationKey(this.#checker, node) : null;
  }

  getContextKey(loc: SourceLocation): string | null {
    const node = findNodeAtLocation(this.#sourceFile, loc);
    return node ? getContextKey(this.#checker, node) : null;
  }

  /**
   * Whether the method a callee names changes nothing when called, like an array's `find`
   * or a string's `replace`. A nullish receiver, as in `items?.find()`, never reaches it.
   */
  isPureMethod(calleeLoc: SourceLocation): boolean {
    const node = findNodeAtLocation(this.#sourceFile, calleeLoc);
    if (!node || !t.isPropertyAccessExpression(node)) return false;
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
          ? PURE_STRING_METHODS.has(method)
          : (this.#checker.isArrayType(member) || member.isTupleType()) &&
            PURE_ARRAY_METHODS.has(method),
      )
    );
  }

  /**
   * A sample of the fields the type at this location requires, like `name` and `render` of
   * the props a `<Controller {...props} />` passes on. Null when it requires none.
   */
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

  /** Whether the value at this location is a React context, like a JSX tag that provides one. */
  isContext(loc: SourceLocation): boolean {
    const type = this.#getType(loc);
    return type !== undefined && CONTEXT_TYPE_PATTERN.test(this.#checker.typeToString(type));
  }

  isReactElement(loc: SourceLocation): boolean {
    const type = this.#getType(loc);
    return type !== undefined && isReactElementType(type);
  }
}
