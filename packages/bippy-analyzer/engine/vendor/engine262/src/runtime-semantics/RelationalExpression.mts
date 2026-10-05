import { StringValue } from '../static-semantics/all.mts';
import {
  ObjectValue,
  Value,
  wellKnownSymbols,
} from '../value.mts';
import { Q, X } from '../completion.mts';
import { Evaluate } from '../evaluator.mts';
import { OutOfRange } from '../utils/language.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import {
  IsLessThan,
  Call,
  GetMethod,
  GetValue,
  HasProperty,
  IsCallable,
  OrdinaryHasInstance,
  ToBoolean,
  ToPropertyKey,
  PrivateElementFind,
  Throw,
  surroundingAgent,
  type ValueEvaluator,
  BooleanValue,
  UndefinedValue,
} from '#self';
import { ResolvePrivateIdentifier, type PrivateEnvironmentRecord } from '#self';

/** https://tc39.es/ecma262/#sec-instanceofoperator */
export function* InstanceofOperator(V: Value, target: Value) {
  // 1. If Type(target) is not Object, throw a TypeError exception.
  if (!(target instanceof ObjectValue)) {
    return Throw.TypeError('Right-hand side of "instanceof" ($1) is not an object', target);
  }
  // 2. Let instOfHandler be ? GetMethod(target, @@hasInstance).
  const instOfHandler = Q(yield* GetMethod(target, wellKnownSymbols.hasInstance));
  // 3. If instOfHandler is not undefined, then
  if (instOfHandler !== Value.undefined) {
    // a. Return ! ToBoolean(? Call(instOfHandler, target, « V »)).
    return X(ToBoolean(Q(yield* Call(instOfHandler, target, [V]))));
  }
  // 4. If IsCallable(target) is false, throw a TypeError exception.
  if (!IsCallable(target)) {
    return Throw.TypeError('Right-hand side of "instanceof" ($1) is not a function', target);
  }
  // 5. Return ? OrdinaryHasInstance(target, V).
  return Q(yield* OrdinaryHasInstance(target, V));
}

// RelationalExpression : PrivateIdentifier `in` ShiftExpression
export function* Evaluate_RelationalExpression_PrivateIdentifier({ PrivateIdentifier, ShiftExpression }: ParseNode.RelationalExpression) {
  // 1. Let privateIdentifier be the StringValue of PrivateIdentifier.
  const privateIdentifier = StringValue(PrivateIdentifier!);
  // 2. Let rref be the result of evaluating ShiftExpression.
  const rref = Q(yield* Evaluate(ShiftExpression));
  // 3. Let rval be ? GetValue(rref).
  const rval = Q(yield* GetValue(rref));
  // 4. If Type(rval) is not Object, throw a TypeError exception.
  if (!(rval instanceof ObjectValue)) {
    return Throw.TypeError('Right-hand side of "in" ($1) is not an object', rval);
  }
  // 5. Let privateEnv be the running execution context's PrivateEnvironment.
  const privateEnv = surroundingAgent.runningExecutionContext.PrivateEnvironment as PrivateEnvironmentRecord;
  // 6. Let privateName be ! ResolvePrivateIdentifier(privateEnv, privateIdentifier).
  const privateName = X(ResolvePrivateIdentifier(privateEnv, privateIdentifier));
  // 7. If ! PrivateElementFind(privateName, rval) is not empty, return true.
  if (X(PrivateElementFind(privateName, rval)) !== undefined) {
    return Value.true;
  }
  // 8. Return false.
  return Value.false;
}

/** https://tc39.es/ecma262/#sec-relational-operators-runtime-semantics-evaluation */
//   RelationalExpression :
//     RelationalExpression `<` ShiftExpression
//     RelationalExpression `>` ShiftExpression
//     RelationalExpression `<=` ShiftExpression
//     RelationalExpression `>=` ShiftExpression
//     RelationalExpression `instanceof` ShiftExpression
//     RelationalExpression `in` ShiftExpression
//     PrivateIdentifier `in` ShiftExpression
export function* Evaluate_RelationalExpression(expr: ParseNode.RelationalExpression): ValueEvaluator<BooleanValue | UndefinedValue> {
  if (expr.PrivateIdentifier) {
    return yield* Evaluate_RelationalExpression_PrivateIdentifier(expr);
  }

  const { RelationalExpression, operator, ShiftExpression } = expr;

  // 1. Let lref be the result of evaluating RelationalExpression.
  const lref = Q(yield* Evaluate(RelationalExpression!));
  // 2. Let lval be ? GetValue(lref).
  const lval = Q(yield* GetValue(lref));
  // 3. Let rref be the result of evaluating ShiftExpression.
  const rref = Q(yield* Evaluate(ShiftExpression));
  // 4. Let rval be ? GetValue(rref).
  const rval = Q(yield* GetValue(rref));
  switch (operator) {
    case '<': {
      // 5. Let r be the result of performing Abstract Relational Comparison lval < rval.
      const r = Q(yield* IsLessThan(lval, rval));
      // 7. If r is undefined, return false. Otherwise, return r.
      if (r === undefined) {
        return Value.false;
      }
      return Value(r);
    }
    case '>': {
      // 5. Let r be the result of performing Abstract Relational Comparison rval < lval with LeftFirst equal to false.
      const r = Q(yield* IsLessThan(rval, lval, false));
      // 7. If r is undefined, return false. Otherwise, return r.
      if (r === undefined) {
        return Value.false;
      }
      return Value(r);
    }
    case '<=': {
      // 5. Let r be the result of performing Abstract Relational Comparison rval < lval with LeftFirst equal to false.
      const r = Q(yield* IsLessThan(rval, lval, false));
      // 7. If r is true or undefined, return false. Otherwise, return true.
      if (r === true || r === undefined) {
        return Value.false;
      }
      return Value.true;
    }
    case '>=': {
      // 5. Let r be the result of performing Abstract Relational Comparison lval < rval.
      const r = Q(yield* IsLessThan(lval, rval));
      // 7. If r is true or undefined, return false. Otherwise, return true.
      if (r === true || r === undefined) {
        return Value.false;
      }
      return Value.true;
    }
    case 'instanceof':
      // 5. Return ? InstanceofOperator(lval, rval).
      return Value(Q(yield* InstanceofOperator(lval, rval)));
    case 'in':
      // 5. Return ? InstanceofOperator(lval, rval).
      if (!(rval instanceof ObjectValue)) {
        return Throw.TypeError('Right-hand side of "in" ($1) is not an object', rval);
      }
      // 6. Return ? HasProperty(rval, ? ToPropertyKey(lval)).
      return Value(Q(yield* HasProperty(rval, Q(yield* ToPropertyKey(lval)))));
    default:
      throw OutOfRange.exhaustive(operator);
  }
}
