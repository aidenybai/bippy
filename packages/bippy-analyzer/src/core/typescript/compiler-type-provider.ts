import type { SourceFile } from "typescript/unstable/ast";
import { SignatureKind, SymbolFlags, TypeFlags } from "typescript/unstable/sync";
import type { Checker, Signature, Type as TypeScriptType } from "typescript/unstable/sync";
import type { MutableCollection, TypeProvider } from "../hir/environment.js";
import { Effect, ValueKind, makeType } from "../hir/hir.js";
import type { BuiltInType, SourceLocation } from "../hir/hir.js";
import {
  BuiltInArrayId,
  BuiltInMapId,
  BuiltInMixedReadonlyId,
  BuiltInSetId,
  addFunction,
} from "../hir/object-shape.js";
import type { ShapeRegistry } from "../hir/object-shape.js";
import { findNodeAtLocation, getReactExportName } from "./nodes.js";

const MAX_CONVERSION_DEPTH = 3;
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
const NULLISH_FLAGS = TypeFlags.Null | TypeFlags.Undefined | TypeFlags.Void;
const LIB_DECLARATION_PATTERN = /[\\/]lib\.[\w.]*\.d\.ts$/;

interface Collection {
  shapeId: string;
  mutatingMethod: string;
}

const ARRAY_COLLECTION: Collection = { shapeId: BuiltInArrayId, mutatingMethod: "push" };
const LIB_COLLECTIONS = new Map<string, Collection>([
  ["Map", { shapeId: BuiltInMapId, mutatingMethod: "set" }],
  ["ReadonlyMap", { shapeId: BuiltInMapId, mutatingMethod: "set" }],
  ["Set", { shapeId: BuiltInSetId, mutatingMethod: "add" }],
  ["ReadonlySet", { shapeId: BuiltInSetId, mutatingMethod: "add" }],
]);

const isPrimitiveType = (type: TypeScriptType): boolean =>
  Boolean(type.flags & PRIMITIVE_FLAGS) ||
  (type.isUnionType() && type.getTypes().every(isPrimitiveType));

const getShapeId = (type: BuiltInType | null): string | null =>
  type?.kind === "Object" ? type.shapeId : null;

/**
 * Types the compiler's HIR from the TypeScript checker. The compiler only knows React's
 * APIs and a few globals; the checker knows every import, prop and call result. Values the
 * compiler leaves untyped take the type the checker gives their expression.
 */
export class CompilerTypeProvider implements TypeProvider {
  readonly #checker: Checker;
  readonly #sourceFile: SourceFile;
  readonly #mutatingMethods = new Map<MutableCollection, Set<string>>();

  constructor(checker: Checker, sourceFile: SourceFile) {
    this.#checker = checker;
    this.#sourceFile = sourceFile;
  }

  getReactExportName(loc: SourceLocation): string | null {
    const node = findNodeAtLocation(this.#sourceFile, loc);
    return node ? getReactExportName(this.#checker, node) : null;
  }

  isMutatingMethod(collection: MutableCollection, method: string): boolean {
    let methods = this.#mutatingMethods.get(collection);
    if (!methods) {
      const readonlyMethods = new Set(this.#getMemberNames(`Readonly${collection}`));
      methods = new Set(
        this.#getMemberNames(collection).filter((name) => !readonlyMethods.has(name)),
      );
      this.#mutatingMethods.set(collection, methods);
    }
    return methods.has(method);
  }

  #getMemberNames(interfaceName: string): string[] {
    const symbol = this.#checker.resolveName(interfaceName, SymbolFlags.Type, this.#sourceFile);
    if (!symbol) return [];
    const type = this.#checker.getDeclaredTypeOfSymbol(symbol);
    return this.#checker.getPropertiesOfType(type).map((property) => property.name);
  }

  getType(loc: SourceLocation, shapes: ShapeRegistry): BuiltInType | null {
    const node = findNodeAtLocation(this.#sourceFile, loc);
    const type = node ? this.#checker.getTypeAtLocation(node) : undefined;
    return type ? this.#convert(type, shapes, 0) : null;
  }

  #convert(type: TypeScriptType, shapes: ShapeRegistry, depth: number): BuiltInType | null {
    if (type.isErrorType() || type.flags & (TypeFlags.AnyOrUnknown | TypeFlags.Never)) return null;
    if (isPrimitiveType(type)) return { kind: "Primitive" };
    if (type.isUnionType()) {
      const [onlyMember, ...otherMembers] = type
        .getTypes()
        .filter((member) => !(member.flags & NULLISH_FLAGS));
      return onlyMember && otherMembers.length === 0
        ? this.#convert(onlyMember, shapes, depth)
        : null;
    }
    const collectionType = this.#getCollectionType(type);
    if (collectionType) return collectionType;
    const [signature, ...overloads] = this.#checker.getSignaturesOfType(type, SignatureKind.Call);
    if (signature && overloads.length === 0 && depth < MAX_CONVERSION_DEPTH) {
      return this.#convertSignature(signature, shapes, depth);
    }
    return null;
  }

  /**
   * A signature only says which arguments are read and what kind of value comes back. It
   * can't say an argument may alias the return value, so functions returning anything but a
   * primitive keep the compiler's conservative handling of unknown calls.
   */
  #convertSignature(signature: Signature, shapes: ShapeRegistry, depth: number): BuiltInType {
    const parameterEffects = signature
      .getParameters()
      .map((parameter) => this.#getParameterEffect(this.#checker.getTypeOfSymbol(parameter)));
    const restParam = signature.hasRestParameter ? (parameterEffects.pop() ?? null) : null;
    const returnTypeScriptType = this.#checker.getReturnTypeOfSignature(signature);
    const returnType =
      (returnTypeScriptType && this.#convert(returnTypeScriptType, shapes, depth + 1)) ?? null;
    if (returnType?.kind !== "Primitive") {
      return {
        kind: "Function",
        shapeId: null,
        return: returnType ?? makeType(),
        isConstructor: false,
      };
    }
    return addFunction(shapes, [], {
      positionalParams: parameterEffects,
      restParam,
      returnType: returnType ?? { kind: "Poly" },
      returnValueKind: this.#getValueKind(returnType),
      calleeEffect: Effect.Read,
    });
  }

  /**
   * Arrays, tuples, and `Map` and `Set` from the standard library.
   */
  #getCollectionType(type: TypeScriptType): BuiltInType | null {
    const symbol = type.getSymbol();
    const isLibCollection = symbol?.declarations.some((declaration) =>
      LIB_DECLARATION_PATTERN.test(declaration.path),
    );
    const collection =
      this.#checker.isArrayType(type) || this.#checker.isTupleType(type)
        ? ARRAY_COLLECTION
        : isLibCollection
          ? LIB_COLLECTIONS.get(symbol?.name ?? "")
          : undefined;
    if (!collection) return null;
    return {
      kind: "Object",
      shapeId: this.#isDeeplyReadonly(type, collection)
        ? BuiltInMixedReadonlyId
        : collection.shapeId,
    };
  }

  /**
   * TypeScript's `readonly` is shallow: `readonly Item[]` still lets each item be mutated.
   * Only a readonly collection of primitives can't be mutated at all.
   */
  #isDeeplyReadonly(type: TypeScriptType, collection: Collection): boolean {
    if (this.#checker.getPropertyOfType(type, collection.mutatingMethod)) return false;
    return type.isTypeReference() && this.#checker.getTypeArguments(type).every(isPrimitiveType);
  }

  #getParameterEffect(type: TypeScriptType | undefined): Effect {
    if (!type) return Effect.ConditionallyMutate;
    const isReadonly =
      isPrimitiveType(type) || getShapeId(this.#getCollectionType(type)) === BuiltInMixedReadonlyId;
    return isReadonly ? Effect.Read : Effect.ConditionallyMutate;
  }

  #getValueKind(type: BuiltInType | null): ValueKind {
    if (type?.kind === "Primitive") return ValueKind.Primitive;
    if (type?.kind === "Object" && type.shapeId === BuiltInMixedReadonlyId) return ValueKind.Frozen;
    return ValueKind.Mutable;
  }
}
