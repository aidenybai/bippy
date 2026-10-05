import {
  ObjectValue,
  Value,
  NumberValue,
  type Arguments,
  type FunctionCallContext,
} from '../value.mts';
import {
  Q, X, type ValueCompletion, type ValueEvaluator,
} from '../completion.mts';
import type { Mutable } from '../utils/language.mts';
import { bootstrapPrototype } from './bootstrap.mts';
import type { NumberObject } from './Number.mts';
import {
  Assert,
  SnapToInteger,
  ToIntegerOrInfinity,
  ToString,
  F, R,
  Realm,
  Throw,
  type Integer,
} from '#self';

export function ThisNumberValue(value: Value) {
  if (value instanceof NumberValue) {
    return value;
  }
  if (value instanceof ObjectValue && 'NumberData' in value) {
    const n = value.NumberData;
    Assert(n instanceof NumberValue);
    return n;
  }
  return Throw.TypeError('$1 is not a $2 object', value, 'Number');
}

/** https://tc39.es/ecma262/#sec-number.prototype.toexponential */
function* NumberProto_toExponential([fractionDigits = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const x = Q(ThisNumberValue(thisValue));
  const f = Q(yield* ToIntegerOrInfinity(fractionDigits));
  Assert(fractionDigits !== Value.undefined || f === 0);
  if (!x.isFinite()) {
    return Value(NumberValue.toString(x, 10n));
  }
  if (f < 0 || f > 100) {
    return Throw.RangeError('Invalid format range for $1', 'toExponential');
  }
  return Value(R(x).toExponential(fractionDigits === Value.undefined ? undefined : f));
}

/** https://tc39.es/ecma262/#sec-number.prototype.tofixed */
function* NumberProto_toFixed([fractionDigits = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const x = Q(ThisNumberValue(thisValue));
  const f = Q(yield* ToIntegerOrInfinity(fractionDigits));
  Assert(fractionDigits !== Value.undefined || f === 0);
  if (f < 0 || f > 100) {
    return Throw.RangeError('Invalid format range for $1', 'toFixed');
  }
  if (!x.isFinite()) {
    return Value(NumberValue.toString(x, 10n));
  }
  return Value(R(x).toFixed(f));
}

/** https://tc39.es/ecma262/#sec-number.prototype.tolocalestring */
function NumberProto_toLocaleString(_args: Arguments, context: FunctionCallContext): ValueEvaluator {
  return NumberProto_toString([], context);
}

/** https://tc39.es/ecma262/#sec-number.prototype.toprecision */
function* NumberProto_toPrecision([precision = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const x = Q(ThisNumberValue(thisValue));
  if (precision === Value.undefined) {
    return Value(X(ToString(x)));
  }
  const p = Q(yield* ToIntegerOrInfinity(precision));
  if (!x.isFinite()) {
    return Value(NumberValue.toString(x, 10n));
  }
  if (p < 1 || p > 100) {
    return Throw.RangeError('Invalid format range for $1', 'toPrecision');
  }
  return Value(R(x).toPrecision(p));
}

/** https://tc39.es/ecma262/#sec-number.prototype.tostring */
function* NumberProto_toString([radix = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const x = Q(ThisNumberValue(thisValue));
  let radixMV: Integer;
  if (radix === Value.undefined) {
    radixMV = 10n;
  } else {
    radixMV = Q(yield* SnapToInteger(radix, 'truncate', 2n, 36n));
  }
  return Value(NumberValue.toString(x, radixMV));
}

/** https://tc39.es/ecma262/#sec-number.prototype.valueof */
function NumberProto_valueOf(_args: Arguments, { thisValue }: FunctionCallContext): ValueCompletion {
  return Q(ThisNumberValue(thisValue));
}

export function bootstrapNumberPrototype(realmRec: Realm) {
  const proto = bootstrapPrototype(realmRec, [
    ['toExponential', NumberProto_toExponential, 1],
    ['toFixed', NumberProto_toFixed, 1],
    ['toLocaleString', NumberProto_toLocaleString, 0],
    ['toPrecision', NumberProto_toPrecision, 1],
    ['toString', NumberProto_toString, 1],
    ['valueOf', NumberProto_valueOf, 0],
  ], realmRec.Intrinsics['%Object.prototype%']);

  (proto as Mutable<NumberObject>).NumberData = F(+0);

  realmRec.Intrinsics['%Number.prototype%'] = proto;
}
