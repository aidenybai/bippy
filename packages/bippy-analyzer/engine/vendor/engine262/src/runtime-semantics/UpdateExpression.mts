import { Evaluate, type ValueEvaluator } from '../evaluator.mts';
import { OutOfRange } from '../utils/language.mts';
import { BigIntValue, NumberValue } from '../value.mts';
import { Q } from '../completion.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import {
  Assert,
  F,
  GetValue,
  PutValue,
  ToNumeric,
  Z,
} from '#self';

type AnyNumericValue = BigIntValue | NumberValue;
// UpdateExpression :
//   LeftHandSideExpression `++`
//   LeftHandSideExpression `--`
//   `++` UnaryExpression
//   `--` UnaryExpression
export function* Evaluate_UpdateExpression({ LeftHandSideExpression, operator, UnaryExpression }: ParseNode.UpdateExpression): ValueEvaluator {
  switch (true) {
    // UpdateExpression : LeftHandSideExpression `++`
    // https://tc39.es/ecma262/#sec-postfix-increment-operator-runtime-semantics-evaluation
    case operator === '++' && !!LeftHandSideExpression: {
      // 1. Let lhs be the result of evaluating LeftHandSideExpression.
      const lhs = Q(yield* Evaluate(LeftHandSideExpression));
      // 2. Let oldValue be ? ToNumeric(? GetValue(lhs)).
      const oldValue = Q(yield* ToNumeric(Q(yield* GetValue(lhs))));
      // 3. If oldValue is a Number, then
      //  a. Let newValue be Number::add(oldValue, 1𝔽).
      //  4. Else,
      //         a. Assert: oldValue is a BigInt.
      //         b. Let newValue be BigInt::add(oldValue, 1ℤ).
      let newValue: AnyNumericValue;
      if (oldValue instanceof NumberValue) {
        newValue = NumberValue.add(oldValue, F(1));
      } else {
        Assert(oldValue instanceof BigIntValue);
        newValue = BigIntValue.add(oldValue, Z(1n));
      }
      // 4. Perform ? PutValue(lhs, newValue).
      Q(yield* PutValue(lhs, newValue));
      // 5. Return oldValue.
      return oldValue;
    }

    // UpdateExpression : LeftHandSideExpression `--`
    // https://tc39.es/ecma262/#sec-postfix-decrement-operator-runtime-semantics-evaluation
    case operator === '--' && !!LeftHandSideExpression: {
      // 1. Let lhs be the result of evaluating LeftHandSideExpression.
      const lhs = Q(yield* Evaluate(LeftHandSideExpression));
      // 2. Let oldValue be ? ToNumeric(? GetValue(lhs)).
      const oldValue = Q(yield* ToNumeric(Q(yield* GetValue(lhs))));
      // 3. If oldValue is a Number, then
      //  a. Let newValue be Number::subtract(oldValue, 1𝔽).
      //  4. Else,
      //         a. Assert: oldValue is a BigInt.
      //         b. Let newValue be BigInt::subtract(oldValue, 1ℤ).
      let newValue: AnyNumericValue;
      if (oldValue instanceof NumberValue) {
        newValue = NumberValue.subtract(oldValue, F(1));
      } else {
        Assert(oldValue instanceof BigIntValue);
        newValue = BigIntValue.subtract(oldValue, Z(1n));
      }
      // 4. Perform ? PutValue(lhs, newValue).
      Q(yield* PutValue(lhs, newValue));
      // 5. Return oldValue.
      return oldValue;
    }

    // UpdateExpression : `++` UnaryExpression
    // https://tc39.es/ecma262/#sec-prefix-increment-operator-runtime-semantics-evaluation
    case operator === '++' && !!UnaryExpression: {
      // 1. Let expr be the result of evaluating UnaryExpression.
      const expr = Q(yield* Evaluate(UnaryExpression));
      // 2. Let oldValue be ? ToNumeric(? GetValue(expr)).
      const oldValue = Q(yield* ToNumeric(Q(yield* GetValue(expr))));
      // 3. If oldValue is a Number, then
      //  a. Let newValue be Number::add(oldValue, 1𝔽).
      //  4. Else,
      //         a. Assert: oldValue is a BigInt.
      //         b. Let newValue be BigInt::add(oldValue, 1ℤ).
      let newValue: AnyNumericValue;
      if (oldValue instanceof NumberValue) {
        newValue = NumberValue.add(oldValue, F(1));
      } else {
        Assert(oldValue instanceof BigIntValue);
        newValue = BigIntValue.add(oldValue, Z(1n));
      }
      // 4. Perform ? PutValue(expr, newValue).
      Q(yield* PutValue(expr, newValue));
      // 5. Return newValue.
      return newValue;
    }

    // UpdateExpression : `--` UnaryExpression
    // https://tc39.es/ecma262/#sec-prefix-decrement-operator-runtime-semantics-evaluation
    case operator === '--' && !!UnaryExpression: {
      // 1. Let expr be the result of evaluating UnaryExpression.
      const expr = Q(yield* Evaluate(UnaryExpression));
      // 2. Let oldValue be ? ToNumeric(? GetValue(expr)).
      const oldValue = Q(yield* ToNumeric(Q(yield* GetValue(expr))));
      // 3. If oldValue is a Number, then
      //   a. Let newValue be Number::subtract(oldValue, 1𝔽).
      // 4. Else,
      //   a. Assert: oldValue is a BigInt.
      //   b. Let newValue be BigInt::subtract(oldValue, 1ℤ).
      let newValue: AnyNumericValue;
      if (oldValue instanceof NumberValue) {
        newValue = NumberValue.subtract(oldValue, F(1));
      } else {
        Assert(oldValue instanceof BigIntValue);
        newValue = BigIntValue.subtract(oldValue, Z(1n));
      }
      // 4. Perform ? PutValue(expr, newValue).
      Q(yield* PutValue(expr, newValue));
      // 5. Return newValue.
      return newValue;
    }

    default:
      throw OutOfRange.nonExhaustive(operator);
  }
}
