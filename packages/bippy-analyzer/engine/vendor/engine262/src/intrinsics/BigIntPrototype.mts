import {
  ObjectValue, BigIntValue, Value,
  type Arguments,
  type FunctionCallContext,
} from '../value.mts';
import {
  Q, type ValueCompletion, type ValueEvaluator,
} from '../completion.mts';
import { bootstrapPrototype } from './bootstrap.mts';
import {
  Assert, SnapToInteger,
  Throw,
} from '#self';
import type { Integer, Realm } from '#self';

/** https://tc39.es/ecma262/#sec-thisbigintvalue */
export function ThisBigIntValue(value: Value) {
  // 1. If Type(value) is BigInt, return value.
  if (value instanceof BigIntValue) {
    return value;
  }
  // 2. If Type(value) is Object and value has a [[BigIntData]] internal slot, then
  if (value instanceof ObjectValue && 'BigIntData' in value) {
    // a. Assert: Type(value.[[BigIntData]]) is BigInt.
    Assert(typeof value.BigIntData === 'bigint');
    // b. Return value.[[BigIntData]].
    return Value(value.BigIntData);
  }
  // 3. Throw a TypeError exception.
  return Throw.TypeError('$1 is not a $2 object', value, 'BigInt');
}

/** https://tc39.es/ecma262/#sec-bigint.prototype.tolocalestring */
function BigIntProto_toLocaleString(args: Arguments, context: FunctionCallContext): ValueEvaluator {
  return BigIntProto_toString(args, context);
}

/** https://tc39.es/ecma262/#sec-bigint.prototype.tostring */
function* BigIntProto_toString([radix = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const x = Q(ThisBigIntValue(thisValue));
  let radixMV: Integer;
  if (radix === Value.undefined) {
    radixMV = 10n;
  } else {
    radixMV = Q(yield* SnapToInteger(radix, 'truncate', 2n, 36n));
  }
  return Value(BigIntValue.toString(x, radixMV));
}

/** https://tc39.es/ecma262/#sec-bigint.prototype.tostring */
function BigIntProto_valueOf(_args: Arguments, { thisValue }: FunctionCallContext): ValueCompletion {
  // Return ? thisBigIntValue(this value).
  return Q(ThisBigIntValue(thisValue));
}

export function bootstrapBigIntPrototype(realmRec: Realm) {
  const proto = bootstrapPrototype(realmRec, [
    ['toLocaleString', BigIntProto_toLocaleString, 0],
    ['toString', BigIntProto_toString, 0],
    ['valueOf', BigIntProto_valueOf, 0],
  ], realmRec.Intrinsics['%Object.prototype%'], 'BigInt');

  realmRec.Intrinsics['%BigInt.prototype%'] = proto;
}
