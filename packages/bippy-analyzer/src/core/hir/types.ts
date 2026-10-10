/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
// Ported from babel-plugin-react-compiler/src/HIR/Types.ts at b618bbb.

import { CompilerError } from "../compiler-error.js";
import { GeneratedSource, type PropertyLiteral } from "./hir.js";

export type BuiltInType = PrimitiveType | FunctionType | ObjectType;

export type Type = BuiltInType | PhiType | TypeVar | PolyType | PropType | ObjectMethod;
export interface PrimitiveType {
  kind: "Primitive";
}

/*
 * An {@link FunctionType} or {@link ObjectType} (also a JS object) may be associated with an
 * inferred "object shape", i.e. a known property (key -> Type) map. This is
 * subtly different from JS language semantics - `shape` represents both
 * OwnPropertyDescriptors and properties present in the prototype chain.
 *
 * {@link ObjectShape.functionType} is always present on the shape of a {@link FunctionType},
 * and it represents the call signature of the function. Note that Forget thinks of a
 * {@link FunctionType} as any "callable object" (not to be confused with objects that
 *   extend the global `Function`.)
 *
 * If `shapeId` is present, it is a key into the ShapeRegistry used to infer this
 * FunctionType or ObjectType instance (i.e. from an Environment).
 */

export interface FunctionType {
  kind: "Function";
  shapeId: string | null;
  return: Type;
  isConstructor: boolean;
}

export interface ObjectType {
  kind: "Object";
  shapeId: string | null;
}

export interface TypeVar {
  kind: "Type";
  id: TypeId;
}
export interface PolyType {
  kind: "Poly";
}
export interface PhiType {
  kind: "Phi";
  operands: Array<Type>;
}
export interface PropType {
  kind: "Property";
  objectType: Type;
  objectName: string;
  propertyName:
    | {
        kind: "literal";
        value: PropertyLiteral;
      }
    | {
        kind: "computed";
        value: Type;
      };
}

export interface ObjectMethod {
  kind: "ObjectMethod";
}

/*
 * Simulated opaque type for TypeId to prevent using normal numbers as ids
 * accidentally.
 */
const opaqueTypeId = Symbol();
export type TypeId = number & { [opaqueTypeId]: "IdentifierId" };

export const makeTypeId = (value: number): TypeId => {
  CompilerError.invariant(value >= 0 && Number.isInteger(value), {
    reason: "Expected instruction id to be a non-negative integer",
    loc: GeneratedSource,
  });
  return value as TypeId;
};

let typeCounter = 0;
export const makeType = (): TypeVar => ({
  kind: "Type",
  id: makeTypeId(typeCounter++),
});

/**
 * Duplicates the given type, copying types that are exact while creating fresh
 * type identifiers for any abstract types.
 */
export const duplicateType = (type: Type): Type => {
  switch (type.kind) {
    case "Function": {
      return {
        kind: "Function",
        return: duplicateType(type.return),
        shapeId: type.shapeId,
        isConstructor: type.isConstructor,
      };
    }
    case "Object": {
      return { kind: "Object", shapeId: type.shapeId };
    }
    case "ObjectMethod": {
      return { kind: "ObjectMethod" };
    }
    case "Phi": {
      return {
        kind: "Phi",
        operands: type.operands.map((operand) => duplicateType(operand)),
      };
    }
    case "Poly": {
      return { kind: "Poly" };
    }
    case "Primitive": {
      return { kind: "Primitive" };
    }
    case "Property": {
      return {
        kind: "Property",
        objectType: duplicateType(type.objectType),
        objectName: type.objectName,
        propertyName: type.propertyName,
      };
    }
    case "Type": {
      return makeType();
    }
  }
};

export const typeEquals = (typeA: Type, typeB: Type): boolean => {
  if (typeA.kind !== typeB.kind) return false;
  return (
    typeVarEquals(typeA, typeB) ||
    funcTypeEquals(typeA, typeB) ||
    objectTypeEquals(typeA, typeB) ||
    primitiveTypeEquals(typeA, typeB) ||
    polyTypeEquals(typeA, typeB) ||
    phiTypeEquals(typeA, typeB) ||
    propTypeEquals(typeA, typeB) ||
    objectMethodTypeEquals(typeA, typeB)
  );
};

const typeVarEquals = (typeA: Type, typeB: Type): boolean => {
  if (typeA.kind === "Type" && typeB.kind === "Type") {
    return typeA.id === typeB.id;
  }
  return false;
};

const typeKindCheck = (typeA: Type, typeB: Type, type: string): boolean =>
  typeA.kind === type && typeB.kind === type;

const objectMethodTypeEquals = (typeA: Type, typeB: Type): boolean =>
  typeKindCheck(typeA, typeB, "ObjectMethod");

const propTypeEquals = (typeA: Type, typeB: Type): boolean => {
  if (typeA.kind === "Property" && typeB.kind === "Property") {
    if (!typeEquals(typeA.objectType, typeB.objectType)) {
      return false;
    }

    return typeA.propertyName === typeB.propertyName && typeA.objectName === typeB.objectName;
  }

  return false;
};

const primitiveTypeEquals = (typeA: Type, typeB: Type): boolean =>
  typeKindCheck(typeA, typeB, "Primitive");

const polyTypeEquals = (typeA: Type, typeB: Type): boolean => typeKindCheck(typeA, typeB, "Poly");

const objectTypeEquals = (typeA: Type, typeB: Type): boolean => {
  if (typeA.kind === "Object" && typeB.kind === "Object") {
    return typeA.shapeId === typeB.shapeId;
  }

  return false;
};

const funcTypeEquals = (typeA: Type, typeB: Type): boolean => {
  if (typeA.kind !== "Function" || typeB.kind !== "Function") {
    return false;
  }
  return typeEquals(typeA.return, typeB.return);
};

const phiTypeEquals = (typeA: Type, typeB: Type): boolean => {
  if (typeA.kind === "Phi" && typeB.kind === "Phi") {
    if (typeA.operands.length !== typeB.operands.length) {
      return false;
    }

    const operands = new Set(typeA.operands);
    for (const operand of typeB.operands) {
      if (!operands.has(operand)) {
        return false;
      }
    }
  }

  return false;
};
