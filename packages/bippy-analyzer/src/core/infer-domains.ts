import type { Node, SourceFile } from "typescript/unstable/ast";
import {
  findNodeAtLocation,
  getUnionMembers,
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
import { getLocationKey } from "./utils/hir";
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
const UNDEFINED_CASE: AbstractValue = { kind: "Literal", value: undefined };
const MAX_SAMPLE_DEPTH = 3;
const MAX_SAMPLE_FIELDS = 24;
const ELEMENT_TYPE_PATTERN = /^(?:ReactElement|Element)$/;
const PROMISE_TYPE_PATTERN = /^Promise$/;
const DATE_TYPE_PATTERN = /^Date$/;
const SET_TYPE_NAMES = new Set(["Set", "ReadonlySet"]);
const MAP_TYPE_NAMES = new Set(["Map", "ReadonlyMap"]);
const CONTEXT_TYPE_PATTERN = /^Context$/;
const UNSAMPLED_FIELDS = new Set(["dangerouslySetInnerHTML"]);
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
  if (type.flags & TypeFlags.Undefined) return UNDEFINED_CASE;
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
  if (domain.kind === "Cases")
    return domain.cases.some((value) => value.kind === "Literal" && value.value === undefined)
      ? domain
      : { ...domain, cases: [...domain.cases, UNDEFINED_CASE] };
  if (domain.kind === "Opaque" && type)
    return {
      kind: "Cases",
      cases: [getAbstractValue(checker, type), UNDEFINED_CASE],
      origin: "type",
    };
  return domain;
};

const getSampleKey = (sample: Sample): string => JSON.stringify(sample);

export const dedupeSamples = (samples: Sample[]): Sample[] => [
  ...new Map(samples.map((sample) => [getSampleKey(sample), sample])).values(),
];

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

const getPrimitiveSamples = (
  checker: Checker,
  type: Type,
  name: string | null,
): Sample[] | null => {
  if (type.isStringLiteralType() || type.isNumberLiteralType())
    return [{ kind: "Value", value: type.value }];
  if (type.isBooleanLiteralType())
    return [{ kind: "Value", value: checker.typeToString(type) === "true" }];
  if (type.flags & TypeFlags.Null) return [{ kind: "Value", value: null }];
  if (type.flags & (TypeFlags.Undefined | TypeFlags.Void)) return [{ kind: "Undefined" }];
  if (type.flags & TypeFlags.StringLike) return getStringSamples(name);
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
  return null;
};

const getFirstSample = (
  checker: Checker,
  type: Type | undefined,
  depth: number,
): Sample | undefined =>
  depth < MAX_SAMPLE_DEPTH ? getSamples(checker, type, depth + 1)[0] : undefined;

const getCollectionSamples = (checker: Checker, type: Type, depth: number): Sample[] | null => {
  if (isLibraryType(type, DATE_TYPE_PATTERN)) return [{ kind: "Date", value: SAMPLE_DATE }];
  if (!type.isTypeReference()) return null;
  const typeArguments = checker.getTypeArguments(type);
  if (checker.isArrayType(type)) {
    const itemSample = getFirstSample(checker, typeArguments[0], depth);
    return itemSample
      ? [
          { kind: "Array", items: [] },
          { kind: "Array", items: [itemSample] },
        ]
      : [{ kind: "Array", items: [] }];
  }
  const symbolName = type.getSymbol()?.name;
  if (symbolName && SET_TYPE_NAMES.has(symbolName)) {
    const itemSample = getFirstSample(checker, typeArguments[0], depth);
    return [{ kind: "Set", items: itemSample ? [itemSample] : [] }];
  }
  if (symbolName && MAP_TYPE_NAMES.has(symbolName)) {
    const keySample = getFirstSample(checker, typeArguments[0], depth);
    const valueSample = getFirstSample(checker, typeArguments[1], depth);
    return [{ kind: "Map", entries: keySample && valueSample ? [[keySample, valueSample]] : [] }];
  }
  if (isLibraryType(type, PROMISE_TYPE_PATTERN)) {
    const resolvedSample = getFirstSample(checker, typeArguments[0], depth);
    return [{ kind: "Promise", value: resolvedSample ?? { kind: "Undefined" } }];
  }
  if (type.isTupleType())
    return [
      {
        kind: "Array",
        items: typeArguments.map(
          (itemType) => getSamples(checker, itemType, depth + 1)[0] ?? TEXT_SAMPLE,
        ),
      },
    ];
  return null;
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
    const memberSamples = dedupeSamples(
      type.getTypes().flatMap((member) => getSamples(checker, member, depth, name)),
    );
    return [
      ...memberSamples.filter((sample) => sample.kind !== "Undefined"),
      ...memberSamples.filter((sample) => sample.kind === "Undefined"),
    ].slice(0, MAX_SAMPLE_ALTERNATIVES);
  }
  const primitiveSamples = getPrimitiveSamples(checker, type, name);
  if (primitiveSamples) return primitiveSamples;
  const [signature] = checker.getSignaturesOfType(type, SignatureKind.Call);
  if (signature) {
    const returnSample = getFirstSample(
      checker,
      checker.getReturnTypeOfSignature(signature),
      depth,
    );
    return [{ kind: "Function", returns: returnSample ?? null }];
  }
  const collectionSamples = getCollectionSamples(checker, type, depth);
  if (collectionSamples) return collectionSamples;
  if (type.flags & (TypeFlags.Object | TypeFlags.Intersection))
    return [getObjectSample(checker, type, depth)];
  return [TEXT_SAMPLE];
};

export const getSampleOfValue = (value: PrimitiveValue): Sample =>
  value === undefined ? { kind: "Undefined" } : { kind: "Value", value };

export const addComparedSamples = (render: SymbolicValue): void => {
  forEachSymbolicValue(render, (value) => {
    if (value.kind !== "BinaryExpression" || !EQUALITY_OPERATORS.has(value.operator)) return;
    const [comparedValue, literal] =
      value.left.kind === "Binding" ? [value.left, value.right] : [value.right, value.left];
    if (comparedValue.kind !== "Binding" || literal.kind !== "Primitive") return;
    const { binding } = comparedValue;
    if (binding.kind !== "prop" || comparedValue.path.length > 0) return;
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
  readonly #typesByLocation = new Map<string, Type | undefined>();
  readonly #isStrictNullChecks: boolean;

  constructor(checker: Checker, sourceFile: SourceFile, isStrictNullChecks: boolean) {
    this.#checker = checker;
    this.#sourceFile = sourceFile;
    this.#isStrictNullChecks = isStrictNullChecks;
  }

  get fileName(): string {
    return this.#sourceFile.fileName;
  }

  #findNode(loc: SourceLocation): Node | null {
    return findNodeAtLocation(this.#sourceFile, loc);
  }

  #getType(loc: SourceLocation): Type | undefined {
    if (loc === GeneratedSource) return undefined;
    const locationKey = getLocationKey(loc);
    if (!this.#typesByLocation.has(locationKey)) {
      const node = this.#findNode(loc);
      this.#typesByLocation.set(
        locationKey,
        node ? this.#checker.getTypeAtLocation(node) : undefined,
      );
    }
    return this.#typesByLocation.get(locationKey);
  }

  getDomain(loc: SourceLocation): Domain {
    const type = this.#getType(loc);
    return this.#isIndexedRead(loc) || this.#isOptionalRead(loc) || this.#isDefaultedBinding(loc)
      ? getDomainWithUndefined(this.#checker, type)
      : getDomainOfType(this.#checker, type);
  }

  getDeclaredDomain(loc: SourceLocation): Domain | null {
    if (loc === GeneratedSource) return null;
    // HACK: Babel's identifier spans its type annotation, so fall back to the name alone.
    const nameLoc = loc.identifierName
      ? { ...loc, end: { ...loc.end, index: loc.start.index + loc.identifierName.length } }
      : loc;
    const node = this.#findNode(loc) ?? this.#findNode(nameLoc);
    const symbol = node && isIdentifier(node) ? this.#checker.getSymbolAtLocation(node) : undefined;
    return symbol ? getDomainOfType(this.#checker, this.#checker.getTypeOfSymbol(symbol)) : null;
  }

  #isOptionalRead(loc: SourceLocation): boolean {
    if (this.#isStrictNullChecks) return false;
    const node = this.#findNode(loc);
    if (!node) return false;
    if (isCallExpression(node)) return true;
    const bindingElement = isBindingElement(node)
      ? node
      : node.parent && isBindingElement(node.parent)
        ? node.parent
        : null;
    const objectNode = isPropertyAccessExpression(node) ? node.expression : bindingElement?.parent;
    const nameNode = isPropertyAccessExpression(node)
      ? node.name
      : (bindingElement?.propertyName ?? bindingElement?.name);
    if (!objectNode || !nameNode || !isIdentifier(nameNode)) return false;
    const objectType = this.#checker.getTypeAtLocation(objectNode);
    const property = objectType && this.#checker.getPropertyOfType(objectType, nameNode.text);
    return property !== undefined && (property.flags & SymbolFlags.Optional) !== 0;
  }

  #isDefaultedBinding(loc: SourceLocation): boolean {
    const node = this.#findNode(loc);
    if (!node) return false;
    const bindingElement = isBindingElement(node) ? node : node.parent;
    return (
      bindingElement !== undefined &&
      isBindingElement(bindingElement) &&
      bindingElement.initializer !== undefined
    );
  }

  #isIndexedRead(loc: SourceLocation): boolean {
    const node = this.#findNode(loc);
    if (!node || !(isElementAccessExpression(node) || isPropertyAccessExpression(node)))
      return false;
    const objectType = this.#checker.getTypeAtLocation(node.expression);
    if (!objectType || this.#checker.getIndexInfosOfType(objectType).length === 0) return false;
    const propertyName = isPropertyAccessExpression(node)
      ? node.name.text
      : isStringLiteral(node.argumentExpression) || isNumericLiteral(node.argumentExpression)
        ? node.argumentExpression.text
        : null;
    return propertyName === null || !this.#checker.getPropertyOfType(objectType, propertyName);
  }

  getUnionMemberValues(loc: SourceLocation, field: string): AbstractValue[][] | null {
    const type = this.#getType(loc);
    if (!type?.isUnionType()) return null;
    const unionMemberValues: AbstractValue[][] = [];
    for (const member of type.getTypes()) {
      if (member.flags & (TypeFlags.Null | TypeFlags.Undefined)) {
        unionMemberValues.push([UNDEFINED_CASE]);
        continue;
      }
      if (!(member.flags & (TypeFlags.Object | TypeFlags.Intersection))) return null;
      const property = this.#checker.getPropertyOfType(member, field);
      if (!property) {
        unionMemberValues.push([UNDEFINED_CASE]);
        continue;
      }
      const propertyType = this.#checker.getTypeOfSymbol(property);
      if (!propertyType) return null;
      unionMemberValues.push(
        getUnionMembers(propertyType).map((memberType) =>
          getAbstractValue(this.#checker, memberType),
        ),
      );
    }
    return unionMemberValues;
  }

  getSamples(loc: SourceLocation, name: string | null = null): Sample[] {
    return getSamples(this.#checker, this.#getType(loc), 0, name);
  }

  getSourceName(loc: SourceLocation): string | null {
    const node = this.#findNode(loc);
    return node && isIdentifier(node) ? node.text : null;
  }

  getSourceText(loc: SourceLocation): string | null {
    return loc === GeneratedSource
      ? null
      : this.#sourceFile.text.slice(loc.start.index, loc.end.index).replace(/\s+/g, " ").trim();
  }

  getReactExportName(loc: SourceLocation): string | null {
    const node = this.#findNode(loc);
    if (!node) return null;
    return getReactExportName(this.#checker, isCallExpression(node) ? node.expression : node);
  }

  getCalleeText(loc: SourceLocation): string | null {
    const node = this.#findNode(loc);
    return node && isCallExpression(node) ? node.expression.getText(this.#sourceFile) : null;
  }

  isExpression(loc: SourceLocation): boolean {
    const node = this.#findNode(loc);
    return node !== null && isExpression(node);
  }

  getDeclarationKey(loc: SourceLocation): string | null {
    const node = this.#findNode(loc);
    return node ? getDeclarationKey(this.#checker, node) : null;
  }

  getContextKey(loc: SourceLocation): string | null {
    const node = this.#findNode(loc);
    return node ? getContextKey(this.#checker, node) : null;
  }

  isNonMutatingMethod(calleeLoc: SourceLocation): boolean {
    const node = this.#findNode(calleeLoc);
    if (!node || !isPropertyAccessExpression(node)) return false;
    const methodName = node.name.text;
    const receiverType = this.#checker.getTypeAtLocation(node.expression);
    if (!receiverType) return false;
    const definedMembers = getUnionMembers(receiverType).filter(
      (member) => !(member.flags & (TypeFlags.Null | TypeFlags.Undefined)),
    );
    return (
      definedMembers.length > 0 &&
      definedMembers.every((member) =>
        member.flags & TypeFlags.StringLike
          ? NON_MUTATING_STRING_METHODS.has(methodName)
          : (this.#checker.isArrayType(member) || member.isTupleType()) &&
            NON_MUTATING_ARRAY_METHODS.has(methodName),
      )
    );
  }

  getRequiredSample(loc: SourceLocation): Sample | null {
    const type = this.#getType(loc);
    if (!type) return null;
    const fields: Record<string, Sample> = {};
    for (const property of this.#checker.getPropertiesOfType(type)) {
      if (property.flags & SymbolFlags.Optional) continue;
      const [fieldSample] = getSamples(
        this.#checker,
        this.#checker.getTypeOfSymbol(property),
        1,
        property.name,
      );
      if (fieldSample) fields[property.name] = fieldSample;
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
