import { bootstrapPrototype } from '../bootstrap.mts';
import {
  GetRoundingIncrementOption, GetRoundingModeOption,
} from '../../abstract-ops/temporal/addition.mts';
import {
  GetTemporalFractionalSecondDigitsOption,
  GetTemporalShowCalendarNameOption,
  GetTemporalUnitValuedOption,
  GetTemporalOverflowOption,
  GetTemporalDisambiguationOption,
  IsPartialTemporalObject,
  ISODateToFields,
  MaximumTemporalDurationRoundingIncrement,
  type TemporalUnit,
  ToSecondsStringPrecisionRecord,
  ValidateTemporalRoundingIncrement,
  ValidateTemporalUnitValue,
  type TimeUnit,
} from '../../abstract-ops/temporal/temporal.mts';
import {
  CalendarISOToDate, CalendarMergeFields, PrepareCalendarFields,
  ToTemporalCalendarIdentifier,
} from '../../abstract-ops/temporal/calendar.mts';
import {
  CompareISODateTime,
  CreateTemporalDateTime,
  DifferenceTemporalPlainDateTime,
  AddDurationToDateTime,
  InterpretTemporalDateTimeFields,
  FormatISODateTime,
  ISODateTimeWithinLimits,
  RoundISODateTime,
  ToTemporalDateTime,
} from '../../abstract-ops/temporal/plain-date-time.mts';
import { ToTimeRecordOrMidnight, CreateTemporalTime } from '../../abstract-ops/temporal/plain-time.mts';
import { CreateTemporalDate } from '../../abstract-ops/temporal/plain-date.mts';
import { CreateTemporalZonedDateTime } from '../../abstract-ops/temporal/zoned-datetime.mts';
import { GetEpochNanosecondsFor, ToTemporalTimeZoneIdentifier } from '../../abstract-ops/temporal/time-zone.mts';
import type { TimeZoneIdentifier } from '../../abstract-ops/temporal/addition.mts';
import type { ISODateTimeRecord, TemporalPlainDateTimeObject } from './PlainDateTime.mts';
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

function thisTemporalDateTimeValue(value: Value): PlainCompletion<TemporalPlainDateTimeObject> {
  Q(RequireInternalSlot(value, 'InitializedTemporalDateTime'));
  return value as TemporalPlainDateTimeObject;
}

/** https://tc39.es/proposal-temporal/#sec-get-temporal.plaindatetime.prototype.calendarid */
function PlainDateTimeProto_calendarIdGetter(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const plainDateTime = Q(thisTemporalDateTimeValue(thisValue));
  return Value(plainDateTime.Calendar);
}

/** https://tc39.es/proposal-temporal/#sec-get-temporal.plaindatetime.prototype.era */
function PlainDateTimeProto_eraGetter(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const plainDateTime = Q(thisTemporalDateTimeValue(thisValue));
  const result = CalendarISOToDate(plainDateTime.Calendar, plainDateTime.ISODateTime.ISODate).Era;
  if (result === undefined) return Value.undefined;
  return Value(result);
}

/** https://tc39.es/proposal-temporal/#sec-get-temporal.plaindatetime.prototype.erayear */
function PlainDateTimeProto_eraYearGetter(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const plainDateTime = Q(thisTemporalDateTimeValue(thisValue));
  const result = CalendarISOToDate(plainDateTime.Calendar, plainDateTime.ISODateTime.ISODate).EraYear;
  if (result === undefined) return Value.undefined;
  return Value(Number(result));
}

/** https://tc39.es/proposal-temporal/#sec-get-temporal.plaindatetime.prototype.year */
function PlainDateTimeProto_yearGetter(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const plainDateTime = Q(thisTemporalDateTimeValue(thisValue));
  return F(Number(CalendarISOToDate(plainDateTime.Calendar, plainDateTime.ISODateTime.ISODate).Year));
}

/** https://tc39.es/proposal-temporal/#sec-get-temporal.plaindatetime.prototype.month */
function PlainDateTimeProto_monthGetter(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const plainDateTime = Q(thisTemporalDateTimeValue(thisValue));
  return F(Number(CalendarISOToDate(plainDateTime.Calendar, plainDateTime.ISODateTime.ISODate).Month));
}

/** https://tc39.es/proposal-temporal/#sec-get-temporal.plaindatetime.prototype.monthcode */
function PlainDateTimeProto_monthCodeGetter(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const plainDateTime = Q(thisTemporalDateTimeValue(thisValue));
  return Value(CalendarISOToDate(plainDateTime.Calendar, plainDateTime.ISODateTime.ISODate).MonthCode);
}

/** https://tc39.es/proposal-temporal/#sec-get-temporal.plaindatetime.prototype.day */
function PlainDateTimeProto_dayGetter(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const plainDateTime = Q(thisTemporalDateTimeValue(thisValue));
  return F(Number(CalendarISOToDate(plainDateTime.Calendar, plainDateTime.ISODateTime.ISODate).Day));
}

/** https://tc39.es/proposal-temporal/#sec-get-temporal.plaindatetime.prototype.hour */
function PlainDateTimeProto_hourGetter(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const plainDateTime = Q(thisTemporalDateTimeValue(thisValue));
  return F(Number(plainDateTime.ISODateTime.Time.Hour));
}

/** https://tc39.es/proposal-temporal/#sec-get-temporal.plaindatetime.prototype.minute */
function PlainDateTimeProto_minuteGetter(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const plainDateTime = Q(thisTemporalDateTimeValue(thisValue));
  return F(Number(plainDateTime.ISODateTime.Time.Minute));
}

/** https://tc39.es/proposal-temporal/#sec-get-temporal.plaindatetime.prototype.second */
function PlainDateTimeProto_secondGetter(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const plainDateTime = Q(thisTemporalDateTimeValue(thisValue));
  return F(Number(plainDateTime.ISODateTime.Time.Second));
}

/** https://tc39.es/proposal-temporal/#sec-get-temporal.plaindatetime.prototype.millisecond */
function PlainDateTimeProto_millisecondGetter(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const plainDateTime = Q(thisTemporalDateTimeValue(thisValue));
  return F(Number(plainDateTime.ISODateTime.Time.Millisecond));
}

/** https://tc39.es/proposal-temporal/#sec-get-temporal.plaindatetime.prototype.microsecond */
function PlainDateTimeProto_microsecondGetter(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const plainDateTime = Q(thisTemporalDateTimeValue(thisValue));
  return F(Number(plainDateTime.ISODateTime.Time.Microsecond));
}

/** https://tc39.es/proposal-temporal/#sec-get-temporal.plaindatetime.prototype.nanosecond */
function PlainDateTimeProto_nanosecondGetter(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const plainDateTime = Q(thisTemporalDateTimeValue(thisValue));
  return F(Number(plainDateTime.ISODateTime.Time.Nanosecond));
}

/** https://tc39.es/proposal-temporal/#sec-get-temporal.plaindatetime.prototype.dayofweek */
function PlainDateTimeProto_dayOfWeekGetter(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const plainDateTime = Q(thisTemporalDateTimeValue(thisValue));
  return F(Number(CalendarISOToDate(plainDateTime.Calendar, plainDateTime.ISODateTime.ISODate).DayOfWeek));
}

/** https://tc39.es/proposal-temporal/#sec-get-temporal.plaindatetime.prototype.dayofyear */
function PlainDateTimeProto_dayOfYearGetter(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const plainDateTime = Q(thisTemporalDateTimeValue(thisValue));
  return F(Number(CalendarISOToDate(plainDateTime.Calendar, plainDateTime.ISODateTime.ISODate).DayOfYear));
}

/** https://tc39.es/proposal-temporal/#sec-get-temporal.plaindatetime.prototype.weekofyear */
function PlainDateTimeProto_weekOfYearGetter(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const plainDateTime = Q(thisTemporalDateTimeValue(thisValue));
  const result = CalendarISOToDate(plainDateTime.Calendar, plainDateTime.ISODateTime.ISODate).WeekOfYear.Week;
  return result === undefined ? Value.undefined : F(Number(result));
}

/** https://tc39.es/proposal-temporal/#sec-get-temporal.plaindatetime.prototype.yearofweek */
function PlainDateTimeProto_yearOfWeekGetter(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const plainDateTime = Q(thisTemporalDateTimeValue(thisValue));
  const result = CalendarISOToDate(plainDateTime.Calendar, plainDateTime.ISODateTime.ISODate).WeekOfYear.Year;
  return result === undefined ? Value.undefined : F(Number(result));
}

/** https://tc39.es/proposal-temporal/#sec-get-temporal.plaindatetime.prototype.daysinweek */
function PlainDateTimeProto_daysInWeekGetter(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const plainDateTime = Q(thisTemporalDateTimeValue(thisValue));
  return F(Number(CalendarISOToDate(plainDateTime.Calendar, plainDateTime.ISODateTime.ISODate).DaysInWeek));
}

/** https://tc39.es/proposal-temporal/#sec-get-temporal.plaindatetime.prototype.daysinmonth */
function PlainDateTimeProto_daysInMonthGetter(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const plainDateTime = Q(thisTemporalDateTimeValue(thisValue));
  return F(Number(CalendarISOToDate(plainDateTime.Calendar, plainDateTime.ISODateTime.ISODate).DaysInMonth));
}

/** https://tc39.es/proposal-temporal/#sec-get-temporal.plaindatetime.prototype.daysinyear */
function PlainDateTimeProto_daysInYearGetter(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const plainDateTime = Q(thisTemporalDateTimeValue(thisValue));
  return F(Number(CalendarISOToDate(plainDateTime.Calendar, plainDateTime.ISODateTime.ISODate).DaysInYear));
}

/** https://tc39.es/proposal-temporal/#sec-get-temporal.plaindatetime.prototype.monthsinyear */
function PlainDateTimeProto_monthsInYearGetter(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const plainDateTime = Q(thisTemporalDateTimeValue(thisValue));
  return F(Number(CalendarISOToDate(plainDateTime.Calendar, plainDateTime.ISODateTime.ISODate).MonthsInYear));
}

/** https://tc39.es/proposal-temporal/#sec-get-temporal.plaindatetime.prototype.inleapyear */
function PlainDateTimeProto_inLeapYearGetter(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const plainDateTime = Q(thisTemporalDateTimeValue(thisValue));
  return Value(CalendarISOToDate(plainDateTime.Calendar, plainDateTime.ISODateTime.ISODate).InLeapYear);
}

/** https://tc39.es/proposal-temporal/#sec-temporal.plaindatetime.prototype.with */
function* PlainDateTimeProto_with([temporalDateTimeLike = Value.undefined, options = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const plainDateTime = Q(thisTemporalDateTimeValue(thisValue));
  if (!Q(yield* IsPartialTemporalObject(temporalDateTimeLike))) {
    return Throw.TypeError('$1 is not a partial Temporal object', temporalDateTimeLike);
  }
  const calendar = plainDateTime.Calendar;
  let fields = ISODateToFields(calendar, plainDateTime.ISODateTime.ISODate, 'date');
  fields.Hour = plainDateTime.ISODateTime.Time.Hour;
  fields.Minute = plainDateTime.ISODateTime.Time.Minute;
  fields.Second = plainDateTime.ISODateTime.Time.Second;
  fields.Millisecond = plainDateTime.ISODateTime.Time.Millisecond;
  fields.Microsecond = plainDateTime.ISODateTime.Time.Microsecond;
  fields.Nanosecond = plainDateTime.ISODateTime.Time.Nanosecond;
  const partialDateTime = Q(yield* PrepareCalendarFields(calendar, temporalDateTimeLike as ObjectValue, 'date-fields', 'time-fields', 'partial'));
  fields = CalendarMergeFields(calendar, fields, partialDateTime);
  const resolvedOptions = Q(GetOptionsObject(options));
  const overflow = Q(yield* GetTemporalOverflowOption(resolvedOptions));
  const result = Q(yield* InterpretTemporalDateTimeFields(calendar, fields, overflow));
  return Q(yield* CreateTemporalDateTime(result, calendar));
}

/** https://tc39.es/proposal-temporal/#sec-temporal.plaindatetime.prototype.withplaintime */
function* PlainDateTimeProto_withPlainTime([plainTimeLike = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const plainDateTime = Q(thisTemporalDateTimeValue(thisValue));
  const time = Q(yield* ToTimeRecordOrMidnight(plainTimeLike));
  const isoDateTime: ISODateTimeRecord = { ISODate: plainDateTime.ISODateTime.ISODate, Time: time };
  return Q(yield* CreateTemporalDateTime(isoDateTime, plainDateTime.Calendar));
}

/** https://tc39.es/proposal-temporal/#sec-temporal.plaindatetime.prototype.withcalendar */
function PlainDateTimeProto_withCalendar([calendarLike = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const plainDateTime = Q(thisTemporalDateTimeValue(thisValue));
  const calendar = Q(ToTemporalCalendarIdentifier(calendarLike));
  return X(CreateTemporalDateTime(plainDateTime.ISODateTime, calendar));
}

/** https://tc39.es/proposal-temporal/#sec-temporal.plaindatetime.prototype.add */
function* PlainDateTimeProto_add([temporalDurationLike = Value.undefined, options = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const plainDateTime = Q(thisTemporalDateTimeValue(thisValue));
  return Q(yield* AddDurationToDateTime('add', plainDateTime, temporalDurationLike, options));
}

/** https://tc39.es/proposal-temporal/#sec-temporal.plaindatetime.prototype.subtract */
function* PlainDateTimeProto_subtract([temporalDurationLike = Value.undefined, options = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const plainDateTime = Q(thisTemporalDateTimeValue(thisValue));
  return Q(yield* AddDurationToDateTime('subtract', plainDateTime, temporalDurationLike, options));
}

/** https://tc39.es/proposal-temporal/#sec-temporal.plaindatetime.prototype.until */
function* PlainDateTimeProto_until([other = Value.undefined, options = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const plainDateTime = Q(thisTemporalDateTimeValue(thisValue));
  return Q(yield* DifferenceTemporalPlainDateTime('until', plainDateTime, other, options));
}

/** https://tc39.es/proposal-temporal/#sec-temporal.plaindatetime.prototype.since */
function* PlainDateTimeProto_since([other = Value.undefined, options = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const plainDateTime = Q(thisTemporalDateTimeValue(thisValue));
  return Q(yield* DifferenceTemporalPlainDateTime('since', plainDateTime, other, options));
}

/** https://tc39.es/proposal-temporal/#sec-temporal.plaindatetime.prototype.round */
function* PlainDateTimeProto_round([roundTo = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const plainDateTime = Q(thisTemporalDateTimeValue(thisValue));
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
  const roundingIncrement = Q(yield* GetRoundingIncrementOption(roundTo));
  const roundingMode = Q(yield* GetRoundingModeOption(roundTo, 'halfExpand'));
  const smallestUnit = Q(yield* GetTemporalUnitValuedOption(roundTo, 'smallestUnit', 'required'));
  Q(ValidateTemporalUnitValue(smallestUnit, 'time', ['day']));
  let maximum: bigint;
  let inclusive: boolean;
  if (smallestUnit === 'day') {
    maximum = 1n;
    inclusive = true;
  } else {
    const maximum2 = MaximumTemporalDurationRoundingIncrement(smallestUnit as TemporalUnit);
    Assert(maximum2 !== 'no-maximum');
    maximum = maximum2;
    inclusive = false;
  }
  Q(ValidateTemporalRoundingIncrement(roundingIncrement, maximum, inclusive));
  if (smallestUnit === 'nanosecond' && roundingIncrement === 1n) {
    return X(CreateTemporalDateTime(plainDateTime.ISODateTime, plainDateTime.Calendar));
  }
  const result = RoundISODateTime(
    plainDateTime.ISODateTime,
    roundingIncrement,
    smallestUnit as TimeUnit,
    roundingMode,
  );
  return Q(yield* CreateTemporalDateTime(result, plainDateTime.Calendar));
}

/** https://tc39.es/proposal-temporal/#sec-temporal.plaindatetime.prototype.equals */
function* PlainDateTimeProto_equals([_other = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const plainDateTime = Q(thisTemporalDateTimeValue(thisValue));
  const other = Q(yield* ToTemporalDateTime(_other));
  if (CompareISODateTime(plainDateTime.ISODateTime, other.ISODateTime) !== 0n) {
    return Value.false;
  }
  if (plainDateTime.Calendar !== other.Calendar) return Value.false;
  return Value.true;
}

/** https://tc39.es/proposal-temporal/#sec-temporal.plaindatetime.prototype.tostring */
function* PlainDateTimeProto_toString([options = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const plainDateTime = Q(thisTemporalDateTimeValue(thisValue));
  const resolvedOptions = Q(GetOptionsObject(options));
  const showCalendar = Q(yield* GetTemporalShowCalendarNameOption(resolvedOptions));
  const digits = Q(yield* GetTemporalFractionalSecondDigitsOption(resolvedOptions));
  const roundingMode = Q(yield* GetRoundingModeOption(resolvedOptions, 'trunc'));
  const smallestUnit = Q(yield* GetTemporalUnitValuedOption(resolvedOptions, 'smallestUnit', 'optional'));
  Q(ValidateTemporalUnitValue(smallestUnit, 'time'));
  if (smallestUnit === 'hour') {
    return Throw.RangeError('smallestUnit cannot be hour');
  }
  const precision = ToSecondsStringPrecisionRecord(smallestUnit as Exclude<TimeUnit, 'hour'> | 'no-unit', digits);
  const result = RoundISODateTime(plainDateTime.ISODateTime, precision.Increment, precision.Unit, roundingMode);
  if (!ISODateTimeWithinLimits(result)) {
    return Throw.RangeError('DateTime outside of range');
  }
  return Value(FormatISODateTime(result, plainDateTime.Calendar, precision.Precision, showCalendar));
}

/** https://tc39.es/proposal-temporal/#sec-temporal.plaindatetime.prototype.tolocalestring */
function PlainDateTimeProto_toLocaleString(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const plainDateTime = Q(thisTemporalDateTimeValue(thisValue));
  return Value(FormatISODateTime(plainDateTime.ISODateTime, plainDateTime.Calendar, 'auto', 'auto'));
}

/** https://tc39.es/proposal-temporal/#sec-temporal.plaindatetime.prototype.tojson */
function PlainDateTimeProto_toJSON(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const plainDateTime = Q(thisTemporalDateTimeValue(thisValue));
  return Value(FormatISODateTime(plainDateTime.ISODateTime, plainDateTime.Calendar, 'auto', 'auto'));
}

/** https://tc39.es/proposal-temporal/#sec-temporal.plaindatetime.prototype.valueof */
function PlainDateTimeProto_valueOf(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  Q(thisTemporalDateTimeValue(thisValue));
  return Throw.TypeError('Temporal.PlainDateTime cannot be converted to primitive value. If you are comparing two Temporal.PlainDateTime objects with > or <, use Temporal.PlainDateTime.compare() instead.');
}

/** https://tc39.es/proposal-temporal/#sec-temporal.plaindatetime.prototype.tozoneddatetime */
function* PlainDateTimeProto_toZonedDateTime([temporalTimeZoneLike = Value.undefined, options = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const plainDateTime = Q(thisTemporalDateTimeValue(thisValue));
  const timeZone = Q(ToTemporalTimeZoneIdentifier(temporalTimeZoneLike)) as TimeZoneIdentifier;
  const resolvedOptions = Q(GetOptionsObject(options));
  const disambiguation = Q(yield* GetTemporalDisambiguationOption(resolvedOptions));
  const epochNanoseconds = Q(GetEpochNanosecondsFor(timeZone, plainDateTime.ISODateTime, disambiguation));
  return X(CreateTemporalZonedDateTime(epochNanoseconds, timeZone, plainDateTime.Calendar));
}

/** https://tc39.es/proposal-temporal/#sec-temporal.plaindatetime.prototype.toplaindate */
function PlainDateTimeProto_toPlainDate(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const plainDateTime = Q(thisTemporalDateTimeValue(thisValue));
  return X(CreateTemporalDate(plainDateTime.ISODateTime.ISODate, plainDateTime.Calendar));
}

/** https://tc39.es/proposal-temporal/#sec-temporal.plaindatetime.prototype.toplaintime */
function PlainDateTimeProto_toPlainTime(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const plainDateTime = Q(thisTemporalDateTimeValue(thisValue));
  return X(CreateTemporalTime(plainDateTime.ISODateTime.Time));
}

export function bootstrapTemporalPlainDateTimePrototype(realmRec: Realm) {
  const prototype = bootstrapPrototype(realmRec, [
    ['calendarId', [PlainDateTimeProto_calendarIdGetter]],
    ['era', [PlainDateTimeProto_eraGetter]],
    ['eraYear', [PlainDateTimeProto_eraYearGetter]],
    ['year', [PlainDateTimeProto_yearGetter]],
    ['month', [PlainDateTimeProto_monthGetter]],
    ['monthCode', [PlainDateTimeProto_monthCodeGetter]],
    ['day', [PlainDateTimeProto_dayGetter]],
    ['hour', [PlainDateTimeProto_hourGetter]],
    ['minute', [PlainDateTimeProto_minuteGetter]],
    ['second', [PlainDateTimeProto_secondGetter]],
    ['millisecond', [PlainDateTimeProto_millisecondGetter]],
    ['microsecond', [PlainDateTimeProto_microsecondGetter]],
    ['nanosecond', [PlainDateTimeProto_nanosecondGetter]],
    ['dayOfWeek', [PlainDateTimeProto_dayOfWeekGetter]],
    ['dayOfYear', [PlainDateTimeProto_dayOfYearGetter]],
    ['weekOfYear', [PlainDateTimeProto_weekOfYearGetter]],
    ['yearOfWeek', [PlainDateTimeProto_yearOfWeekGetter]],
    ['daysInWeek', [PlainDateTimeProto_daysInWeekGetter]],
    ['daysInMonth', [PlainDateTimeProto_daysInMonthGetter]],
    ['daysInYear', [PlainDateTimeProto_daysInYearGetter]],
    ['monthsInYear', [PlainDateTimeProto_monthsInYearGetter]],
    ['inLeapYear', [PlainDateTimeProto_inLeapYearGetter]],
    ['with', PlainDateTimeProto_with, 1],
    ['withPlainTime', PlainDateTimeProto_withPlainTime, 0],
    ['withCalendar', PlainDateTimeProto_withCalendar, 1],
    ['add', PlainDateTimeProto_add, 1],
    ['subtract', PlainDateTimeProto_subtract, 1],
    ['until', PlainDateTimeProto_until, 1],
    ['since', PlainDateTimeProto_since, 1],
    ['round', PlainDateTimeProto_round, 1],
    ['equals', PlainDateTimeProto_equals, 1],
    ['toString', PlainDateTimeProto_toString, 0],
    ['toLocaleString', PlainDateTimeProto_toLocaleString, 0],
    ['toJSON', PlainDateTimeProto_toJSON, 0],
    ['valueOf', PlainDateTimeProto_valueOf, 0],
    ['toZonedDateTime', PlainDateTimeProto_toZonedDateTime, 1],
    ['toPlainDate', PlainDateTimeProto_toPlainDate, 0],
    ['toPlainTime', PlainDateTimeProto_toPlainTime, 0],
  ], realmRec.Intrinsics['%Object.prototype%'], 'Temporal.PlainDateTime');
  realmRec.Intrinsics['%Temporal.PlainDateTime.prototype%'] = prototype;
  return prototype;
}
