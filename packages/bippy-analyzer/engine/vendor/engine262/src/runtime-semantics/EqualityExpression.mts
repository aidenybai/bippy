import { Q, X } from '../completion.mts';
import { Evaluate, type ValueEvaluator } from '../evaluator.mts';
import { Value } from '../value.mts';
import { OutOfRange } from '../utils/language.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import {
  IsLooselyEqual,
  GetValue,
  IsStrictlyEqual,
  BooleanValue,
} from '#self';

/** https://tc39.es/ecma262/#sec-equality-operators-runtime-semantics-evaluation */
//   EqualityExpression :
//     EqualityExpression `==` RelationalExpression
//     EqualityExpression `!=` RelationalExpression
//     EqualityExpression `===` RelationalExpression
//     EqualityExpression `!==` RelationalExpression
export function* Evaluate_EqualityExpression({ EqualityExpression, operator, RelationalExpression }: ParseNode.EqualityExpression): ValueEvaluator<BooleanValue> {
  // 1. Let lref be the result of evaluating EqualityExpression.
  const lref = Q(yield* Evaluate(EqualityExpression));
  // 2. Let lval be ? GetValue(lref).
  const lval = Q(yield* GetValue(lref));
  // 3. Let rref be the result of evaluating RelationalExpression.
  const rref = Q(yield* Evaluate(RelationalExpression));
  // 4. Let rval be ? GetValue(rref).
  const rval = Q(yield* GetValue(rref));
  switch (operator) {
    case '==':
      // 5. Return the result of performing Abstract Equality Comparison rval == lval.
      return Value(Q(yield* IsLooselyEqual(rval, lval)));
    case '!=': {
      // 5. Let r be the result of performing Abstract Equality Comparison rval == lval.
      const r = Q(yield* IsLooselyEqual(rval, lval));
      // 7. If r is true, return false. Otherwise, return true.
      if (r) {
        return Value.false;
      } else {
        return Value.true;
      }
    }
    case '===':
      // 5. Return the result of performing Strict Equality Comparison rval === lval.
      return Value(IsStrictlyEqual(rval, lval));
    case '!==': {
      // 5. Let r be the result of performing Strict Equality Comparison rval === lval.
      // 6. Assert: r is a normal completion.
      const r = X(IsStrictlyEqual(rval, lval));
      // 7. If r.[[Value]] is true, return false. Otherwise, return true.
      if (r) {
        return Value.false;
      } else {
        return Value.true;
      }
    }

    default:
      throw OutOfRange.exhaustive(operator);
  }
}
