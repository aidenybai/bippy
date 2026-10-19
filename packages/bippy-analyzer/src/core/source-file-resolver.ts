import type { Node, SourceFile } from "typescript/unstable/ast";
import { findNodeAtLocation } from "./utils/find-node-at-location";
import { getLiteralElements } from "./utils/get-literal-elements";
import { getUnionMembers } from "./utils/get-union-members";
import { getContextKey } from "./utils/get-context-key";
import { getDeclarationKey, getReactExportName, isReactType } from "./utils/typescript";
import { isReactElementType } from "./utils/is-react-element-type";
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
import { SymbolFlags, TypeFlags, TypePredicateKind } from "typescript/unstable/sync";
import type { Checker, Type } from "typescript/unstable/sync";
import type { SourceLocation } from "../react-compiler/HIR/HIR";
import { getLocationKey } from "./utils/get-location-key";
import { GeneratedSource } from "../react-compiler/HIR/HIR";
import type { AbstractValue, Domain, Sample } from "./types";

interface PredicateCases {
  parameterIndex: number;
  cases: AbstractValue[];
}
import {
  UNDEFINED_CASE,
  getAbstractValue,
  getDomainOfType,
  getDomainWithUndefined,
} from "./domains";
import { getPropertySamples, getSamples } from "./type-samples";

const CONTEXT_TYPE_PATTERN = /^Context$/;
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

export class SourceFileResolver {
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

  getLiteralElements(loc: SourceLocation): Array<string | number> | null {
    const node = this.#findNode(loc);
    return node ? getLiteralElements(this.#checker, node) : null;
  }

  getPredicateCases(loc: SourceLocation): PredicateCases | null {
    const node = this.#findNode(loc);
    if (!node || !isCallExpression(node)) return null;
    const signature = this.#checker.getResolvedSignature(node);
    const predicate = signature && this.#checker.getTypePredicateOfSignature(signature);
    if (predicate?.kind !== TypePredicateKind.Identifier || !predicate.type) return null;
    const domain = getDomainOfType(this.#checker, predicate.type);
    return domain.kind === "Cases" && domain.cases.every((value) => value.kind === "Literal")
      ? { parameterIndex: predicate.parameterIndex, cases: domain.cases }
      : null;
  }

  getDeclaredDomain(loc: SourceLocation): Domain | null {
    if (loc === GeneratedSource) return null;
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
      const [fieldSample] = getPropertySamples(this.#checker, property, 1);
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
