import type { Node, SourceFile } from "typescript/unstable/ast";
import { findNodeAtLocation } from "./utils/find-node-at-location";
import { getUnionMembers } from "./utils/get-union-members";
import { getCollectionName, getInterfaceMemberNames } from "./utils/lib-collections";
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
import { SymbolFlags, TypeFlags } from "typescript/unstable/sync";
import type { Checker, Type } from "typescript/unstable/sync";
import type { MutableCollection } from "../react-compiler/HIR/Environment";
import type { SourceLocation } from "../react-compiler/HIR/HIR";
import { getLocationKey } from "./utils/get-location-key";
import { GeneratedSource } from "../react-compiler/HIR/HIR";
import type { AbstractValue, Domain, Sample } from "./types";
import {
  UNDEFINED_CASE,
  getAbstractValue,
  getDomainOfType,
  getDomainWithUndefined,
} from "./domains";
import { getPropertySamples, getSamples } from "./type-samples";
import { getTypeAtLocation } from "./utils/get-type-at-location";

const CONTEXT_TYPE_PATTERN = /^Context$/;
export class SourceFileResolver {
  readonly #checker: Checker;
  readonly #sourceFile: SourceFile;
  readonly #typesByLocation = new Map<string, Type | undefined>();
  readonly #readonlyMethodsByCollection = new Map<MutableCollection, Set<string>>();
  readonly #isStrictNullChecks: boolean;

  constructor(checker: Checker, sourceFile: SourceFile, isStrictNullChecks: boolean) {
    this.#checker = checker;
    this.#sourceFile = sourceFile;
    this.#isStrictNullChecks = isStrictNullChecks;
  }

  get isStrictNullChecks(): boolean {
    return this.#isStrictNullChecks;
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
        node ? getTypeAtLocation(this.#checker, node) : undefined,
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

  getTypeDomain(loc: SourceLocation): Domain {
    return getDomainOfType(this.#checker, this.#getType(loc));
  }

  getDeclaredDomain(loc: SourceLocation): Domain | null {
    const node = this.#findNode(loc);
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
    const objectType = getTypeAtLocation(this.#checker, objectNode);
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
      bindingElement.initializer !== undefined &&
      bindingElement.initializer !== node
    );
  }

  #isIndexedRead(loc: SourceLocation): boolean {
    const node = this.#findNode(loc);
    if (!node || !(isElementAccessExpression(node) || isPropertyAccessExpression(node)))
      return false;
    const objectType = getTypeAtLocation(this.#checker, node.expression);
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
    const members = type?.isUnionType() ? getUnionMembers(type) : null;
    if (!members) return null;
    const unionMemberValues: AbstractValue[][] = [];
    for (const member of members) {
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
      const propertyMembers = getUnionMembers(propertyType);
      if (!propertyMembers) return null;
      unionMemberValues.push(
        propertyMembers.map((memberType) => getAbstractValue(this.#checker, memberType)),
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
    const receiverType = getTypeAtLocation(this.#checker, node.expression);
    if (!receiverType) return false;
    const definedMembers = (getUnionMembers(receiverType) ?? []).filter(
      (member) => !(member.flags & (TypeFlags.Null | TypeFlags.Undefined)),
    );
    return (
      definedMembers.length > 0 &&
      definedMembers.every(
        (member) =>
          Boolean(member.flags & TypeFlags.StringLike) ||
          this.#isReadonlyMethod(member, methodName),
      )
    );
  }

  #isReadonlyMethod(type: Type, methodName: string): boolean {
    const collection = getCollectionName(this.#checker, type);
    if (!collection) return false;
    const cachedMethods = this.#readonlyMethodsByCollection.get(collection);
    const readonlyMethods =
      cachedMethods ??
      new Set(getInterfaceMemberNames(this.#checker, this.#sourceFile, `Readonly${collection}`));
    this.#readonlyMethodsByCollection.set(collection, readonlyMethods);
    return readonlyMethods.has(methodName);
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
