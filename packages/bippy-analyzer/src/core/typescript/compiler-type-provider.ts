import type { SourceFile } from "typescript/unstable/ast";
import { SignatureKind, SymbolFlags, TypeFlags } from "typescript/unstable/sync";
import type { Checker, Signature, Type as TypeScriptType } from "typescript/unstable/sync";
import type { MutableCollection, TypeProvider } from "../hir/environment.js";
import { Effect, ValueKind } from "../hir/hir.js";
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
const READONLY_COLLECTION_NAMES = new Set(["ReadonlyArray", "ReadonlyMap", "ReadonlySet"]);
const COLLECTION_SHAPE_IDS = new Map([
  ["Map", BuiltInMapId],
  ["Set", BuiltInSetId],
]);

const isPrimitiveType = (type: TypeScriptType): boolean =>
  Boolean(type.flags & PRIMITIVE_FLAGS) ||
  (type.isUnionType() && type.getTypes().every(isPrimitiveType));

const isReadonlyCollection = (type: TypeScriptType): boolean =>
  READONLY_COLLECTION_NAMES.has(type.getSymbol()?.name ?? "");

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
    if (isReadonlyCollection(type)) return { kind: "Object", shapeId: BuiltInMixedReadonlyId };
    if (this.#checker.isArrayType(type) || this.#checker.isTupleType(type)) {
      return { kind: "Object", shapeId: BuiltInArrayId };
    }
    const collectionShapeId = COLLECTION_SHAPE_IDS.get(type.getSymbol()?.name ?? "");
    if (collectionShapeId) return { kind: "Object", shapeId: collectionShapeId };
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
    const restParam = signature.hasRestParameter ? (parameterEffects.pop() ?? null) : null;
    const returnTypeScriptType = this.#checker.getReturnTypeOfSignature(signature);
    const returnType =
      (returnTypeScriptType && this.#convert(returnTypeScriptType, shapes, depth + 1)) ?? null;
    return addFunction(shapes, [], {
      positionalParams: parameterEffects,
      restParam,
      returnType: returnType ?? { kind: "Poly" },
      returnValueKind: this.#getValueKind(returnType),
      calleeEffect: Effect.Read,
    });
  }

  #getParameterEffect(type: TypeScriptType | undefined): Effect {
    return type && (isPrimitiveType(type) || isReadonlyCollection(type))
      ? Effect.Read
      : Effect.ConditionallyMutate;
  }

  #getValueKind(type: BuiltInType | null): ValueKind {
    if (type?.kind === "Primitive") return ValueKind.Primitive;
    if (type?.kind === "Object" && type.shapeId === BuiltInMixedReadonlyId) return ValueKind.Frozen;
    return ValueKind.Mutable;
  }
}
