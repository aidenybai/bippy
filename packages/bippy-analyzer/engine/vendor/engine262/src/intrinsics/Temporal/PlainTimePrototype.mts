import { bootstrapPrototype } from '../bootstrap.mts';
import {
  GetRoundingIncrementOption, GetRoundingModeOption,
} from '../../abstract-ops/temporal/addition.mts';
import {
  GetTemporalFractionalSecondDigitsOption,
  GetTemporalOverflowOption,
  GetTemporalUnitValuedOption,
  IsPartialTemporalObject,
  MaximumTemporalDurationRoundingIncrement,
  type TemporalUnit,
  ToSecondsStringPrecisionRecord,
  ValidateTemporalRoundingIncrement,
  ValidateTemporalUnitValue,
  type TimeUnit,
} from '../../abstract-ops/temporal/temporal.mts';
import {
  AddDurationToTime,
  CompareTimeRecord,
  CreateTemporalTime,
  DifferenceTemporalPlainTime,
  RegulateTime,
  RoundTime,
  TimeRecordToString,
  ToTemporalTime,
  ToPartialTimeRecord,
} from '../../abstract-ops/temporal/plain-time.mts';
import type { TemporalPlainTimeObject } from './PlainTime.mts';
import {
  Assert,
  CreateDataPropertyOrThrow,
  F,
  GetOptionsObject,
  JSStringValue,
  ObjectValue,
  OrdinaryObjectCreate,
  Q,
  RequireInternalSlot,
  Throw,
  UndefinedValue,
  Value,
  X,
  type Arguments,
  type FunctionCallContext,
  type PlainCompletion,
  type Realm,
  type ValueEvaluator,
} from '#self';

function thisTemporalTimeValue(value: Value): PlainCompletion<TemporalPlainTimeObject> {
  Q(RequireInternalSlot(value, 'InitializedTemporalTime'));
  return value as TemporalPlainTimeObject;
}

/** https://tc39.es/proposal-temporal/#sec-get-temporal.plaintime.prototype.hour */
function PlainTimeProto_hourGetter(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const plainTime = Q(thisTemporalTimeValue(thisValue));
  return F(Number(plainTime.Time.Hour));
}

/** https://tc39.es/proposal-temporal/#sec-get-temporal.plaintime.prototype.minute */
function PlainTimeProto_minuteGetter(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const plainTime = Q(thisTemporalTimeValue(thisValue));
  return F(Number(plainTime.Time.Minute));
}

/** https://tc39.es/proposal-temporal/#sec-get-temporal.plaintime.prototype.second */
function PlainTimeProto_secondGetter(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const plainTime = Q(thisTemporalTimeValue(thisValue));
  return F(Number(plainTime.Time.Second));
}

/** https://tc39.es/proposal-temporal/#sec-get-temporal.plaintime.prototype.millisecond */
function PlainTimeProto_millisecondGetter(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const plainTime = Q(thisTemporalTimeValue(thisValue));
  return F(Number(plainTime.Time.Millisecond));
}

/** https://tc39.es/proposal-temporal/#sec-get-temporal.plaintime.prototype.microsecond */
function PlainTimeProto_microsecondGetter(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const plainTime = Q(thisTemporalTimeValue(thisValue));
  return F(Number(plainTime.Time.Microsecond));
}

/** https://tc39.es/proposal-temporal/#sec-get-temporal.plaintime.prototype.nanosecond */
function PlainTimeProto_nanosecondGetter(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const plainTime = Q(thisTemporalTimeValue(thisValue));
  return F(Number(plainTime.Time.Nanosecond));
}

/** https://tc39.es/proposal-temporal/#sec-temporal.plaintime.prototype.add */
function* PlainTimeProto_add([temporalDurationLike = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const plainTime = Q(thisTemporalTimeValue(thisValue));
  return Q(yield* AddDurationToTime('add', plainTime, temporalDurationLike));
}

/** https://tc39.es/proposal-temporal/#sec-temporal.plaintime.prototype.subtract */
function* PlainTimeProto_subtract([temporalDurationLike = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const plainTime = Q(thisTemporalTimeValue(thisValue));
  return Q(yield* AddDurationToTime('subtract', plainTime, temporalDurationLike));
}

/** https://tc39.es/proposal-temporal/#sec-temporal.plaintime.prototype.with */
function* PlainTimeProto_with([temporalTimeLike = Value.undefined, options = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const plainTime = Q(thisTemporalTimeValue(thisValue));
  if (!Q(yield* IsPartialTemporalObject(temporalTimeLike))) {
    return Throw.TypeError('$1 is not a partial Temporal object', temporalTimeLike);
  }
  const partialTime = Q(yield* ToPartialTimeRecord(temporalTimeLike as ObjectValue, 'partial'));
  const hour = partialTime.Hour ?? plainTime.Time.Hour;
  const minute = partialTime.Minute ?? plainTime.Time.Minute;
  const second = partialTime.Second ?? plainTime.Time.Second;
  const millisecond = partialTime.Millisecond ?? plainTime.Time.Millisecond;
  const microsecond = partialTime.Microsecond ?? plainTime.Time.Microsecond;
  const nanosecond = partialTime.Nanosecond ?? plainTime.Time.Nanosecond;
  const resolvedOptions = Q(GetOptionsObject(options));
  const overflow = Q(yield* GetTemporalOverflowOption(resolvedOptions));
  const result = Q(RegulateTime(hour, minute, second, millisecond, microsecond, nanosecond, overflow));
  return Q(yield* CreateTemporalTime(result));
}

/** https://tc39.es/proposal-temporal/#sec-temporal.plaintime.prototype.until */
function* PlainTimeProto_until([other = Value.undefined, options = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const plainTime = Q(thisTemporalTimeValue(thisValue));
  return Q(yield* DifferenceTemporalPlainTime('until', plainTime, other, options));
}

/** https://tc39.es/proposal-temporal/#sec-temporal.plaintime.prototype.since */
function* PlainTimeProto_since([other = Value.undefined, options = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const plainTime = Q(thisTemporalTimeValue(thisValue));
  return Q(yield* DifferenceTemporalPlainTime('since', plainTime, other, options));
}

/** https://tc39.es/proposal-temporal/#sec-temporal.plaintime.prototype.round */
function* PlainTimeProto_round([roundTo = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const plainTime = Q(thisTemporalTimeValue(thisValue));
  if (roundTo instanceof UndefinedValue) {
    return Throw.TypeError('Options parameter is required');
  }
  if (roundTo instanceof JSStringValue) {
    const paramString = roundTo;
    roundTo = OrdinaryObjectCreate(Value.null);
    X(CreateDataPropertyOrThrow(roundTo, 'smallestUnit', paramString));
  } else {
    roundTo = Q(GetOptionsObject(roundTo));
  }
  const roundingIncrement = Q(yield* GetRoundingIncrementOption(roundTo));
  const roundingMode = Q(yield* GetRoundingModeOption(roundTo, 'halfExpand'));
  const smallestUnit = Q(yield* GetTemporalUnitValuedOption(roundTo, 'smallestUnit', 'required'));
  Q(ValidateTemporalUnitValue(smallestUnit, 'time'));
  const maximum = MaximumTemporalDurationRoundingIncrement(smallestUnit as TemporalUnit);
  Assert(maximum !== 'no-maximum');
  Q(ValidateTemporalRoundingIncrement(roundingIncrement, maximum, false));
  const result = RoundTime(plainTime.Time, roundingIncrement, smallestUnit as TimeUnit | 'day', roundingMode);
  return Q(yield* CreateTemporalTime(result));
}

/** https://tc39.es/proposal-temporal/#sec-temporal.plaintime.prototype.equals */
function* PlainTimeProto_equals([_other = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const plainTime = Q(thisTemporalTimeValue(thisValue));
  const other = Q(yield* ToTemporalTime(_other));
  return CompareTimeRecord(plainTime.Time, other.Time) === 0n ? Value.true : Value.false;
}

/** https://tc39.es/proposal-temporal/#sec-temporal.plaintime.prototype.tostring */
function* PlainTimeProto_toString([options = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const plainTime = Q(thisTemporalTimeValue(thisValue));
  const resolvedOptions = Q(GetOptionsObject(options));
  const digits = Q(yield* GetTemporalFractionalSecondDigitsOption(resolvedOptions));
  const roundingMode = Q(yield* GetRoundingModeOption(resolvedOptions, 'trunc'));
  const smallestUnit = Q(yield* GetTemporalUnitValuedOption(resolvedOptions, 'smallestUnit', 'optional'));
  Q(ValidateTemporalUnitValue(smallestUnit, 'time'));
  if (smallestUnit === 'hour') {
    return Throw.RangeError('smallestUnit cannot be hour');
  }
  const precision = ToSecondsStringPrecisionRecord(
    smallestUnit as Exclude<TimeUnit, 'hour'> | 'no-unit',
    digits,
  );
  const roundResult = RoundTime(plainTime.Time, precision.Increment, precision.Unit, roundingMode);
  return Value(TimeRecordToString(roundResult, precision.Precision));
}

/** https://tc39.es/proposal-temporal/#sec-temporal.plaintime.prototype.tolocalestring */
function PlainTimeProto_toLocaleString(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const plainTime = Q(thisTemporalTimeValue(thisValue));
  return Value(Q(TimeRecordToString(plainTime.Time, 'auto')));
}

/** https://tc39.es/proposal-temporal/#sec-temporal.plaintime.prototype.tojson */
function PlainTimeProto_toJSON(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const plainTime = Q(thisTemporalTimeValue(thisValue));
  return Value(Q(TimeRecordToString(plainTime.Time, 'auto')));
}

/** https://tc39.es/proposal-temporal/#sec-temporal.plaintime.prototype.valueof */
function PlainTimeProto_valueOf(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  Q(thisTemporalTimeValue(thisValue));
  return Throw.TypeError('Temporal.PlainTime cannot be converted to primitive value. If you are comparing two Temporal.PlainTime objects with > or <, use Temporal.PlainTime.compare() instead.');
}

export function bootstrapTemporalPlainTimePrototype(realmRec: Realm) {
  const prototype = bootstrapPrototype(realmRec, [
    ['hour', [PlainTimeProto_hourGetter]],
    ['minute', [PlainTimeProto_minuteGetter]],
    ['second', [PlainTimeProto_secondGetter]],
    ['millisecond', [PlainTimeProto_millisecondGetter]],
    ['microsecond', [PlainTimeProto_microsecondGetter]],
    ['nanosecond', [PlainTimeProto_nanosecondGetter]],
    ['add', PlainTimeProto_add, 1],
    ['subtract', PlainTimeProto_subtract, 1],
    ['with', PlainTimeProto_with, 1],
    ['until', PlainTimeProto_until, 1],
    ['since', PlainTimeProto_since, 1],
    ['round', PlainTimeProto_round, 1],
    ['equals', PlainTimeProto_equals, 1],
    ['toString', PlainTimeProto_toString, 0],
    ['toLocaleString', PlainTimeProto_toLocaleString, 0],
    ['toJSON', PlainTimeProto_toJSON, 0],
    ['valueOf', PlainTimeProto_valueOf, 0],
  ], realmRec.Intrinsics['%Object.prototype%'], 'Temporal.PlainTime');
  realmRec.Intrinsics['%Temporal.PlainTime.prototype%'] = prototype;
  return prototype;
}
