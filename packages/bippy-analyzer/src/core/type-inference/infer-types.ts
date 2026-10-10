/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
// Ported from babel-plugin-react-compiler/src/TypeInference/InferTypes.ts at b618bbb.

import { CompilerError } from "../compiler-error.js";
import type { Environment } from "../hir/environment.js";
import {
  type BinaryOperator,
  GeneratedSource,
  type HIRFunction,
  type Identifier,
  type IdentifierId,
  type Instruction,
  InstructionKind,
  makePropertyLiteral,
  makeType,
  type PropType,
  type Type,
  typeEquals,
  type TypeId,
  type TypeVar,
} from "../hir/hir.js";
import {
  BuiltInArrayId,
  BuiltInFunctionId,
  BuiltInJsxId,
  BuiltInMixedReadonlyId,
  BuiltInObjectId,
  BuiltInPropsId,
  BuiltInRefValueId,
  BuiltInSetStateId,
  BuiltInUseRefId,
} from "../hir/object-shape.js";
import { eachInstructionLValue, eachInstructionOperand } from "../hir/visitors.js";
import { assertExhaustive } from "../utils/utils.js";

const isPrimitiveBinaryOp = (op: BinaryOperator): boolean => {
  switch (op) {
    case "+":
    case "-":
    case "/":
    case "%":
    case "*":
    case "**":
    case "&":
    case "|":
    case ">>":
    case "<<":
    case "^":
    case ">":
    case "<":
    case ">=":
    case "<=":
      return true;
    default:
      return false;
  }
};

export const inferTypes = (func: HIRFunction): void => {
  const unifier = new Unifier(func.env);
  for (const typeEquation of generate(func)) {
    unifier.unify(typeEquation.left, typeEquation.right);
  }
  apply(func, unifier);
};

const apply = (func: HIRFunction, unifier: Unifier): void => {
  for (const [, block] of func.body.blocks) {
    for (const phi of block.phis) {
      phi.place.identifier.type = unifier.get(phi.place.identifier.type);
    }
    for (const instr of block.instructions) {
      for (const operand of eachInstructionLValue(instr)) {
        operand.identifier.type = unifier.get(operand.identifier.type);
      }
      for (const place of eachInstructionOperand(instr)) {
        place.identifier.type = unifier.get(place.identifier.type);
      }
      instr.lvalue.identifier.type = unifier.get(instr.lvalue.identifier.type);

      if (instr.value.kind === "FunctionExpression" || instr.value.kind === "ObjectMethod") {
        apply(instr.value.loweredFunc.func, unifier);
      }
    }
  }
  const returns = func.returns.identifier;
  returns.type = unifier.get(returns.type);
};

interface TypeEquation {
  left: Type;
  right: Type;
}

const equation = (left: Type, right: Type): TypeEquation => ({
  left,
  right,
});

const generate = (func: HIRFunction, equations: Array<TypeEquation> = []): Array<TypeEquation> => {
  if (func.fnType === "Component") {
    const [props, ref] = func.params;
    if (props && props.kind === "Identifier") {
      equations.push(
        equation(props.identifier.type, {
          kind: "Object",
          shapeId: BuiltInPropsId,
        }),
      );
    }
    if (ref && ref.kind === "Identifier") {
      equations.push(
        equation(ref.identifier.type, {
          kind: "Object",
          shapeId: BuiltInUseRefId,
        }),
      );
    }
  }

  const names = new Map<IdentifierId, string>();
  const returnTypes: Array<Type> = [];
  for (const [, block] of func.body.blocks) {
    for (const phi of block.phis) {
      equations.push(
        equation(phi.place.identifier.type, {
          kind: "Phi",
          operands: [...phi.operands.values()].map((operand) => operand.identifier.type),
        }),
      );
    }

    for (const instr of block.instructions) {
      generateInstructionTypes(func.env, names, instr, equations);
    }
    const terminal = block.terminal;
    if (terminal.kind === "return") {
      returnTypes.push(terminal.value.identifier.type);
    }
  }
  const [firstReturnType] = returnTypes;
  if (returnTypes.length > 1) {
    equations.push(
      equation(func.returns.identifier.type, {
        kind: "Phi",
        operands: returnTypes,
      }),
    );
  } else if (firstReturnType !== undefined) {
    equations.push(equation(func.returns.identifier.type, firstReturnType));
  }
  return equations;
};

const setName = (names: Map<IdentifierId, string>, id: IdentifierId, name: Identifier): void => {
  if (name.name?.kind === "named") {
    names.set(id, name.name.value);
  }
};

const getName = (names: Map<IdentifierId, string>, id: IdentifierId): string => names.get(id) ?? "";

const generateInstructionTypes = (
  env: Environment,
  names: Map<IdentifierId, string>,
  instr: Instruction,
  equations: Array<TypeEquation>,
): void => {
  const lvalue = instr.lvalue;
  const value = instr.value;
  const left = lvalue.identifier.type;

  switch (value.kind) {
    case "TemplateLiteral":
    case "JSXText":
    case "Primitive": {
      equations.push(equation(left, { kind: "Primitive" }));
      break;
    }

    case "UnaryExpression": {
      equations.push(equation(left, { kind: "Primitive" }));
      break;
    }

    case "LoadLocal": {
      setName(names, lvalue.identifier.id, value.place.identifier);
      equations.push(equation(left, value.place.identifier.type));
      break;
    }

    // We intentionally do not infer types for most context variables
    case "DeclareContext":
    case "LoadContext": {
      break;
    }
    case "StoreContext": {
      /**
       * The caveat is StoreContext const, where we know the value is
       * assigned once such that everywhere the value is accessed, it
       * must have the same type from the rvalue.
       *
       * A concrete example where this is useful is `const ref = useRef()`
       * where the ref is referenced before its declaration in a function
       * expression, causing it to be converted to a const context variable.
       */
      if (value.lvalue.kind === InstructionKind.Const) {
        equations.push(equation(value.lvalue.place.identifier.type, value.value.identifier.type));
      }
      break;
    }

    case "StoreLocal": {
      equations.push(equation(left, value.value.identifier.type));
      equations.push(equation(value.lvalue.place.identifier.type, value.value.identifier.type));
      break;
    }

    case "StoreGlobal": {
      equations.push(equation(left, value.value.identifier.type));
      break;
    }

    case "BinaryExpression": {
      if (isPrimitiveBinaryOp(value.operator)) {
        equations.push(equation(value.left.identifier.type, { kind: "Primitive" }));
        equations.push(equation(value.right.identifier.type, { kind: "Primitive" }));
      }
      equations.push(equation(left, { kind: "Primitive" }));
      break;
    }

    case "PostfixUpdateLocal":
    case "PostfixUpdateContext":
    case "PrefixUpdateContext":
    case "PrefixUpdateLocal": {
      equations.push(equation(value.value.identifier.type, { kind: "Primitive" }));
      equations.push(equation(value.lvalue.identifier.type, { kind: "Primitive" }));
      equations.push(equation(left, { kind: "Primitive" }));
      break;
    }

    case "LoadGlobal": {
      const globalType = env.getGlobalDeclaration(value.binding);
      if (globalType) {
        equations.push(equation(left, globalType));
      }
      break;
    }

    case "CallExpression": {
      const returnType = makeType();
      /*
       * TODO: callee could be a hook or a function, so this type equation isn't correct.
       * We should change Hook to a subtype of Function or change unifier logic.
       * (see https://github.com/facebook/react-forget/pull/1427)
       */
      const shapeId =
        env.config.enableTreatSetIdentifiersAsStateSetters &&
        getName(names, value.callee.identifier.id).startsWith("set")
          ? BuiltInSetStateId
          : null;
      equations.push(
        equation(value.callee.identifier.type, {
          kind: "Function",
          shapeId,
          return: returnType,
          isConstructor: false,
        }),
      );
      equations.push(equation(left, returnType));
      break;
    }

    case "TaggedTemplateExpression": {
      const returnType = makeType();
      /*
       * TODO: callee could be a hook or a function, so this type equation isn't correct.
       * We should change Hook to a subtype of Function or change unifier logic.
       * (see https://github.com/facebook/react-forget/pull/1427)
       */
      equations.push(
        equation(value.tag.identifier.type, {
          kind: "Function",
          shapeId: null,
          return: returnType,
          isConstructor: false,
        }),
      );
      equations.push(equation(left, returnType));
      break;
    }

    case "ObjectExpression": {
      for (const property of value.properties) {
        if (property.kind === "ObjectProperty" && property.key.kind === "computed") {
          equations.push(
            equation(property.key.name.identifier.type, {
              kind: "Primitive",
            }),
          );
        }
      }
      equations.push(equation(left, { kind: "Object", shapeId: BuiltInObjectId }));
      break;
    }

    case "ArrayExpression": {
      equations.push(equation(left, { kind: "Object", shapeId: BuiltInArrayId }));
      break;
    }

    case "PropertyLoad": {
      equations.push(
        equation(left, {
          kind: "Property",
          objectType: value.object.identifier.type,
          objectName: getName(names, value.object.identifier.id),
          propertyName: {
            kind: "literal",
            value: value.property,
          },
        }),
      );
      break;
    }

    case "ComputedLoad": {
      equations.push(
        equation(left, {
          kind: "Property",
          objectType: value.object.identifier.type,
          objectName: getName(names, value.object.identifier.id),
          propertyName: {
            kind: "computed",
            value: value.property.identifier.type,
          },
        }),
      );
      break;
    }
    case "MethodCall": {
      const returnType = makeType();
      equations.push(
        equation(value.property.identifier.type, {
          kind: "Function",
          return: returnType,
          shapeId: null,
          isConstructor: false,
        }),
      );

      equations.push(equation(left, returnType));
      break;
    }

    case "Destructure": {
      const pattern = value.lvalue.pattern;
      if (pattern.kind === "ArrayPattern") {
        for (const [index, item] of pattern.items.entries()) {
          if (item.kind === "Identifier") {
            // To simulate tuples we use properties with `String(<index>)`, eg "0".
            const propertyName = String(index);
            equations.push(
              equation(item.identifier.type, {
                kind: "Property",
                objectType: value.value.identifier.type,
                objectName: getName(names, value.value.identifier.id),
                propertyName: {
                  kind: "literal",
                  value: makePropertyLiteral(propertyName),
                },
              }),
            );
          } else if (item.kind === "Spread") {
            // Array pattern spread always creates an array
            equations.push(
              equation(item.place.identifier.type, {
                kind: "Object",
                shapeId: BuiltInArrayId,
              }),
            );
          }
        }
      } else {
        for (const property of pattern.properties) {
          if (
            property.kind === "ObjectProperty" &&
            (property.key.kind === "identifier" || property.key.kind === "string")
          ) {
            equations.push(
              equation(property.place.identifier.type, {
                kind: "Property",
                objectType: value.value.identifier.type,
                objectName: getName(names, value.value.identifier.id),
                propertyName: {
                  kind: "literal",
                  value: makePropertyLiteral(property.key.name),
                },
              }),
            );
          }
        }
      }
      break;
    }

    case "TypeCastExpression": {
      equations.push(equation(left, value.value.identifier.type));
      break;
    }

    case "PropertyDelete":
    case "ComputedDelete": {
      equations.push(equation(left, { kind: "Primitive" }));
      break;
    }

    case "FunctionExpression": {
      generate(value.loweredFunc.func, equations);
      equations.push(
        equation(left, {
          kind: "Function",
          shapeId: BuiltInFunctionId,
          return: value.loweredFunc.func.returns.identifier.type,
          isConstructor: false,
        }),
      );
      break;
    }

    case "NextPropertyOf": {
      equations.push(equation(left, { kind: "Primitive" }));
      break;
    }

    case "ObjectMethod": {
      generate(value.loweredFunc.func, equations);
      equations.push(equation(left, { kind: "ObjectMethod" }));
      break;
    }

    case "JsxExpression":
    case "JsxFragment": {
      if (env.config.enableTreatRefLikeIdentifiersAsRefs && value.kind === "JsxExpression") {
        for (const prop of value.props) {
          if (prop.kind === "JsxAttribute" && prop.name === "ref") {
            equations.push(
              equation(prop.place.identifier.type, {
                kind: "Object",
                shapeId: BuiltInUseRefId,
              }),
            );
          }
        }
      }
      equations.push(equation(left, { kind: "Object", shapeId: BuiltInJsxId }));
      break;
    }
    case "NewExpression": {
      const returnType = makeType();
      equations.push(
        equation(value.callee.identifier.type, {
          kind: "Function",
          return: returnType,
          shapeId: null,
          isConstructor: true,
        }),
      );

      equations.push(equation(left, returnType));
      break;
    }
    case "PropertyStore": {
      /**
       * Infer types based on assignments to known object properties
       * This is important for refs, where assignment to `<maybeRef>.current`
       * can help us infer that an object itself is a ref
       */
      equations.push(
        equation(
          /**
           * Our property type declarations are best-effort and we haven't tested
           * using them to drive inference of rvalues from lvalues. We want to emit
           * a Property type in order to infer refs from `.current` accesses, but
           * stay conservative by not otherwise inferring anything about rvalues.
           * So we use a dummy type here.
           *
           * TODO: consider using the rvalue type here
           */
          makeType(),
          // unify() only handles properties in the second position
          {
            kind: "Property",
            objectType: value.object.identifier.type,
            objectName: getName(names, value.object.identifier.id),
            propertyName: {
              kind: "literal",
              value: value.property,
            },
          },
        ),
      );
      break;
    }
    case "DeclareLocal":
    case "RegExpLiteral":
    case "MetaProperty":
    case "ComputedStore":
    case "Await":
    case "GetIterator":
    case "IteratorNext":
    case "UnsupportedNode":
    case "Debugger":
    case "FinishMemoize":
    case "StartMemoize": {
      break;
    }
    default:
      assertExhaustive(value, "Unhandled instruction value kind");
  }
};

type Substitution = Map<TypeId, Type>;
class Unifier {
  substitutions: Substitution = new Map();
  env: Environment;

  constructor(env: Environment) {
    this.env = env;
  }

  unify(typeA: Type, typeB: Type): void {
    if (typeB.kind === "Property") {
      if (this.env.config.enableTreatRefLikeIdentifiersAsRefs && isRefLikeName(typeB)) {
        this.unify(typeB.objectType, {
          kind: "Object",
          shapeId: BuiltInUseRefId,
        });
        this.unify(typeA, {
          kind: "Object",
          shapeId: BuiltInRefValueId,
        });
        return;
      }
      const objectType = this.get(typeB.objectType);
      const propertyType =
        typeB.propertyName.kind === "literal"
          ? this.env.getPropertyType(objectType, typeB.propertyName.value)
          : this.env.getFallthroughPropertyType(objectType, typeB.propertyName.value);
      if (propertyType !== null) {
        this.unify(typeA, propertyType);
      }
      /*
       * We do not error if tB is not a known object or function (even if it
       * is a primitive), since JS implicit conversion to objects
       */
      return;
    }

    if (typeEquals(typeA, typeB)) {
      return;
    }

    if (typeA.kind === "Type") {
      this.bindVariableTo(typeA, typeB);
      return;
    }

    if (typeB.kind === "Type") {
      this.bindVariableTo(typeB, typeA);
      return;
    }

    if (
      typeB.kind === "Function" &&
      typeA.kind === "Function" &&
      typeA.isConstructor === typeB.isConstructor
    ) {
      this.unify(typeA.return, typeB.return);
      return;
    }
  }

  bindVariableTo(variable: TypeVar, type: Type): void {
    if (type.kind === "Poly") {
      //  Ignore PolyType, since we don't support polymorphic types correctly.
      return;
    }

    const variableSubstitution = this.substitutions.get(variable.id);
    if (variableSubstitution !== undefined) {
      this.unify(variableSubstitution, type);
      return;
    }

    const typeSubstitution = type.kind === "Type" ? this.substitutions.get(type.id) : undefined;
    if (typeSubstitution !== undefined) {
      this.unify(variable, typeSubstitution);
      return;
    }

    if (type.kind === "Phi") {
      CompilerError.invariant(type.operands.length > 0, {
        reason: "there should be at least one operand",
        loc: GeneratedSource,
      });

      let candidateType: Type | null = null;
      for (const operand of type.operands) {
        const resolved = this.get(operand);
        if (candidateType === null) {
          candidateType = resolved;
        } else if (!typeEquals(resolved, candidateType)) {
          const unionType = tryUnionTypes(resolved, candidateType);
          if (unionType === null) {
            candidateType = null;
            break;
          }
          candidateType = unionType;
        } // else same type, continue
      }

      if (candidateType !== null) {
        this.unify(variable, candidateType);
        return;
      }
    }

    if (this.occursCheck(variable, type)) {
      const resolvedType = this.tryResolveType(variable, type);
      if (resolvedType !== null) {
        this.substitutions.set(variable.id, resolvedType);
        return;
      }
      throw new Error("cycle detected");
    }

    this.substitutions.set(variable.id, type);
  }

  tryResolveType(variable: TypeVar, type: Type): Type | null {
    switch (type.kind) {
      case "Phi": {
        /**
         * Resolve the type of the phi by recursively removing `v` as an operand.
         * For example we can end up with types like this:
         *
         * v = Phi [
         *   T1
         *   T2
         *   Phi [
         *     T3
         *     Phi [
         *       T4
         *       v <-- cycle!
         *     ]
         *   ]
         * ]
         *
         * By recursively removing `v`, we end up with:
         *
         * v = Phi [
         *   T1
         *   T2
         *   Phi [
         *     T3
         *     Phi [
         *       T4
         *     ]
         *   ]
         * ]
         *
         * Which avoids the cycle
         */
        const operands: Array<Type> = [];
        for (const operand of type.operands) {
          if (operand.kind === "Type" && operand.id === variable.id) {
            continue;
          }
          const resolved = this.tryResolveType(variable, operand);
          if (resolved === null) {
            return null;
          }
          operands.push(resolved);
        }
        return { kind: "Phi", operands };
      }
      case "Type": {
        const substitution = this.get(type);
        if (substitution !== type) {
          const resolved = this.tryResolveType(variable, substitution);
          if (resolved !== null) {
            this.substitutions.set(type.id, resolved);
          }
          return resolved;
        }
        return type;
      }
      case "Property": {
        const objectType = this.tryResolveType(variable, this.get(type.objectType));
        if (objectType === null) {
          return null;
        }
        return {
          kind: "Property",
          objectName: type.objectName,
          objectType,
          propertyName: type.propertyName,
        };
      }
      case "Function": {
        const returnType = this.tryResolveType(variable, this.get(type.return));
        if (returnType === null) {
          return null;
        }
        return {
          kind: "Function",
          return: returnType,
          shapeId: type.shapeId,
          isConstructor: type.isConstructor,
        };
      }
      case "ObjectMethod":
      case "Object":
      case "Primitive":
      case "Poly": {
        return type;
      }
      default: {
        return assertExhaustive(type, "Unexpected type kind");
      }
    }
  }

  occursCheck(variable: TypeVar, type: Type): boolean {
    if (typeEquals(variable, type)) return true;

    const substitution = type.kind === "Type" ? this.substitutions.get(type.id) : undefined;
    if (substitution !== undefined) {
      return this.occursCheck(variable, substitution);
    }

    if (type.kind === "Phi") {
      return type.operands.some((operand) => this.occursCheck(variable, operand));
    }

    if (type.kind === "Function") {
      return this.occursCheck(variable, type.return);
    }

    return false;
  }

  get(type: Type): Type {
    const substitution = type.kind === "Type" ? this.substitutions.get(type.id) : undefined;
    if (substitution !== undefined) {
      return this.get(substitution);
    }

    if (type.kind === "Phi") {
      return { kind: "Phi", operands: type.operands.map((operand) => this.get(operand)) };
    }

    if (type.kind === "Function") {
      return {
        kind: "Function",
        isConstructor: type.isConstructor,
        shapeId: type.shapeId,
        return: this.get(type.return),
      };
    }

    return type;
  }
}

const RefLikeNameRE = /^(?:[a-zA-Z$_][a-zA-Z$_0-9]*)Ref$|^ref$/;

const isRefLikeName = (type: PropType): boolean =>
  type.propertyName.kind === "literal" &&
  RefLikeNameRE.test(type.objectName) &&
  type.propertyName.value === "current";

const tryUnionTypes = (firstType: Type, secondType: Type): Type | null => {
  const isFirstReadonly =
    firstType.kind === "Object" && firstType.shapeId === BuiltInMixedReadonlyId;
  const isSecondReadonly =
    secondType.kind === "Object" && secondType.shapeId === BuiltInMixedReadonlyId;
  if (!isFirstReadonly && !isSecondReadonly) {
    return null;
  }
  const readonlyType = isFirstReadonly ? firstType : secondType;
  const otherType = isFirstReadonly ? secondType : firstType;
  if (otherType.kind === "Primitive") {
    /**
     * Union(Primitive | MixedReadonly) = MixedReadonly
     *
     * For example, `data ?? null` could return `data`, the fact that RHS
     * is a primitive doesn't guarantee the result is a primitive.
     */
    return readonlyType;
  }
  if (otherType.kind === "Object" && otherType.shapeId === BuiltInArrayId) {
    /**
     * Union(Array | MixedReadonly) = Array
     *
     * In practice this pattern means the result is always an array. Given
     * that this behavior requires opting-in to the mixedreadonly type
     * (via moduleTypeProvider) this seems like a reasonable heuristic.
     */
    return otherType;
  }
  return null;
};
