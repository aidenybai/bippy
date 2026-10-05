import { Evaluate, type ValueEvaluator } from '../evaluator.mts';
import { Q } from '../completion.mts';
import {
  Value, ReferenceRecord, UndefinedValue, BigIntValue, BooleanValue, JSStringValue, NullValue, NumberValue, ObjectValue, SymbolValue,
} from '../value.mts';
import { __ts_cast__, OutOfRange } from '../utils/language.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { surroundingAgent, EnvironmentRecord } from '#self';
import {
  Assert,
  GetValue,
  IsCallable,
  IsPropertyReference,
  IsSuperReference,
  IsUnresolvableReference,
  ToBoolean,
  ToNumber,
  ToObject,
  ToNumeric,
  type PropertyReference,
  IsPropertyKey,
  IsPrivateReference,
  ToPropertyKey,
  Throw,
} from '#self';

/** https://tc39.es/ecma262/#sec-delete-operator-runtime-semantics-evaluation */
//   UnaryExpression : `delete` UnaryExpression
function* Evaluate_UnaryExpression_Delete({ UnaryExpression }: ParseNode.UnaryExpression): ValueEvaluator {
  // 1. Let ref be the result of evaluating UnaryExpression.
  const ref = Q(yield* Evaluate(UnaryExpression));
  Q(ref);
  // 3. If ref is not a Reference Record, return true.
  if (!(ref instanceof ReferenceRecord)) {
    return Value.true;
  }
  // 4. If IsUnresolvableReference(ref) is true, then
  if (IsUnresolvableReference(ref)) {
    // a. Assert: ref.[[Strict]] is false.
    Assert(!ref.Strict);
    // b. Return true.
    return Value.true;
  }
  // 5. If IsPropertyReference(ref) is true, then
  if (IsPropertyReference(ref)) {
    __ts_cast__<PropertyReference>(ref);
    // a. Assert: IsPrivateReference(ref) is false.
    Assert(!IsPrivateReference(ref));
    // b. If IsSuperReference(ref) is true, throw a ReferenceError exception.
    if (IsSuperReference(ref)) {
      return Throw.ReferenceError('Cannot delete a super property');
    }
    // c. Let baseObj be ? ToObject(ref.[[Base]]).
    const baseObj = Q(ToObject(ref.Base as Value));
    // d. If ref.[[ReferencedName]] is not a property key, then
    if (!IsPropertyKey(ref.ReferencedName)) {
      // Set ref.[[ReferencedName]] to ? ToPropertyKey(ref.[[ReferencedName]]).
      ref.ReferencedName = Q(yield* ToPropertyKey(ref.ReferencedName as Value));
    }
    // e. Let deleteStatus be ? baseObj.[[Delete]](ref.[[ReferencedName]]).
    const deleteStatus = Q(yield* baseObj.Delete(ref.ReferencedName));
    // f. If deleteStatus is false and ref.[[Strict]] is true, throw a TypeError exception.
    if (!deleteStatus && ref.Strict) {
      return Throw.TypeError('Cannot not delete property $1 on $2', ref.ReferencedName, baseObj);
    }
    // g. Return deleteStatus.
    return Value(deleteStatus);
  } else { // 6. Else,
    // a. Let base be ref.[[Base]].
    const base = ref.Base;
    // b. Assert: base is an Environment Record.
    Assert(base instanceof EnvironmentRecord);
    // c. Return ? bindings.DeleteBinding(GetReferencedName(ref)).
    return Value(Q(yield* base.DeleteBinding((ref.ReferencedName as JSStringValue).stringValue())));
  }
}

/** https://tc39.es/ecma262/#sec-void-operator-runtime-semantics-evaluation */
//   UnaryExpression : `void` UnaryExpression
function* Evaluate_UnaryExpression_Void({ UnaryExpression }: ParseNode.UnaryExpression): ValueEvaluator {
  // 1. Let expr be the result of evaluating UnaryExpression.
  const expr = Q(yield* Evaluate(UnaryExpression));
  // 2. Perform ? GetValue(expr).
  Q(yield* GetValue(expr));
  // 3. Return undefined.
  return Value.undefined;
}

/** https://tc39.es/ecma262/#sec-typeof-operator-runtime-semantics-evaluation */
// UnaryExpression : `typeof` UnaryExpression
function* Evaluate_UnaryExpression_Typeof({ UnaryExpression }: ParseNode.UnaryExpression): ValueEvaluator {
  // 1. Let val be the result of evaluating UnaryExpression.
  const _val = Q(yield* Evaluate(UnaryExpression));
  // 2. If Type(val) is Reference, then
  if (_val instanceof ReferenceRecord) {
    // a. If IsUnresolvableReference(val) is true, return "undefined".
    if (IsUnresolvableReference(_val)) {
      return Value('undefined');
    }
  }
  // 3. Set val to ? GetValue(val).
  const val = Q(yield* GetValue(_val));
  // 4. Return a String according to Table 37.
  if (val instanceof UndefinedValue) {
    return Value('undefined');
  } else if (val instanceof NullValue) {
    return Value('object');
  } else if (val instanceof BooleanValue) {
    return Value('boolean');
  } else if (val instanceof NumberValue) {
    return Value('number');
  } else if (val instanceof JSStringValue) {
    return Value('string');
  } else if (val instanceof BigIntValue) {
    return Value('bigint');
  } else if (val instanceof SymbolValue) {
    return Value('symbol');
  } else if (val instanceof ObjectValue) {
    if (IsCallable(val)) {
      return Value('function');
    }
    return Value('object');
  }
  throw OutOfRange.exhaustive(val);
}

/** https://tc39.es/ecma262/#sec-unary-plus-operator-runtime-semantics-evaluation */
//   UnaryExpression : `+` UnaryExpression
function* Evaluate_UnaryExpression_Plus({ UnaryExpression }: ParseNode.UnaryExpression): ValueEvaluator {
  // 1. Let expr be the result of evaluating UnaryExpression.
  const expr = Q(yield* Evaluate(UnaryExpression));
  // 2. Return ? ToNumber(? GetValue(expr)).
  return Q(yield* ToNumber(Q(yield* GetValue(expr))));
}

/** https://tc39.es/ecma262/#sec-unary-minus-operator-runtime-semantics-evaluation */
//   UnaryExpression : `-` UnaryExpression
function* Evaluate_UnaryExpression_Minus({ UnaryExpression }: ParseNode.UnaryExpression): ValueEvaluator {
  // 1. Let expr be the result of evaluating UnaryExpression.
  const expr = Q(yield* Evaluate(UnaryExpression));
  // 2. Let oldValue be ? ToNumeric(? GetValue(expr)).
  const oldValue = Q(yield* ToNumeric(Q(yield* GetValue(expr))));
  // 3. If oldValue is a Number, then
  if (oldValue instanceof NumberValue) {
    // a. Return Number::unaryMinus(oldValue).
    return NumberValue.unaryMinus(oldValue);
  } else {
    // a. Assert: oldValue is a BigInt.
    // b. Return BigInt::unaryMinus(oldValue).
    Assert(oldValue instanceof BigIntValue);
    return BigIntValue.unaryMinus(oldValue);
  }
}

/** https://tc39.es/ecma262/#sec-bitwise-not-operator-runtime-semantics-evaluation */
//   UnaryExpression : `~` UnaryExpression
function* Evaluate_UnaryExpression_Tilde({ UnaryExpression }: ParseNode.UnaryExpression): ValueEvaluator {
  // 1. Let expr be the result of evaluating UnaryExpression.
  const expr = Q(yield* Evaluate(UnaryExpression));
  // 2. Let oldValue be ? ToNumeric(? GetValue(expr)).
  const oldValue = Q(yield* ToNumeric(Q(yield* GetValue(expr))));
  // 3. If oldValue is a Number, then
  if (oldValue instanceof NumberValue) {
    // a. Return Number::bitwiseNOT(oldValue).
    return NumberValue.bitwiseNOT(oldValue);
  } else {
    // a. Assert: oldValue is a BigInt.
    // b. Return BigInt::bitwiseNOT(oldValue).
    Assert(oldValue instanceof BigIntValue);
    return BigIntValue.bitwiseNOT(oldValue);
  }
}

/** https://tc39.es/ecma262/#sec-logical-not-operator-runtime-semantics-evaluation */
//   UnaryExpression : `!` UnaryExpression
function* Evaluate_UnaryExpression_Bang({ UnaryExpression }: ParseNode.UnaryExpression): ValueEvaluator {
  // 1. Let expr be the result of evaluating UnaryExpression.
  const expr = Q(yield* Evaluate(UnaryExpression));
  // 2. Let oldValue be ! ToBoolean(? GetValue(expr)).
  const oldValue = ToBoolean(Q(yield* GetValue(expr)));
  // 3. If oldValue is true, return false.
  if (oldValue) {
    return Value.false;
  }
  // 4. Return true.
  return Value.true;
}

// UnaryExpression :
//  `delete` UnaryExpression
//  `void` UnaryExpression
//  `typeof` UnaryExpression
//  `+` UnaryExpression
//  `-` UnaryExpression
//  `~` UnaryExpression
//  `!` UnaryExpression
export function* Evaluate_UnaryExpression(UnaryExpression: ParseNode.UnaryExpression): ValueEvaluator {
  switch (UnaryExpression.operator) {
    case 'delete':
      Q(surroundingAgent.debugger_cannotPreview);
      return yield* Evaluate_UnaryExpression_Delete(UnaryExpression);
    case 'void':
      return yield* Evaluate_UnaryExpression_Void(UnaryExpression);
    case 'typeof':
      return yield* Evaluate_UnaryExpression_Typeof(UnaryExpression);
    case '+':
      return yield* Evaluate_UnaryExpression_Plus(UnaryExpression);
    case '-':
      return yield* Evaluate_UnaryExpression_Minus(UnaryExpression);
    case '~':
      return yield* Evaluate_UnaryExpression_Tilde(UnaryExpression);
    case '!':
      return yield* Evaluate_UnaryExpression_Bang(UnaryExpression);

    default:
      throw OutOfRange.nonExhaustive(UnaryExpression);
  }
}
