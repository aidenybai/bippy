import type { Node } from "typescript/unstable/ast";
import { ObjectFlags, SignatureKind, SymbolFlags, TypeFlags } from "typescript/unstable/sync";
import type { Checker, Signature, Symbol, Type } from "typescript/unstable/sync";
import type { MutableCollection } from "../../react-compiler/HIR/Environment";

const TYPESCRIPT_PANIC_PATTERN = /^panic: /;
const LIBRARY_DECLARATION_PATTERN = /[\\/]lib\.[\w.]*\.d\.ts$/;
const REACT_DECLARATION_PATTERN = /[\\/]node_modules[\\/](?:@types[\\/])?react(?:-dom)?[\\/]/;

const COLLECTIONS: MutableCollection[] = ["Array", "Map", "Set"];
const COLLECTION_INTERFACES = COLLECTIONS.flatMap((collection) => [
  collection,
  `Readonly${collection}`,
]);
const MUTATING_METHODS: Record<MutableCollection, string> = {
  Array: "push",
  Map: "set",
  Set: "add",
};

const COLLECTION_MASK = 0b11;
const IS_TUPLE = 1 << 2;

const PRIMITIVE_FLAGS =
  TypeFlags.StringLike |
  TypeFlags.NumberLike |
  TypeFlags.BigIntLike |
  TypeFlags.BooleanLike |
  TypeFlags.EnumLike |
  TypeFlags.ESSymbolLike |
  TypeFlags.Null |
  TypeFlags.Undefined |
  TypeFlags.Void;
const UNNAMED_FLAGS =
  TypeFlags.Union | TypeFlags.StringLiteral | TypeFlags.NumberLiteral | TypeFlags.BooleanLiteral;

export const queryChecker = <Result>(query: () => Result): Result | null => {
  try {
    return query();
  } catch (error) {
    if (error instanceof Error && TYPESCRIPT_PANIC_PATTERN.test(error.message)) return null;
    throw error;
  }
};

const isDeclaredIn = (symbol: Symbol, declarationPattern: RegExp): boolean =>
  symbol.declarations.some((declaration) => declarationPattern.test(declaration.path));

const isDeclaredType = (type: Type, namePattern: RegExp, declarationPattern: RegExp): boolean =>
  [type.getSymbol(), type.getAliasSymbol()].some(
    (symbol) =>
      symbol !== undefined &&
      namePattern.test(symbol.name) &&
      isDeclaredIn(symbol, declarationPattern),
  );

export const isReactType = (type: Type, namePattern: RegExp): boolean =>
  isDeclaredType(type, namePattern, REACT_DECLARATION_PATTERN);

export const isLibraryType = (type: Type, namePattern: RegExp): boolean =>
  isDeclaredType(type, namePattern, LIBRARY_DECLARATION_PATTERN);

export const isReactSymbol = (symbol: Symbol): boolean =>
  isDeclaredIn(symbol, REACT_DECLARATION_PATTERN);

export class TypeTable {
  readonly checker: Checker;
  readonly #interfaceTypeIds = new Int32Array(COLLECTION_INTERFACES.length).fill(-1);
  readonly #interfaceMembers: ReadonlySet<string>[] = [];
  #slotsById = new Int32Array(1024);
  #facts = new Uint8Array(1024);
  readonly #texts: string[] = [];
  readonly #members: (readonly Type[] | null)[] = [];
  readonly #callSignatures: (readonly Signature[])[] = [];

  constructor(checker: Checker) {
    this.checker = checker;
    COLLECTION_INTERFACES.forEach((name, index) => {
      const symbol = checker.resolveName(name, SymbolFlags.Type);
      const type = symbol && checker.getDeclaredTypeOfSymbol(symbol);
      this.#interfaceTypeIds[index] = type?.id ?? -1;
      this.#interfaceMembers.push(
        new Set(type ? checker.getPropertiesOfType(type).map((property) => property.name) : []),
      );
    });
  }

  getTypesAtNodes(nodes: readonly Node[]): (Type | undefined)[] {
    if (nodes.length === 0) return [];
    const types =
      queryChecker(() => this.checker.getTypeAtLocation(nodes)) ??
      nodes.map((node) => queryChecker(() => this.checker.getTypeAtLocation(node)) ?? undefined);
    this.#intern(types);
    return types;
  }

  getTypesOfSymbols(symbols: readonly Symbol[]): (Type | undefined)[] {
    if (symbols.length === 0) return [];
    const types = this.checker.getTypeOfSymbol(symbols);
    this.#intern(types);
    return types;
  }

  getText(type: Type): string {
    return this.#texts[this.#getSlot(type)] ?? "";
  }

  getUnionMembers(type: Type): readonly Type[] | null {
    return type.isUnionType() ? (this.#members[this.#getSlot(type)] ?? null) : [type];
  }

  getIntersectionMembers(type: Type): readonly Type[] {
    return this.#members[this.#getSlot(type)] ?? [];
  }

  getTypeArguments(type: Type): readonly Type[] {
    if (!type.isTypeReference()) return [];
    const typeArguments = queryChecker(() => this.checker.getTypeArguments(type)) ?? [];
    this.#intern(typeArguments);
    return typeArguments;
  }

  getCallSignatures(type: Type): readonly Signature[] {
    return (
      this.#callSignatures[this.#getSlot(type)] ??
      this.checker.getSignaturesOfType(type, SignatureKind.Call)
    );
  }

  getReturnType(signature: Signature): Type | undefined {
    const returnType = this.checker.getReturnTypeOfSignature(signature);
    this.#intern([returnType]);
    return returnType;
  }

  getParameterTypes(signature: Signature): (Type | undefined)[] {
    return this.getTypesOfSymbols(signature.getParameters());
  }

  hasIndexInfos(type: Type): boolean {
    return this.checker.getIndexInfosOfType(type).length > 0;
  }

  hasMutatingMethod(type: Type): boolean {
    const collection = this.getCollection(type);
    return (
      collection !== null &&
      this.checker.getPropertyOfType(type, MUTATING_METHODS[collection]) !== undefined
    );
  }

  isTupleType(type: Type): boolean {
    return (this.#getFacts(type) & IS_TUPLE) !== 0;
  }

  isArrayType(type: Type): boolean {
    return (this.#getFacts(type) & (COLLECTION_MASK | IS_TUPLE)) === 1;
  }

  getCollection(type: Type): MutableCollection | null {
    return COLLECTIONS[(this.#getFacts(type) & COLLECTION_MASK) - 1] ?? null;
  }

  isPrimitiveType(type: Type): boolean {
    return (
      Boolean(type.flags & PRIMITIVE_FLAGS) ||
      (type.isUnionType() &&
        (this.getUnionMembers(type)?.every((member) => this.isPrimitiveType(member)) ?? false))
    );
  }

  isReadonlyMethod(collection: MutableCollection, method: string): boolean {
    return this.#interfaceMembers[COLLECTIONS.indexOf(collection) * 2 + 1]?.has(method) ?? false;
  }

  isMutatingMethod(collection: MutableCollection, method: string): boolean {
    return (
      (this.#interfaceMembers[COLLECTIONS.indexOf(collection) * 2]?.has(method) ?? false) &&
      !this.isReadonlyMethod(collection, method)
    );
  }

  #getSlot(type: Type): number {
    return (this.#slotsById[type.id] ?? 0) - 1;
  }

  #getFacts(type: Type): number {
    return this.#facts[this.#getSlot(type)] ?? 0;
  }

  #getCollectionFacts(type: Type): number {
    if (type.isTypeReference()) {
      const target = type.getTarget();
      const interfaceIndex = this.#interfaceTypeIds.indexOf(target.id);
      if (interfaceIndex !== -1) return (interfaceIndex >> 1) + 1;
      if (target.isObjectType() && target.objectFlags & ObjectFlags.Tuple) return 1 | IS_TUPLE;
    }
    return 0;
  }

  #intern(types: readonly (Type | undefined)[]): void {
    const pending = types.filter((type) => type !== undefined);
    for (let index = 0; index < pending.length; index++) {
      const type = pending[index]!;
      if (this.#getSlot(type) !== -1) continue;
      const slot = this.#texts.length;
      if (type.id >= this.#slotsById.length) {
        const slotsById = new Int32Array(Math.max(type.id + 1, this.#slotsById.length * 2));
        slotsById.set(this.#slotsById);
        this.#slotsById = slotsById;
      }
      if (slot >= this.#facts.length) {
        const facts = new Uint8Array(this.#facts.length * 2);
        facts.set(this.#facts);
        this.#facts = facts;
      }
      this.#slotsById[type.id] = slot + 1;
      const members =
        type.isUnionType() || type.isIntersectionType()
          ? (queryChecker(() => type.getTypes()) ?? null)
          : null;
      const collectionFacts = this.#getCollectionFacts(type);
      this.#texts.push(
        type.flags & UNNAMED_FLAGS
          ? ""
          : type.isIntrinsicType()
            ? type.intrinsicName
            : this.checker.typeToString(type),
      );
      this.#members.push(members);
      this.#callSignatures.push(
        type.flags & PRIMITIVE_FLAGS
          ? []
          : this.checker.getSignaturesOfType(type, SignatureKind.Call),
      );
      this.#facts[slot] = collectionFacts;
      if (members) pending.push(...members);
    }
  }
}
