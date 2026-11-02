import { SyntaxKind } from "typescript/unstable/ast";
import type { Node, SourceFile } from "typescript/unstable/ast";
import {
  isBindingElement,
  isCallExpression,
  isElementAccessExpression,
  isExpression,
  isIdentifier,
  isImportClause,
  isImportSpecifier,
  isNumericLiteral,
  isPropertyAccessExpression,
  isStringLiteral,
} from "typescript/unstable/ast/is";
import { SymbolFlags, TypeFlags } from "typescript/unstable/sync";
import type { Symbol, Type } from "typescript/unstable/sync";
import type { MutableCollection } from "../../react-compiler/HIR/Environment";
import type { SourceLocation } from "../../react-compiler/HIR/HIR";
import { GeneratedSource } from "../../react-compiler/HIR/HIR";
import { createDeclarationKey } from "../project/declaration-key";
import type { AbstractValue, Domain, Sample } from "../types";
import {
  UNDEFINED_CASE,
  getAbstractValue,
  getDomainOfType,
  getDomainWithUndefined,
} from "./domains";
import { getSamples } from "./type-samples";
import { isReactSymbol, isReactType } from "./type-table";
import type { TypeTable } from "./type-table";

const NO_ROW = -1;
const DEFERRED_KINDS = new Set([
  SyntaxKind.ArrowFunction,
  SyntaxKind.FunctionExpression,
  SyntaxKind.JsxElement,
  SyntaxKind.JsxFragment,
  SyntaxKind.JsxSelfClosingElement,
  SyntaxKind.JsxText,
]);
const LOADED_TYPE = 1;
const LOADED_SYMBOL = 1 << 1;

const REACT_ELEMENT_TYPE_PATTERN = /^(?:ReactElement|ReactPortal|ReactNode|Element)$/;
const CONTEXT_TYPE_PATTERN = /^(Context|Provider|ProviderExoticComponent)$/;

export class SourceFileResolver {
  readonly types: TypeTable;
  readonly #sourceFile: SourceFile;
  readonly #isStrictNullChecks: boolean;
  readonly #nodes: Node[] = [];
  readonly #parentRows: number[] = [];
  readonly #subtreeEnds: number[] = [];
  readonly #rangeStarts: Int32Array;
  readonly #rangeEnds: Int32Array;
  readonly #rangeRows: Int32Array;
  readonly #rowFlags: Uint8Array;
  readonly #rowTypes: (Type | undefined)[] = [];
  readonly #rowSymbols: (Symbol | undefined)[] = [];
  readonly #rowTargets: (Symbol | undefined)[] = [];
  readonly #rangeDomains: (Domain | undefined)[] = [];
  readonly #generatedDomain: Domain;

  constructor(types: TypeTable, sourceFile: SourceFile, isStrictNullChecks: boolean) {
    this.types = types;
    this.#sourceFile = sourceFile;
    this.#isStrictNullChecks = isStrictNullChecks;
    const starts: number[] = [];
    const ends: number[] = [];
    const rows: number[] = [];
    const importRows: number[] = [];
    const visit = (node: Node, parentRow: number): void => {
      const row = this.#nodes.length;
      this.#nodes.push(node);
      this.#parentRows.push(parentRow);
      this.#subtreeEnds.push(row + 1);
      starts.push(node.getStart(sourceFile));
      ends.push(node.getEnd());
      rows.push(row);
      if (isBindingElement(node) && node.propertyName && node.name && node.initializer) {
        starts.push(node.name.getStart(sourceFile));
        ends.push(node.getEnd());
        rows.push(row);
      }
      const parent = this.#nodes[parentRow];
      if (isIdentifier(node) && parent && (isImportSpecifier(parent) || isImportClause(parent)))
        importRows.push(row);
      node.forEachChild((child) => visit(child, row));
      this.#subtreeEnds[row] = this.#nodes.length;
    };
    sourceFile.forEachChild((child) => visit(child, NO_ROW));
    const order = [...starts.keys()].sort(
      (left, right) => starts[left]! - starts[right]! || ends[left]! - ends[right]! || left - right,
    );
    this.#rangeStarts = Int32Array.from(order, (entry) => starts[entry]!);
    this.#rangeEnds = Int32Array.from(order, (entry) => ends[entry]!);
    this.#rangeRows = Int32Array.from(order, (entry) => rows[entry]!);
    this.#rowFlags = new Uint8Array(this.#nodes.length);
    for (const row of importRows) this.#rowFlags[row]! |= LOADED_SYMBOL;
    this.#loadSymbols(importRows);
    this.#generatedDomain = getDomainOfType(types, undefined);
  }

  get isStrictNullChecks(): boolean {
    return this.#isStrictNullChecks;
  }

  get fileName(): string {
    return this.#sourceFile.fileName;
  }

  get path(): string {
    return this.#sourceFile.path;
  }

  load(locations: readonly SourceLocation[]): void {
    this.#loadEntries(
      locations
        .map((location) => this.#findEntry(location))
        .filter((entry) => entry === NO_ROW || !DEFERRED_KINDS.has(this.#getEntryKind(entry))),
    );
  }

  #loadEntries(entries: readonly number[]): void {
    this.#loadRows(entries.map((entry) => this.#getEntryRow(entry)));
    for (const entry of entries) {
      if (entry === NO_ROW || this.#rangeDomains[entry]) continue;
      const row = this.#rangeRows[entry]!;
      const type = this.#rowTypes[row];
      this.#rangeDomains[entry] =
        this.#isIndexedRead(row) || this.#isOptionalRead(row) || this.#isDefaultedBinding(row)
          ? getDomainWithUndefined(this.types, type)
          : getDomainOfType(this.types, type);
    }
  }

  #loadRows(locationRows: readonly number[]): void {
    const typeRows: number[] = [];
    const symbolRows: number[] = [];
    const queue = (rows: number[], row: number, flag: number): void => {
      if (row === NO_ROW || this.#rowFlags[row]! & flag) return;
      this.#rowFlags[row]! |= flag;
      rows.push(row);
    };
    for (const row of locationRows) {
      if (row === NO_ROW) continue;
      const node = this.#nodes[row]!;
      const bindingRow = this.#getBindingRow(row);
      queue(typeRows, row, LOADED_TYPE);
      if (isPropertyAccessExpression(node) || isElementAccessExpression(node))
        queue(typeRows, row + 1, LOADED_TYPE);
      if (bindingRow !== NO_ROW) queue(typeRows, this.#parentRows[bindingRow]!, LOADED_TYPE);
      queue(symbolRows, this.#getNameRow(row), LOADED_SYMBOL);
      if (isCallExpression(node) || isPropertyAccessExpression(node))
        queue(symbolRows, this.#getNameRow(row + 1), LOADED_SYMBOL);
    }
    this.types.getTypesAtNodes(typeRows.map((row) => this.#nodes[row]!)).forEach((type, index) => {
      this.#rowTypes[typeRows[index]!] = type;
    });
    this.#loadSymbols(symbolRows);
  }

  #loadSymbols(rows: readonly number[]): void {
    if (rows.length === 0) return;
    const checker = this.types.checker;
    const targets = new Map<Symbol, Symbol>();
    checker.getSymbolAtLocation(rows.map((row) => this.#nodes[row]!)).forEach((symbol, index) => {
      const row = rows[index]!;
      this.#rowSymbols[row] = symbol;
      if (!symbol || !(symbol.flags & SymbolFlags.Alias)) {
        this.#rowTargets[row] = symbol;
        return;
      }
      const target = targets.get(symbol) ?? checker.getAliasedSymbol(symbol);
      targets.set(symbol, target);
      this.#rowTargets[row] = target;
    });
  }

  #findRangeEntry(start: number, end: number): number {
    let low = 0;
    let high = this.#rangeStarts.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      const middleStart = this.#rangeStarts[middle]!;
      if (middleStart < start || (middleStart === start && this.#rangeEnds[middle]! <= end))
        low = middle + 1;
      else high = middle;
    }
    const entry = low - 1;
    return entry >= 0 && this.#rangeStarts[entry] === start && this.#rangeEnds[entry] === end
      ? entry
      : NO_ROW;
  }

  #findEntry(loc: SourceLocation): number {
    if (loc === GeneratedSource) return NO_ROW;
    const entry = this.#findRangeEntry(loc.start.index, loc.end.index);
    return entry !== NO_ROW || !loc.identifierName
      ? entry
      : this.#findRangeEntry(loc.start.index, loc.start.index + loc.identifierName.length);
  }

  #getEntryRow(entry: number): number {
    return entry === NO_ROW ? NO_ROW : this.#rangeRows[entry]!;
  }

  #getEntryKind(entry: number): SyntaxKind {
    return this.#nodes[this.#rangeRows[entry]!]!.kind;
  }

  #findRow(loc: SourceLocation): number {
    return this.#getEntryRow(this.#findEntry(loc));
  }

  #getBindingRow(row: number): number {
    if (isBindingElement(this.#nodes[row]!)) return row;
    const parentRow = this.#parentRows[row]!;
    return parentRow !== NO_ROW && isBindingElement(this.#nodes[parentRow]!) ? parentRow : NO_ROW;
  }

  #getNameRow(row: number): number {
    const nameRow = isPropertyAccessExpression(this.#nodes[row]!)
      ? this.#subtreeEnds[row]! - 1
      : row;
    return isIdentifier(this.#nodes[nameRow]!) ? nameRow : NO_ROW;
  }

  #getType(row: number): Type | undefined {
    if (row === NO_ROW) return undefined;
    if (!(this.#rowFlags[row]! & LOADED_TYPE)) this.#loadRows([row]);
    return this.#rowTypes[row];
  }

  #getSymbol(row: number, symbols: (Symbol | undefined)[]): Symbol | undefined {
    if (row === NO_ROW) return undefined;
    if (!(this.#rowFlags[row]! & LOADED_SYMBOL)) this.#loadRows([row]);
    return symbols[row];
  }

  #getTarget(row: number): Symbol | undefined {
    return this.#getSymbol(row, this.#rowTargets);
  }

  getType(loc: SourceLocation): Type | undefined {
    return this.#getType(this.#findRow(loc));
  }

  #getPropertyOf(type: Type | undefined, name: string): Symbol | undefined {
    return type && this.types.checker.getPropertyOfType(type, name);
  }

  #isIndexedRead(row: number): boolean {
    const node = this.#nodes[row]!;
    if (!(isElementAccessExpression(node) || isPropertyAccessExpression(node))) return false;
    const objectType = this.#getType(row + 1);
    if (!objectType || !this.types.hasIndexInfos(objectType)) return false;
    const propertyName = isPropertyAccessExpression(node)
      ? node.name.text
      : isStringLiteral(node.argumentExpression) || isNumericLiteral(node.argumentExpression)
        ? node.argumentExpression.text
        : null;
    return propertyName === null || !this.#getPropertyOf(objectType, propertyName);
  }

  #isOptionalRead(row: number): boolean {
    if (this.#isStrictNullChecks) return false;
    const node = this.#nodes[row]!;
    if (isCallExpression(node)) return true;
    const bindingRow = this.#getBindingRow(row);
    const bindingElement = this.#nodes[bindingRow];
    const objectRow = isPropertyAccessExpression(node)
      ? row + 1
      : bindingRow === NO_ROW
        ? NO_ROW
        : this.#parentRows[bindingRow]!;
    const nameNode = isPropertyAccessExpression(node)
      ? node.name
      : bindingElement && isBindingElement(bindingElement)
        ? (bindingElement.propertyName ?? bindingElement.name)
        : undefined;
    if (objectRow === NO_ROW || !nameNode || !isIdentifier(nameNode)) return false;
    const property = this.#getPropertyOf(this.#getType(objectRow), nameNode.text);
    return property !== undefined && (property.flags & SymbolFlags.Optional) !== 0;
  }

  #isDefaultedBinding(row: number): boolean {
    const node = this.#nodes[row];
    if (!node) return false;
    const bindingElement = isBindingElement(node) ? node : node.parent;
    return (
      bindingElement !== undefined &&
      isBindingElement(bindingElement) &&
      bindingElement.initializer !== undefined &&
      bindingElement.initializer !== node
    );
  }

  getDomain(loc: SourceLocation): Domain {
    if (loc === GeneratedSource) return this.#generatedDomain;
    const entry = this.#findEntry(loc);
    if (entry === NO_ROW) return getDomainOfType(this.types, undefined);
    if (!this.#rangeDomains[entry]) this.#loadEntries([entry]);
    return this.#rangeDomains[entry]!;
  }

  getTupleElementDomain(loc: SourceLocation, index: number): Domain | null {
    const type = this.getType(loc);
    if (!type?.isTypeReference() || !this.types.isTupleType(type)) return null;
    const element = this.types.getTypeArguments(type)[index];
    return element ? getDomainOfType(this.types, element) : null;
  }

  getTypeDomain(loc: SourceLocation): Domain {
    return getDomainOfType(this.types, this.getType(loc));
  }

  getDeclaredDomain(loc: SourceLocation): Domain | null {
    const row = this.#findRow(loc);
    const node = this.#nodes[row];
    if (!node || !isIdentifier(node)) return null;
    const symbol = this.#getSymbol(row, this.#rowSymbols);
    return symbol ? getDomainOfType(this.types, this.types.getTypesOfSymbols([symbol])[0]) : null;
  }

  getPropertyDomains(loc: SourceLocation): Array<[string, Domain]> | null {
    const type = this.getType(loc);
    if (
      !type ||
      !(type.flags & TypeFlags.Object) ||
      this.types.hasIndexInfos(type) ||
      this.types.getCallSignatures(type).length > 0
    )
      return null;
    const properties = this.types.checker.getPropertiesOfType(type);
    const propertyTypes = this.types.getTypesOfSymbols(properties);
    return properties.map((property, index) => [
      property.name,
      getDomainOfType(this.types, propertyTypes[index]),
    ]);
  }

  getRequiredPropertyNames(loc: SourceLocation): string[] | null {
    const type = this.getType(loc);
    if (!type || !(type.flags & TypeFlags.Object) || this.types.hasIndexInfos(type)) return null;
    const properties = this.types.checker.getPropertiesOfType(type);
    return properties.some((property) => property.flags & SymbolFlags.Optional)
      ? null
      : properties.map((property) => property.name);
  }

  getUnionMemberValues(loc: SourceLocation, field: string): AbstractValue[][] | null {
    const type = this.getType(loc);
    const members = type?.isUnionType() ? this.types.getUnionMembers(type) : null;
    if (!members) return null;
    const unionMemberValues: AbstractValue[][] = [];
    for (const member of members) {
      if (member.flags & (TypeFlags.Null | TypeFlags.Undefined)) {
        unionMemberValues.push([UNDEFINED_CASE]);
        continue;
      }
      if (!(member.flags & (TypeFlags.Object | TypeFlags.Intersection))) return null;
      const property = this.#getPropertyOf(member, field);
      if (!property) {
        unionMemberValues.push([UNDEFINED_CASE]);
        continue;
      }
      const [propertyType] = this.types.getTypesOfSymbols([property]);
      const propertyMembers = propertyType && this.types.getUnionMembers(propertyType);
      if (!propertyMembers) return null;
      unionMemberValues.push(
        propertyMembers.map((memberType) => getAbstractValue(this.types, memberType)),
      );
    }
    return unionMemberValues;
  }

  getSamples(loc: SourceLocation, name: string | null = null): Sample[] {
    return getSamples(this.types, this.getType(loc), 0, name);
  }

  getSourceName(loc: SourceLocation): string | null {
    const node = this.#nodes[this.#findRow(loc)];
    return node && isIdentifier(node) ? node.text : null;
  }

  getSourceText(loc: SourceLocation): string | null {
    return loc === GeneratedSource
      ? null
      : this.#sourceFile.text.slice(loc.start.index, loc.end.index).replace(/\s+/g, " ").trim();
  }

  getReactExportName(loc: SourceLocation): string | null {
    const row = this.#findRow(loc);
    const node = this.#nodes[row];
    if (!node) return null;
    const symbol = this.#getTarget(this.#getNameRow(isCallExpression(node) ? row + 1 : row));
    return symbol && isReactSymbol(symbol) ? symbol.name : null;
  }

  getCalleeText(loc: SourceLocation): string | null {
    const node = this.#nodes[this.#findRow(loc)];
    return node && isCallExpression(node) ? node.expression.getText(this.#sourceFile) : null;
  }

  isExpression(loc: SourceLocation): boolean {
    const node = this.#nodes[this.#findRow(loc)];
    return node !== undefined && isExpression(node);
  }

  #getDeclarationKey(row: number): string | null {
    const symbol = this.#getTarget(this.#getNameRow(row));
    const [declaration] = symbol?.declarations ?? [];
    return symbol && declaration ? createDeclarationKey(declaration.path, symbol.name) : null;
  }

  getDeclarationKey(loc: SourceLocation): string | null {
    const row = this.#findRow(loc);
    return row === NO_ROW ? null : this.#getDeclarationKey(row);
  }

  getContextKey(loc: SourceLocation): string | null {
    const row = this.#findRow(loc);
    const node = this.#nodes[row];
    if (!node) return null;
    return this.#getDeclarationKey(
      isPropertyAccessExpression(node) && node.name.text === "Provider" ? row + 1 : row,
    );
  }

  isNonMutatingMethod(calleeLoc: SourceLocation): boolean {
    const row = this.#findRow(calleeLoc);
    const node = this.#nodes[row];
    if (!node || !isPropertyAccessExpression(node)) return false;
    const methodName = node.name.text;
    const receiverType = this.#getType(row + 1);
    if (!receiverType) return false;
    const definedMembers = (this.types.getUnionMembers(receiverType) ?? []).filter(
      (member) => !(member.flags & (TypeFlags.Null | TypeFlags.Undefined)),
    );
    return (
      definedMembers.length > 0 &&
      definedMembers.every((member) => {
        const collection = this.types.getCollection(member);
        return (
          Boolean(member.flags & TypeFlags.StringLike) ||
          (collection !== null && this.types.isReadonlyMethod(collection, methodName))
        );
      })
    );
  }

  getCollectionName(loc: SourceLocation): MutableCollection | null {
    const type = this.getType(loc);
    return type ? this.types.getCollection(type) : null;
  }

  hasPrimitiveType(loc: SourceLocation): boolean {
    const type = this.getType(loc);
    return type !== undefined && this.types.isPrimitiveType(type);
  }

  getRequiredSample(loc: SourceLocation): Sample | null {
    const type = this.getType(loc);
    if (!type) return null;
    const required = this.types.checker
      .getPropertiesOfType(type)
      .filter((property) => !(property.flags & SymbolFlags.Optional));
    const requiredTypes = this.types.getTypesOfSymbols(required);
    const fields: Record<string, Sample> = {};
    required.forEach((property, index) => {
      const [fieldSample] = getSamples(this.types, requiredTypes[index], 1, property.name);
      if (fieldSample) fields[property.name] = fieldSample;
    });
    return Object.keys(fields).length > 0 ? { kind: "Object", fields, isOpen: false } : null;
  }

  isContext(loc: SourceLocation): boolean {
    const type = this.getType(loc);
    return type !== undefined && isReactType(type, CONTEXT_TYPE_PATTERN);
  }

  isReactElement(loc: SourceLocation): boolean {
    const type = this.getType(loc);
    return (
      type !== undefined &&
      (this.types.getUnionMembers(type) ?? []).some((member) =>
        isReactType(member, REACT_ELEMENT_TYPE_PATTERN),
      )
    );
  }
}
