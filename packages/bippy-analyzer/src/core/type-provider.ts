import type { SourceFile } from "typescript/unstable/ast";
import { SignatureKind, TypeFlags } from "typescript/unstable/sync";
import type { Checker, Signature, Type } from "typescript/unstable/sync";
import type { MutableCollection, TypeProvider } from "../react-compiler/HIR/Environment";
import { Effect, ValueKind, makeType } from "../react-compiler/HIR/HIR";
import type { BuiltInType, SourceLocation } from "../react-compiler/HIR/HIR";
import {
  BuiltInArrayId,
  BuiltInMapId,
  BuiltInMixedReadonlyId,
  BuiltInSetId,
  addFunction,
} from "../react-compiler/HIR/ObjectShape";
import type { ShapeRegistry } from "../react-compiler/HIR/ObjectShape";
import { getCollectionName, getInterfaceMemberNames } from "./utils/lib-collections";
import { findNodeAtLocation } from "./utils/find-node-at-location";
import { getReactExportName } from "./utils/typescript";
import { getTypeAtLocation } from "./utils/get-type-at-location";
import { getTypeArguments } from "./utils/get-type-arguments";
import { getUnionMembers } from "./utils/get-union-members";

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

interface Collection {
  shapeId: string;
  mutatingMethod: string;
}

const COLLECTIONS: Record<MutableCollection, Collection> = {
  Array: { shapeId: BuiltInArrayId, mutatingMethod: "push" },
  Map: { shapeId: BuiltInMapId, mutatingMethod: "set" },
  Set: { shapeId: BuiltInSetId, mutatingMethod: "add" },
};

const isPrimitiveType = (type: Type): boolean =>
  Boolean(type.flags & PRIMITIVE_FLAGS) ||
  (type.isUnionType() && (getUnionMembers(type)?.every(isPrimitiveType) ?? false));

export class CompilerTypeProvider implements TypeProvider {
  readonly #checker: Checker;
  readonly #sourceFile: SourceFile;
  readonly #mutatingMethodsByCollection = new Map<MutableCollection, Set<string>>();

  constructor(checker: Checker, sourceFile: SourceFile) {
    this.#checker = checker;
    this.#sourceFile = sourceFile;
  }

  getReactExportName(loc: SourceLocation): string | null {
    const node = findNodeAtLocation(this.#sourceFile, loc);
    return node ? getReactExportName(this.#checker, node) : null;
  }

  isMutatingMethod(collection: MutableCollection, method: string): boolean {
    const cachedMethods = this.#mutatingMethodsByCollection.get(collection);
    if (cachedMethods) return cachedMethods.has(method);
    const readonlyMethods = new Set(
      getInterfaceMemberNames(this.#checker, this.#sourceFile, `Readonly${collection}`),
    );
    const mutatingMethods = new Set(
      getInterfaceMemberNames(this.#checker, this.#sourceFile, collection).filter(
        (memberName) => !readonlyMethods.has(memberName),
      ),
    );
    this.#mutatingMethodsByCollection.set(collection, mutatingMethods);
    return mutatingMethods.has(method);
  }

  getType(loc: SourceLocation, shapes: ShapeRegistry): BuiltInType | null {
    const node = findNodeAtLocation(this.#sourceFile, loc);
    const type = node ? getTypeAtLocation(this.#checker, node) : undefined;
    return type ? this.#convertType(type, shapes, 0) : null;
  }

  #convertType(type: Type, shapes: ShapeRegistry, depth: number): BuiltInType | null {
    if (type.isErrorType() || type.flags & (TypeFlags.AnyOrUnknown | TypeFlags.Never)) return null;
    if (isPrimitiveType(type)) return { kind: "Primitive" };
    if (type.isUnionType()) {
      const [onlyMember, ...otherMembers] = (getUnionMembers(type) ?? []).filter(
        (member) => !(member.flags & NULLISH_FLAGS),
      );
      return onlyMember && otherMembers.length === 0
        ? this.#convertType(onlyMember, shapes, depth)
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

  #convertSignature(signature: Signature, shapes: ShapeRegistry, depth: number): BuiltInType {
    const parameterEffects = signature
      .getParameters()
      .map((parameter) => this.#getParameterEffect(this.#checker.getTypeOfSymbol(parameter)));
    const restParameterEffect = signature.hasRestParameter
      ? (parameterEffects.pop() ?? null)
      : null;
    const signatureReturnType = this.#checker.getReturnTypeOfSignature(signature);
    const returnType =
      (signatureReturnType && this.#convertType(signatureReturnType, shapes, depth + 1)) ?? null;
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
      restParam: restParameterEffect,
      returnType,
      returnValueKind: ValueKind.Primitive,
      calleeEffect: Effect.Read,
    });
  }

  #getCollectionType(type: Type): BuiltInType | null {
    const collectionName = getCollectionName(this.#checker, type);
    const collection = collectionName ? COLLECTIONS[collectionName] : undefined;
    if (!collection) return null;
    return {
      kind: "Object",
      shapeId: this.#isDeeplyReadonly(type, collection)
        ? BuiltInMixedReadonlyId
        : collection.shapeId,
    };
  }

  #isDeeplyReadonly(type: Type, collection: Collection): boolean {
    if (this.#checker.getPropertyOfType(type, collection.mutatingMethod)) return false;
    return type.isTypeReference() && getTypeArguments(this.#checker, type).every(isPrimitiveType);
  }

  #getParameterEffect(type: Type | undefined): Effect {
    if (!type) return Effect.ConditionallyMutate;
    const collection = this.#getCollectionType(type);
    const isReadonly =
      isPrimitiveType(type) ||
      (collection?.kind === "Object" && collection.shapeId === BuiltInMixedReadonlyId);
    return isReadonly ? Effect.Read : Effect.ConditionallyMutate;
  }
}
