import { bootstrapPrototype } from '../bootstrap.mts';
import { abs } from '../../abstract-ops/math.mts';
import { __ts_cast__ } from '../../utils/language.mts';
import {
  GetRoundingIncrementOption, GetRoundingModeOption,
} from '../../abstract-ops/temporal/addition.mts';
import {
  type TemporalDurationObject,
} from './Duration.mts';
import type { ISODateTimeRecord } from './PlainDateTime.mts';
import {
  AddDurations,
  AddTime,
  AddZonedDateTime,
  AdjustDateDurationRecord,
  Assert,
  CalendarDateAdd,
  CombineDateAndTimeDuration,
  CreateDataPropertyOrThrow,
  CreateDateDurationRecord,
  CreateNegatedTemporalDuration,
  CreateTemporalDuration,
  DefaultTemporalLargestUnit,
  DifferencePlainDateTimeWithRounding,
  DifferencePlainDateTimeWithTotal,
  DifferenceZonedDateTimeWithRounding,
  DifferenceZonedDateTimeWithTotal,
  DurationSign,
  F,
  GetTemporalFractionalSecondDigitsOption,
  GetTemporalRelativeToOption,
  GetTemporalUnitValuedOption,
  isCalendarUnit,
  JSStringValue,
  LargerOfTwoTemporalUnits,
  MaximumTemporalDurationRoundingIncrement,
  MidnightTimeRecord,
  OrdinaryObjectCreate,
  Q,
  Realm,
  RequireInternalSlot,
  RoundNumberToIncrement,
  RoundTimeDuration,
  TemporalDurationFromInternal,
  TemporalDurationToString,
  type TemporalUnit,
  Throw,
  ToInternalDurationRecord,
  ToInternalDurationRecordWith24HourDays,
  ToSecondsStringPrecisionRecord,
  TotalTimeDuration,
  ToPartialDurationRecord,
  UndefinedValue,
  ValidateTemporalRoundingIncrement,
  ValidateTemporalUnitValue,
  Value,
  X,
  isDateUnit,
  ZeroDateDuration,
  type Arguments,
  type FunctionCallContext,
  type PlainCompletion,
  type TimeUnit,
  type ValueEvaluator,
  type MathematicalValue,
  type Integer,
  GetOptionsObject,
} from '#self';

function thisTemporalDurationValue(value: Value): PlainCompletion<TemporalDurationObject> {
  Q(RequireInternalSlot(value, 'InitializedTemporalDuration'));
  return value as TemporalDurationObject;
}

/** https://tc39.es/proposal-temporal/#sec-get-temporal.duration.prototype.years */
function DurationProto_yearsGetter(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const duration = Q(thisTemporalDurationValue(thisValue));
  return F(Number(duration.Years));
}

/** https://tc39.es/proposal-temporal/#sec-get-temporal.duration.prototype.months */
function DurationProto_monthsGetter(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const duration = Q(thisTemporalDurationValue(thisValue));
  return F(Number(duration.Months));
}

/** https://tc39.es/proposal-temporal/#sec-get-temporal.duration.prototype.weeks */
function DurationProto_weeksGetter(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const duration = Q(thisTemporalDurationValue(thisValue));
  return F(Number(duration.Weeks));
}

/** https://tc39.es/proposal-temporal/#sec-get-temporal.duration.prototype.days */
function DurationProto_daysGetter(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const duration = Q(thisTemporalDurationValue(thisValue));
  return F(Number(duration.Days));
}

/** https://tc39.es/proposal-temporal/#sec-get-temporal.duration.prototype.hours */
function DurationProto_hoursGetter(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const duration = Q(thisTemporalDurationValue(thisValue));
  return F(Number(duration.Hours));
}

/** https://tc39.es/proposal-temporal/#sec-get-temporal.duration.prototype.minutes */
function DurationProto_minutesGetter(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const duration = Q(thisTemporalDurationValue(thisValue));
  return F(Number(duration.Minutes));
}

/** https://tc39.es/proposal-temporal/#sec-get-temporal.duration.prototype.seconds */
function DurationProto_secondsGetter(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const duration = Q(thisTemporalDurationValue(thisValue));
  return F(Number(duration.Seconds));
}

/** https://tc39.es/proposal-temporal/#sec-get-temporal.duration.prototype.milliseconds */
function DurationProto_millisecondsGetter(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const duration = Q(thisTemporalDurationValue(thisValue));
  return F(Number(duration.Milliseconds));
}

/** https://tc39.es/proposal-temporal/#sec-get-temporal.duration.prototype.microseconds */
function DurationProto_microsecondsGetter(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const duration = Q(thisTemporalDurationValue(thisValue));
  return F(Number(duration.Microseconds));
}

/** https://tc39.es/proposal-temporal/#sec-get-temporal.duration.prototype.nanoseconds */
function DurationProto_nanosecondsGetter(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const duration = Q(thisTemporalDurationValue(thisValue));
  return F(Number(duration.Nanoseconds));
}

/** https://tc39.es/proposal-temporal/#sec-get-temporal.duration.prototype.sign */
function DurationProto_signGetter(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const duration = Q(thisTemporalDurationValue(thisValue));
  return F(DurationSign(duration));
}

/** https://tc39.es/proposal-temporal/#sec-get-temporal.duration.prototype.blank */
function DurationProto_blankGetter(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const duration = Q(thisTemporalDurationValue(thisValue));
  return DurationSign(duration) === 0 ? Value.true : Value.false;
}

/** https://tc39.es/proposal-temporal/#sec-temporal.duration.prototype.with */
function* DurationProto_with([_temporalDurationLike = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const duration = Q(thisTemporalDurationValue(thisValue));
  const partial = Q(yield* ToPartialDurationRecord(_temporalDurationLike));
  const years = BigInt(partial.Years ?? duration.Years);
  const months = BigInt(partial.Months ?? duration.Months);
  const weeks = BigInt(partial.Weeks ?? duration.Weeks);
  const days = BigInt(partial.Days ?? duration.Days);
  const hours = BigInt(partial.Hours ?? duration.Hours);
  const minutes = BigInt(partial.Minutes ?? duration.Minutes);
  const seconds = BigInt(partial.Seconds ?? duration.Seconds);
  const milliseconds = BigInt(partial.Milliseconds ?? duration.Milliseconds);
  const microseconds = BigInt(partial.Microseconds ?? duration.Microseconds);
  const nanoseconds = BigInt(partial.Nanoseconds ?? duration.Nanoseconds);
  return Q(yield* CreateTemporalDuration(years, months, weeks, days, hours, minutes, seconds, milliseconds, microseconds, nanoseconds));
}

/** https://tc39.es/proposal-temporal/#sec-temporal.duration.prototype.negated */
function DurationProto_negated(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const duration = Q(thisTemporalDurationValue(thisValue));
  return CreateNegatedTemporalDuration(duration);
}

/** https://tc39.es/proposal-temporal/#sec-temporal.duration.prototype.abs */
function* DurationProto_abs(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const duration = Q(thisTemporalDurationValue(thisValue));
  return X(CreateTemporalDuration(
    abs(duration.Years),
    abs(duration.Months),
    abs(duration.Weeks),
    abs(duration.Days),
    abs(duration.Hours),
    abs(duration.Minutes),
    abs(duration.Seconds),
    abs(duration.Milliseconds),
    abs(duration.Microseconds),
    abs(duration.Nanoseconds),
  ));
}

/** https://tc39.es/proposal-temporal/#sec-temporal.duration.prototype.add */
function* DurationProto_add([other = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const duration = Q(thisTemporalDurationValue(thisValue));
  return Q(yield* AddDurations('add', duration, other));
}

/** https://tc39.es/proposal-temporal/#sec-temporal.duration.prototype.subtract */
function* DurationProto_subtract([other = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const duration = Q(thisTemporalDurationValue(thisValue));
  return Q(yield* AddDurations('subtract', duration, other));
}

/** https://tc39.es/proposal-temporal/#sec-temporal.duration.prototype.round */
function* DurationProto_round([roundTo = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const duration = Q(thisTemporalDurationValue(thisValue));
  if (roundTo instanceof UndefinedValue) {
    return Throw.TypeError('roundTo is required');
  }
  if (roundTo instanceof JSStringValue) {
    const paramString = roundTo;
    roundTo = OrdinaryObjectCreate(Value.null);
    X(CreateDataPropertyOrThrow(roundTo, 'smallestUnit', paramString));
  } else {
    roundTo = Q(GetOptionsObject(roundTo));
  }

  let smallestUnitPresent = true;
  let largestUnitPresent = true;

  const largestUnitOption = Q(yield* GetTemporalUnitValuedOption(roundTo, 'largestUnit', 'optional'));
  const relativeToRecord = Q(yield* GetTemporalRelativeToOption(roundTo));
  const zonedRelativeTo = relativeToRecord.ZonedRelativeTo;
  const plainRelativeTo = relativeToRecord.PlainRelativeTo;
  const roundingIncrement = Q(yield* GetRoundingIncrementOption(roundTo));
  const roundingMode = Q(yield* GetRoundingModeOption(roundTo, 'halfExpand'));
  let smallestUnit = Q(yield* GetTemporalUnitValuedOption(roundTo, 'smallestUnit', 'optional'));
  if (smallestUnit === 'auto') return Throw.RangeError('smallestUnit cannot be auto');

  if (smallestUnit === 'no-unit') {
    smallestUnitPresent = false;
    smallestUnit = 'nanosecond';
  }
  __ts_cast__<TemporalUnit>(smallestUnit);

  const existingLargestUnit = DefaultTemporalLargestUnit(duration);
  const defaultLargestUnit = LargerOfTwoTemporalUnits(existingLargestUnit, smallestUnit);
  let largestUnit: TemporalUnit;
  if (largestUnitOption === 'no-unit') {
    largestUnitPresent = false;
    largestUnit = defaultLargestUnit;
  } else if (largestUnitOption === 'auto') {
    largestUnit = defaultLargestUnit;
  } else {
    largestUnit = largestUnitOption;
  }

  if (!smallestUnitPresent && !largestUnitPresent) {
    return Throw.RangeError('smallestUnit and largestUnit cannot both be omitted');
  }
  if (LargerOfTwoTemporalUnits(largestUnit, smallestUnit) !== largestUnit) {
    return Throw.RangeError('largestUnit must be larger than smallestUnit');
  }

  const maximum = MaximumTemporalDurationRoundingIncrement(smallestUnit);
  if (maximum !== 'no-maximum') {
    Q(ValidateTemporalRoundingIncrement(roundingIncrement, maximum, false));
  }
  if (roundingIncrement > 1 && largestUnit !== smallestUnit && isDateUnit(smallestUnit)) {
    return Throw.RangeError('roundingIncrement must be 1 when rounding a date unit to a larger unit');
  }

  if (zonedRelativeTo !== undefined) {
    let internalDuration = ToInternalDurationRecord(duration);
    const timeZone = zonedRelativeTo.TimeZone;
    const calendar = zonedRelativeTo.Calendar;
    const relativeEpochNanoseconds = zonedRelativeTo.EpochNanoseconds;
    const targetEpochNanoseconds = Q(AddZonedDateTime(relativeEpochNanoseconds, timeZone, calendar, internalDuration, 'constrain'));
    internalDuration = Q(DifferenceZonedDateTimeWithRounding(relativeEpochNanoseconds, targetEpochNanoseconds, timeZone, calendar, largestUnit, roundingIncrement, smallestUnit, roundingMode));
    if (isDateUnit(largestUnit)) {
      largestUnit = 'hour';
    }
    return Q(yield* TemporalDurationFromInternal(internalDuration, largestUnit));
  }

  if (plainRelativeTo !== undefined) {
    let internalDuration = ToInternalDurationRecordWith24HourDays(duration);
    const targetTime = AddTime(MidnightTimeRecord(), internalDuration.Time);
    const calendar = plainRelativeTo.Calendar;
    const dateDuration = Q(AdjustDateDurationRecord(internalDuration.Date, targetTime.Days));
    const targetDate = Q(CalendarDateAdd(calendar, plainRelativeTo.ISODate, dateDuration, 'constrain'));
    const isoDateTime: ISODateTimeRecord = { ISODate: plainRelativeTo.ISODate, Time: MidnightTimeRecord() };
    const targetDateTime: ISODateTimeRecord = { ISODate: targetDate, Time: targetTime };
    internalDuration = Q(DifferencePlainDateTimeWithRounding(isoDateTime, targetDateTime, calendar, largestUnit, roundingIncrement, smallestUnit, roundingMode));
    return Q(yield* TemporalDurationFromInternal(internalDuration, largestUnit));
  }

  if (isCalendarUnit(existingLargestUnit) || isCalendarUnit(largestUnit)) {
    return Throw.RangeError('relativeTo is required for calendar units');
  }
  Assert(!isCalendarUnit(smallestUnit));

  let internalDuration = ToInternalDurationRecordWith24HourDays(duration);
  if (smallestUnit === 'day') {
    const fractionalDays = TotalTimeDuration(internalDuration.Time, 'day');
    const days = RoundNumberToIncrement(fractionalDays, roundingIncrement, roundingMode);
    const dateDuration = Q(CreateDateDurationRecord(0n, 0n, 0n, days));
    internalDuration = CombineDateAndTimeDuration(dateDuration, 0n);
  } else {
    const timeDuration = Q(RoundTimeDuration(internalDuration.Time, roundingIncrement, smallestUnit, roundingMode));
    internalDuration = CombineDateAndTimeDuration(ZeroDateDuration(), timeDuration);
  }
  return Q(yield* TemporalDurationFromInternal(internalDuration, largestUnit));
}

/** https://tc39.es/proposal-temporal/#sec-temporal.duration.prototype.total */
function* DurationProto_total([totalOf = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const duration = Q(thisTemporalDurationValue(thisValue));
  if (totalOf instanceof UndefinedValue) {
    return Throw.TypeError('totalOf is required');
  }
  if (totalOf instanceof JSStringValue) {
    const paramString = totalOf;
    totalOf = OrdinaryObjectCreate(Value.null);
    X(CreateDataPropertyOrThrow(totalOf, 'unit', paramString));
  } else {
    totalOf = Q(GetOptionsObject(totalOf));
  }

  const relativeToRecord = Q(yield* GetTemporalRelativeToOption(totalOf));
  const zonedRelativeTo = relativeToRecord.ZonedRelativeTo;
  const plainRelativeTo = relativeToRecord.PlainRelativeTo;
  const unit = Q(yield* GetTemporalUnitValuedOption(totalOf, 'unit', 'required'));
  if (unit === 'auto' || unit === 'no-unit') return Throw.RangeError('unit cannot be auto');

  let total: MathematicalValue;
  if (zonedRelativeTo !== undefined) {
    const internalDuration = ToInternalDurationRecord(duration);
    const timeZone = zonedRelativeTo.TimeZone;
    const calendar = zonedRelativeTo.Calendar;
    const relativeEpochNanoseconds = zonedRelativeTo.EpochNanoseconds;
    const targetEpochNanoseconds = Q(AddZonedDateTime(relativeEpochNanoseconds, timeZone, calendar, internalDuration, 'constrain'));
    total = Q(DifferenceZonedDateTimeWithTotal(relativeEpochNanoseconds, targetEpochNanoseconds, timeZone, calendar, unit));
  } else if (plainRelativeTo !== undefined) {
    const internalDuration = ToInternalDurationRecordWith24HourDays(duration);
    const targetTime = AddTime(MidnightTimeRecord(), internalDuration.Time);
    const calendar = plainRelativeTo.Calendar;
    const dateDuration = Q(AdjustDateDurationRecord(internalDuration.Date, targetTime.Days));
    const targetDate = Q(CalendarDateAdd(calendar, plainRelativeTo.ISODate, dateDuration, 'constrain'));
    const isoDateTime: ISODateTimeRecord = { ISODate: plainRelativeTo.ISODate, Time: MidnightTimeRecord() };
    const targetDateTime: ISODateTimeRecord = { ISODate: targetDate, Time: targetTime };
    total = Q(DifferencePlainDateTimeWithTotal(isoDateTime, targetDateTime, calendar, unit));
  } else {
    const largestUnit = DefaultTemporalLargestUnit(duration);
    if (isCalendarUnit(largestUnit) || isCalendarUnit(unit)) {
      return Throw.RangeError('relativeTo is required for calendar units');
    }
    const internalDuration = ToInternalDurationRecordWith24HourDays(duration);
    total = TotalTimeDuration(internalDuration.Time, unit);
  }
  return F(total.toNumber());
}

/** https://tc39.es/proposal-temporal/#sec-temporal.duration.prototype.tostring */
function* DurationProto_toString([options = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const duration = Q(thisTemporalDurationValue(thisValue));
  const resolvedOptions = Q(GetOptionsObject(options));
  const digits = Q(yield* GetTemporalFractionalSecondDigitsOption(resolvedOptions));
  const roundingMode = Q(yield* GetRoundingModeOption(resolvedOptions, 'trunc'));
  const smallestUnit = Q(yield* GetTemporalUnitValuedOption(resolvedOptions, 'smallestUnit', 'optional'));
  Q(ValidateTemporalUnitValue(smallestUnit, 'time'));
  __ts_cast__<TimeUnit | 'no-unit'>(smallestUnit);

  if (smallestUnit === 'hour' || smallestUnit === 'minute') {
    return Throw.RangeError('smallestUnit cannot be hour or minute');
  }

  const precision = ToSecondsStringPrecisionRecord(smallestUnit, digits);

  if (precision.Unit === 'nanosecond' && precision.Increment === 1n) {
    return Value(TemporalDurationToString(duration, precision.Precision));
  }

  const largestUnit = DefaultTemporalLargestUnit(duration);
  let internalDuration = ToInternalDurationRecord(duration);
  const timeDuration = Q(RoundTimeDuration(internalDuration.Time, precision.Increment, precision.Unit, roundingMode));
  internalDuration = CombineDateAndTimeDuration(internalDuration.Date, timeDuration);
  const roundedLargestUnit = LargerOfTwoTemporalUnits(largestUnit, 'second');
  const roundedDuration = Q(yield* TemporalDurationFromInternal(internalDuration, roundedLargestUnit));
  return Value(TemporalDurationToString(roundedDuration, precision.Precision as Integer | 'auto'));
}

/** https://tc39.es/proposal-temporal/#sec-temporal.duration.prototype.tojson */
function DurationProto_toJSON(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const duration = Q(thisTemporalDurationValue(thisValue));
  return Value(TemporalDurationToString(duration, 'auto'));
}

/** https://tc39.es/proposal-temporal/#sec-temporal.duration.prototype.tolocalestring */
function DurationProto_toLocaleString(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const duration = Q(thisTemporalDurationValue(thisValue));
  return Value(TemporalDurationToString(duration, 'auto'));
}

/** https://tc39.es/proposal-temporal/#sec-temporal.duration.prototype.valueof */
function DurationProto_valueOf(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  Q(thisTemporalDurationValue(thisValue));
  return Throw.TypeError('Temporal.Duration cannot be converted to primitive value. If you are comparing two Temporal.Duration objects with > or <, use Temporal.Duration.compare() instead.');
}

export function bootstrapTemporalDurationPrototype(realmRec: Realm) {
  const prototype = bootstrapPrototype(realmRec, [
    ['years', [DurationProto_yearsGetter]],
    ['months', [DurationProto_monthsGetter]],
    ['weeks', [DurationProto_weeksGetter]],
    ['days', [DurationProto_daysGetter]],
    ['hours', [DurationProto_hoursGetter]],
    ['minutes', [DurationProto_minutesGetter]],
    ['seconds', [DurationProto_secondsGetter]],
    ['milliseconds', [DurationProto_millisecondsGetter]],
    ['microseconds', [DurationProto_microsecondsGetter]],
    ['nanoseconds', [DurationProto_nanosecondsGetter]],
    ['sign', [DurationProto_signGetter]],
    ['blank', [DurationProto_blankGetter]],
    ['with', DurationProto_with, 1],
    ['negated', DurationProto_negated, 0],
    ['abs', DurationProto_abs, 0],
    ['add', DurationProto_add, 1],
    ['subtract', DurationProto_subtract, 1],
    ['round', DurationProto_round, 1],
    ['total', DurationProto_total, 1],
    ['toString', DurationProto_toString, 0],
    ['toJSON', DurationProto_toJSON, 0],
    ['toLocaleString', DurationProto_toLocaleString, 0],
    ['valueOf', DurationProto_valueOf, 0],
  ], realmRec.Intrinsics['%Object.prototype%'], 'Temporal.Duration');
  realmRec.Intrinsics['%Temporal.Duration.prototype%'] = prototype;
  return prototype;
}
