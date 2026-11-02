import { TypeFlags } from "typescript/unstable/sync";
import type { Signature, Type } from "typescript/unstable/sync";
import type { MutableCollection } from "../../react-compiler/HIR/Environment";
import { Effect, ValueKind, makeType } from "../../react-compiler/HIR/HIR";
import type { BuiltInType, HIRFunction, Place, SourceLocation } from "../../react-compiler/HIR/HIR";
import {
  BuiltInArrayId,
  BuiltInMapId,
  BuiltInMixedReadonlyId,
  BuiltInSetId,
  addFunction,
} from "../../react-compiler/HIR/ObjectShape";
import type { ShapeRegistry } from "../../react-compiler/HIR/ObjectShape";
import {
  eachInstructionLValue,
  eachInstructionValueOperand,
  eachTerminalOperand,
} from "../../react-compiler/HIR/visitors";
import { isFunctionCreation } from "../interpret/is-function-creation";
import type { SourceFileResolver } from "./source-file-resolver";

const MAX_CONVERSION_DEPTH = 3;
const NULLISH_FLAGS = TypeFlags.Null | TypeFlags.Undefined | TypeFlags.Void;

const COLLECTION_SHAPES: Record<MutableCollection, string> = {
  Array: BuiltInArrayId,
  Map: BuiltInMapId,
  Set: BuiltInSetId,
};

const collectLocations = (hirFunction: HIRFunction): SourceLocation[] => {
  const places: Place[] = [
    ...hirFunction.params.map((param) => (param.kind === "Identifier" ? param : param.place)),
    ...hirFunction.context,
    hirFunction.returns,
  ];
  const locations: SourceLocation[] = [];
  for (const block of hirFunction.body.blocks.values()) {
    for (const instruction of block.instructions) {
      places.push(
        ...eachInstructionLValue(instruction),
        ...eachInstructionValueOperand(instruction.value),
      );
      if (isFunctionCreation(instruction.value))
        locations.push(...collectLocations(instruction.value.loweredFunc.func));
    }
    places.push(...eachTerminalOperand(block.terminal));
  }
  return [
    ...locations,
    ...places.flatMap((place): SourceLocation[] => [place.loc, place.identifier.loc]),
  ];
};

export class CompilerTypeProvider {
  readonly #resolver: SourceFileResolver;

  constructor(resolver: SourceFileResolver) {
    this.#resolver = resolver;
  }

  loadFunction(hirFunction: HIRFunction): void {
    this.#resolver.load(collectLocations(hirFunction));
  }

  getReactExportName(loc: SourceLocation): string | null {
    return this.#resolver.getReactExportName(loc);
  }

  isMutatingMethod(collection: MutableCollection, method: string): boolean {
    return this.#resolver.types.isMutatingMethod(collection, method);
  }

  getType(loc: SourceLocation, shapes: ShapeRegistry): BuiltInType | null {
    const type = this.#resolver.getType(loc);
    return type ? this.#convertType(type, shapes, 0) : null;
  }

  #convertType(type: Type, shapes: ShapeRegistry, depth: number): BuiltInType | null {
    const types = this.#resolver.types;
    if (type.isErrorType() || type.flags & (TypeFlags.AnyOrUnknown | TypeFlags.Never)) return null;
    if (types.isPrimitiveType(type)) return { kind: "Primitive" };
    if (type.isUnionType()) {
      const [onlyMember, ...otherMembers] = (types.getUnionMembers(type) ?? []).filter(
        (member) => !(member.flags & NULLISH_FLAGS),
      );
      return onlyMember && otherMembers.length === 0
        ? this.#convertType(onlyMember, shapes, depth)
        : null;
    }
    const collectionType = this.#getCollectionType(type);
    if (collectionType) return collectionType;
    const [signature, ...overloads] = types.getCallSignatures(type);
    if (signature && overloads.length === 0 && depth < MAX_CONVERSION_DEPTH)
      return this.#convertSignature(signature, shapes, depth);
    return null;
  }

  #convertSignature(signature: Signature, shapes: ShapeRegistry, depth: number): BuiltInType {
    const types = this.#resolver.types;
    const parameterEffects = types
      .getParameterTypes(signature)
      .map((parameterType) => this.#getParameterEffect(parameterType));
    const restParameterEffect = signature.hasRestParameter
      ? (parameterEffects.pop() ?? null)
      : null;
    const signatureReturnType = types.getReturnType(signature);
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
    const types = this.#resolver.types;
    const collection = types.getCollection(type);
    if (!collection) return null;
    const isDeeplyReadonly =
      !types.hasMutatingMethod(type) &&
      type.isTypeReference() &&
      types.getTypeArguments(type).every((typeArgument) => types.isPrimitiveType(typeArgument));
    return {
      kind: "Object",
      shapeId: isDeeplyReadonly ? BuiltInMixedReadonlyId : COLLECTION_SHAPES[collection],
    };
  }

  #getParameterEffect(type: Type | undefined): Effect {
    if (!type) return Effect.ConditionallyMutate;
    const collection = this.#getCollectionType(type);
    const isReadonly =
      this.#resolver.types.isPrimitiveType(type) ||
      (collection?.kind === "Object" && collection.shapeId === BuiltInMixedReadonlyId);
    return isReadonly ? Effect.Read : Effect.ConditionallyMutate;
  }
}
