import { bootstrapPrototype } from '../bootstrap.mts';
import {
  GetRoundingIncrementOption,
  GetRoundingModeOption,
} from '../../abstract-ops/temporal/addition.mts';
import { IsOffsetTimeZoneIdentifier, ParseDateTimeUTCOffset } from '../../abstract-ops/date-objects.mts';
import {
  GetTemporalFractionalSecondDigitsOption,
  GetDirectionOption,
  GetTemporalDisambiguationOption,
  GetTemporalOffsetOption,
  GetTemporalOverflowOption,
  IsPartialTemporalObject,
  GetTemporalShowCalendarNameOption,
  GetTemporalShowOffsetOption,
  GetTemporalShowTimeZoneNameOption,
  GetTemporalUnitValuedOption,
  ISODateToFields,
  MaximumTemporalDurationRoundingIncrement,
  type TemporalUnit,
  ToSecondsStringPrecisionRecord,
  ValidateTemporalRoundingIncrement,
  ValidateTemporalUnitValue,
  type TimeUnit,
} from '../../abstract-ops/temporal/temporal.mts';
import {
  CalendarISOToDate,
  CalendarMergeFields,
  PrepareCalendarFields,
  ToTemporalCalendarIdentifier,
} from '../../abstract-ops/temporal/calendar.mts';
import {
  AddDurationToZonedDateTime,
  CreateTemporalZonedDateTime,
  DifferenceTemporalZonedDateTime,
  InterpretISODateTimeOffset,
  TemporalZonedDateTimeToString,
  ToTemporalZonedDateTime,
} from '../../abstract-ops/temporal/zoned-datetime.mts';
import {
  GetISODateTimeFor,
  GetEpochNanosecondsFor,
  GetOffsetNanosecondsFor,
  GetNamedTimeZoneNextTransition,
  GetNamedTimeZonePreviousTransition,
  FormatUTCOffsetNanoseconds,
  TimeZoneEquals,
  ToTemporalTimeZoneIdentifier,
  GetStartOfDay,
} from '../../abstract-ops/temporal/time-zone.mts';
import { AddDaysToISODate, CreateTemporalDate } from '../../abstract-ops/temporal/plain-date.mts';
import { CreateTemporalTime, ToTemporalTime } from '../../abstract-ops/temporal/plain-time.mts';
import {
  CreateTemporalDateTime,
  InterpretTemporalDateTimeFields,
  RoundISODateTime,
} from '../../abstract-ops/temporal/plain-date-time.mts';
import { CreateTemporalInstant } from '../../abstract-ops/temporal/instant.mts';
import { __ts_cast__ } from '../../utils/language.mts';
import { floorDiv, min } from '../../abstract-ops/math.mts';
import type { TemporalZonedDateTimeObject } from './ZonedDateTime.mts';
import type { ISODateTimeRecord } from './PlainDateTime.mts';
import {
  AddTimeDurationToEpochNanoseconds,
  Assert,
  CreateDataPropertyOrThrow,
  F,
  JSStringValue,
  OrdinaryObjectCreate,
  type ObjectValue,
  Q,
  RequireInternalSlot,
  RoundTimeDurationToIncrement,
  Throw,
  TimeDurationFromEpochNanosecondsDifference,
  UndefinedValue,
  Value,
  X,
  type Arguments,
  type FunctionCallContext,
  type PlainCompletion,
  type Realm,
  type ValueEvaluator,
  TotalTimeDuration,
  GetOptionsObject,
  NanosecondsPerMillisecond,
} from '#self';

function thisTemporalZonedDateTimeValue(value: Value): PlainCompletion<TemporalZonedDateTimeObject> {
  Q(RequireInternalSlot(value, 'InitializedTemporalZonedDateTime'));
  return value as TemporalZonedDateTimeObject;
}

/** https://tc39.es/proposal-temporal/#sec-get-temporal.zoneddatetime.prototype.calendarid */
function ZonedDateTimeProto_calendarIdGetter(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  return Value(Q(thisTemporalZonedDateTimeValue(thisValue)).Calendar);
}

/** https://tc39.es/proposal-temporal/#sec-get-temporal.zoneddatetime.prototype.timezoneid */
function ZonedDateTimeProto_timeZoneIdGetter(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  return Value(Q(thisTemporalZonedDateTimeValue(thisValue)).TimeZone);
}

/** https://tc39.es/ecma262/pr/3759/#sec-get-temporal.zoneddatetime.prototype.era */
function ZonedDateTimeProto_eraGetter(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const zonedDateTime = Q(thisTemporalZonedDateTimeValue(thisValue));
  const isoDateTime = GetISODateTimeFor(zonedDateTime.TimeZone, zonedDateTime.EpochNanoseconds);
  const result = CalendarISOToDate(zonedDateTime.Calendar, isoDateTime.ISODate).Era;
  if (result === undefined) return Value.undefined;
  return Value(result);
}

/** https://tc39.es/ecma262/pr/3759/#sec-get-temporal.zoneddatetime.prototype.erayear */
function ZonedDateTimeProto_eraYearGetter(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const zonedDateTime = Q(thisTemporalZonedDateTimeValue(thisValue));
  const isoDateTime = GetISODateTimeFor(zonedDateTime.TimeZone, zonedDateTime.EpochNanoseconds);
  const result = CalendarISOToDate(zonedDateTime.Calendar, isoDateTime.ISODate).EraYear;
  if (result === undefined) return Value.undefined;
  return F(Number(result));
}

/** https://tc39.es/proposal-temporal/#sec-get-temporal.zoneddatetime.prototype.year */
function ZonedDateTimeProto_yearGetter(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const zonedDateTime = Q(thisTemporalZonedDateTimeValue(thisValue));
  const isoDateTime = GetISODateTimeFor(zonedDateTime.TimeZone, zonedDateTime.EpochNanoseconds);
  return F(Number(CalendarISOToDate(zonedDateTime.Calendar, isoDateTime.ISODate).Year));
}

/** https://tc39.es/ecma262/pr/3759/#sec-get-temporal.zoneddatetime.prototype.yearofweek */
function ZonedDateTimeProto_yearOfWeekGetter(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const zonedDateTime = Q(thisTemporalZonedDateTimeValue(thisValue));
  const isoDateTime = GetISODateTimeFor(zonedDateTime.TimeZone, zonedDateTime.EpochNanoseconds);
  const result = CalendarISOToDate(zonedDateTime.Calendar, isoDateTime.ISODate).WeekOfYear.Year;
  if (result === undefined) return Value.undefined;
  return F(Number(result));
}

/** https://tc39.es/ecma262/pr/3759/#sec-get-temporal.zoneddatetime.prototype.inleapyear */
function ZonedDateTimeProto_inLeapYearGetter(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const zonedDateTime = Q(thisTemporalZonedDateTimeValue(thisValue));
  const isoDateTime = GetISODateTimeFor(zonedDateTime.TimeZone, zonedDateTime.EpochNanoseconds);
  return Value(CalendarISOToDate(zonedDateTime.Calendar, isoDateTime.ISODate).InLeapYear);
}

/** https://tc39.es/proposal-temporal/#sec-get-temporal.zoneddatetime.prototype.month */
function ZonedDateTimeProto_monthGetter(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const zonedDateTime = Q(thisTemporalZonedDateTimeValue(thisValue));
  const isoDateTime = GetISODateTimeFor(zonedDateTime.TimeZone, zonedDateTime.EpochNanoseconds);
  return F(Number(CalendarISOToDate(zonedDateTime.Calendar, isoDateTime.ISODate).Month));
}

/** https://tc39.es/ecma262/pr/3759/#sec-get-temporal.zoneddatetime.prototype.monthsinyear */
function ZonedDateTimeProto_monthsInYearGetter(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const zonedDateTime = Q(thisTemporalZonedDateTimeValue(thisValue));
  const isoDateTime = GetISODateTimeFor(zonedDateTime.TimeZone, zonedDateTime.EpochNanoseconds);
  return F(Number(CalendarISOToDate(zonedDateTime.Calendar, isoDateTime.ISODate).MonthsInYear));
}

/** https://tc39.es/proposal-temporal/#sec-get-temporal.zoneddatetime.prototype.monthcode */
function ZonedDateTimeProto_monthCodeGetter(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const zonedDateTime = Q(thisTemporalZonedDateTimeValue(thisValue));
  const isoDateTime = GetISODateTimeFor(zonedDateTime.TimeZone, zonedDateTime.EpochNanoseconds);
  return Value(CalendarISOToDate(zonedDateTime.Calendar, isoDateTime.ISODate).MonthCode);
}

/** https://tc39.es/proposal-temporal/#sec-get-temporal.zoneddatetime.prototype.day */
function ZonedDateTimeProto_dayGetter(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const zonedDateTime = Q(thisTemporalZonedDateTimeValue(thisValue));
  const isoDateTime = GetISODateTimeFor(zonedDateTime.TimeZone, zonedDateTime.EpochNanoseconds);
  return F(Number(CalendarISOToDate(zonedDateTime.Calendar, isoDateTime.ISODate).Day));
}

/** https://tc39.es/ecma262/pr/3759/#sec-get-temporal.zoneddatetime.prototype.dayofweek */
function ZonedDateTimeProto_dayOfWeekGetter(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const zonedDateTime = Q(thisTemporalZonedDateTimeValue(thisValue));
  const isoDateTime = GetISODateTimeFor(zonedDateTime.TimeZone, zonedDateTime.EpochNanoseconds);
  return F(Number(CalendarISOToDate(zonedDateTime.Calendar, isoDateTime.ISODate).DayOfWeek));
}

/** https://tc39.es/ecma262/pr/3759/#sec-get-temporal.zoneddatetime.prototype.dayofyear */
function ZonedDateTimeProto_dayOfYearGetter(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const zonedDateTime = Q(thisTemporalZonedDateTimeValue(thisValue));
  const isoDateTime = GetISODateTimeFor(zonedDateTime.TimeZone, zonedDateTime.EpochNanoseconds);
  return F(Number(CalendarISOToDate(zonedDateTime.Calendar, isoDateTime.ISODate).DayOfYear));
}

/** https://tc39.es/ecma262/pr/3759/#sec-get-temporal.zoneddatetime.prototype.daysinweek */
function ZonedDateTimeProto_daysInWeekGetter(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const zonedDateTime = Q(thisTemporalZonedDateTimeValue(thisValue));
  const isoDateTime = GetISODateTimeFor(zonedDateTime.TimeZone, zonedDateTime.EpochNanoseconds);
  return F(Number(CalendarISOToDate(zonedDateTime.Calendar, isoDateTime.ISODate).DaysInWeek));
}

/** https://tc39.es/ecma262/pr/3759/#sec-get-temporal.zoneddatetime.prototype.daysinmonth */
function ZonedDateTimeProto_daysInMonthGetter(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const zonedDateTime = Q(thisTemporalZonedDateTimeValue(thisValue));
  const isoDateTime = GetISODateTimeFor(zonedDateTime.TimeZone, zonedDateTime.EpochNanoseconds);
  return F(Number(CalendarISOToDate(zonedDateTime.Calendar, isoDateTime.ISODate).DaysInMonth));
}

/** https://tc39.es/ecma262/pr/3759/#sec-get-temporal.zoneddatetime.prototype.daysinyear */
function ZonedDateTimeProto_daysInYearGetter(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const zonedDateTime = Q(thisTemporalZonedDateTimeValue(thisValue));
  const isoDateTime = GetISODateTimeFor(zonedDateTime.TimeZone, zonedDateTime.EpochNanoseconds);
  return F(Number(CalendarISOToDate(zonedDateTime.Calendar, isoDateTime.ISODate).DaysInYear));
}

/** https://tc39.es/proposal-temporal/#sec-get-temporal.zoneddatetime.prototype.hour */
function ZonedDateTimeProto_hourGetter(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const zonedDateTime = Q(thisTemporalZonedDateTimeValue(thisValue));
  return F(Number(GetISODateTimeFor(zonedDateTime.TimeZone, zonedDateTime.EpochNanoseconds).Time.Hour));
}

/** https://tc39.es/ecma262/pr/3759/#sec-get-temporal.zoneddatetime.prototype.hoursinday */
function ZonedDateTimeProto_hoursInDayGetter(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const zonedDateTime = Q(thisTemporalZonedDateTimeValue(thisValue));
  const timeZone = zonedDateTime.TimeZone;
  const isoDateTime = GetISODateTimeFor(timeZone, zonedDateTime.EpochNanoseconds);
  const today = isoDateTime.ISODate;
  const tomorrow = AddDaysToISODate(today, 1n);
  const todayEpochNanoseconds = Q(GetStartOfDay(timeZone, today));
  const tomorrowEpochNanoseconds = Q(GetStartOfDay(timeZone, tomorrow));
  const diff = TimeDurationFromEpochNanosecondsDifference(todayEpochNanoseconds, tomorrowEpochNanoseconds);
  return F(TotalTimeDuration(diff, 'hour').toNumber());
}

/** https://tc39.es/ecma262/pr/3759/#sec-get-temporal.zoneddatetime.prototype.weekofyear */
function ZonedDateTimeProto_weekOfYearGetter(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const zonedDateTime = Q(thisTemporalZonedDateTimeValue(thisValue));
  const isoDateTime = GetISODateTimeFor(zonedDateTime.TimeZone, zonedDateTime.EpochNanoseconds);
  return F(Number(CalendarISOToDate(zonedDateTime.Calendar, isoDateTime.ISODate).WeekOfYear.Week));
}

/** https://tc39.es/proposal-temporal/#sec-get-temporal.zoneddatetime.prototype.minute */
function ZonedDateTimeProto_minuteGetter(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const zonedDateTime = Q(thisTemporalZonedDateTimeValue(thisValue));
  return F(Number(GetISODateTimeFor(zonedDateTime.TimeZone, zonedDateTime.EpochNanoseconds).Time.Minute));
}

/** https://tc39.es/proposal-temporal/#sec-get-temporal.zoneddatetime.prototype.second */
function ZonedDateTimeProto_secondGetter(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const zonedDateTime = Q(thisTemporalZonedDateTimeValue(thisValue));
  return F(Number(GetISODateTimeFor(zonedDateTime.TimeZone, zonedDateTime.EpochNanoseconds).Time.Second));
}

/** https://tc39.es/proposal-temporal/#sec-get-temporal.zoneddatetime.prototype.millisecond */
function ZonedDateTimeProto_millisecondGetter(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const zonedDateTime = Q(thisTemporalZonedDateTimeValue(thisValue));
  return F(Number(GetISODateTimeFor(zonedDateTime.TimeZone, zonedDateTime.EpochNanoseconds).Time.Millisecond));
}

/** https://tc39.es/proposal-temporal/#sec-get-temporal.zoneddatetime.prototype.microsecond */
function ZonedDateTimeProto_microsecondGetter(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const zonedDateTime = Q(thisTemporalZonedDateTimeValue(thisValue));
  return F(Number(GetISODateTimeFor(zonedDateTime.TimeZone, zonedDateTime.EpochNanoseconds).Time.Microsecond));
}

/** https://tc39.es/proposal-temporal/#sec-get-temporal.zoneddatetime.prototype.nanosecond */
function ZonedDateTimeProto_nanosecondGetter(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const zonedDateTime = Q(thisTemporalZonedDateTimeValue(thisValue));
  return F(Number(GetISODateTimeFor(zonedDateTime.TimeZone, zonedDateTime.EpochNanoseconds).Time.Nanosecond));
}

/** https://tc39.es/proposal-temporal/#sec-get-temporal.zoneddatetime.prototype.epochmilliseconds */
function ZonedDateTimeProto_epochMillisecondsGetter(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const zonedDateTime = Q(thisTemporalZonedDateTimeValue(thisValue));
  const epochMilliseconds = floorDiv(zonedDateTime.EpochNanoseconds, NanosecondsPerMillisecond);
  return F(Number(epochMilliseconds));
}

/** https://tc39.es/proposal-temporal/#sec-get-temporal.zoneddatetime.prototype.epochnanoseconds */
function ZonedDateTimeProto_epochNanosecondsGetter(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  return Value(Q(thisTemporalZonedDateTimeValue(thisValue)).EpochNanoseconds);
}

/** https://tc39.es/proposal-temporal/#sec-get-temporal.zoneddatetime.prototype.offsetnanoseconds */
function ZonedDateTimeProto_offsetNanosecondsGetter(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const zonedDateTime = Q(thisTemporalZonedDateTimeValue(thisValue));
  return F(Number(GetOffsetNanosecondsFor(zonedDateTime.TimeZone, zonedDateTime.EpochNanoseconds)));
}

/** https://tc39.es/ecma262/pr/3759/#sec-get-temporal.zoneddatetime.prototype.offset */
function ZonedDateTimeProto_offsetGetter(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const zonedDateTime = Q(thisTemporalZonedDateTimeValue(thisValue));
  const offsetNanoseconds = GetOffsetNanosecondsFor(zonedDateTime.TimeZone, zonedDateTime.EpochNanoseconds);
  return Value(FormatUTCOffsetNanoseconds(offsetNanoseconds));
}

/** https://tc39.es/proposal-temporal/#sec-temporal.zoneddatetime.prototype.with */
function* ZonedDateTimeProto_with([temporalZonedDateTimeLike = Value.undefined, options = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const zonedDateTime = Q(thisTemporalZonedDateTimeValue(thisValue));
  if (!Q(yield* IsPartialTemporalObject(temporalZonedDateTimeLike))) {
    return Throw.TypeError('$1 is not a partial Temporal object', temporalZonedDateTimeLike);
  }
  const epochNanoseconds = zonedDateTime.EpochNanoseconds;
  const timeZone = zonedDateTime.TimeZone;
  const calendar = zonedDateTime.Calendar;
  const offsetNanoseconds = GetOffsetNanosecondsFor(timeZone, epochNanoseconds);
  const isoDateTime = GetISODateTimeFor(timeZone, epochNanoseconds);
  let fields = ISODateToFields(calendar, isoDateTime.ISODate, 'date');
  fields.Hour = isoDateTime.Time.Hour;
  fields.Minute = isoDateTime.Time.Minute;
  fields.Second = isoDateTime.Time.Second;
  fields.Millisecond = isoDateTime.Time.Millisecond;
  fields.Microsecond = isoDateTime.Time.Microsecond;
  fields.Nanosecond = isoDateTime.Time.Nanosecond;
  fields.OffsetString = FormatUTCOffsetNanoseconds(offsetNanoseconds);
  const partialZonedDateTime = Q(yield* PrepareCalendarFields(calendar, temporalZonedDateTimeLike as ObjectValue, 'date-fields', 'time-fields-with-offset', 'partial'));
  fields = CalendarMergeFields(calendar, fields, partialZonedDateTime);
  const resolvedOptions = Q(GetOptionsObject(options));
  const disambiguation = Q(yield* GetTemporalDisambiguationOption(resolvedOptions));
  const offset = Q(yield* GetTemporalOffsetOption(resolvedOptions, 'prefer'));
  const overflow = Q(yield* GetTemporalOverflowOption(resolvedOptions));
  const dateTimeResult = Q(yield* InterpretTemporalDateTimeFields(calendar, fields, overflow));
  const offsetString = fields.OffsetString!;
  const newOffsetNanoseconds = X(ParseDateTimeUTCOffset(offsetString));
  const newEpochNanoseconds = Q(InterpretISODateTimeOffset(dateTimeResult.ISODate, dateTimeResult.Time, 'option', newOffsetNanoseconds, timeZone, disambiguation, offset, 'match-exactly'));
  return X(CreateTemporalZonedDateTime(newEpochNanoseconds, timeZone, calendar));
}

/** https://tc39.es/proposal-temporal/#sec-temporal.zoneddatetime.prototype.withplaintime */
function* ZonedDateTimeProto_withPlainTime([plainTimeLike = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const zonedDateTime = Q(thisTemporalZonedDateTimeValue(thisValue));
  const timeZone = zonedDateTime.TimeZone;
  const calendar = zonedDateTime.Calendar;
  const isoDateTime = GetISODateTimeFor(timeZone, zonedDateTime.EpochNanoseconds);
  let epochNanoseconds;
  if (plainTimeLike instanceof UndefinedValue) {
    epochNanoseconds = Q(GetStartOfDay(timeZone, isoDateTime.ISODate));
  } else {
    const plainTime = Q(yield* ToTemporalTime(plainTimeLike));
    const resultISODateTime: ISODateTimeRecord = { ISODate: isoDateTime.ISODate, Time: plainTime.Time };
    epochNanoseconds = Q(GetEpochNanosecondsFor(timeZone, resultISODateTime, 'compatible'));
  }
  return X(CreateTemporalZonedDateTime(epochNanoseconds, timeZone, calendar));
}

/** https://tc39.es/proposal-temporal/#sec-temporal.zoneddatetime.prototype.withtimezone */
function* ZonedDateTimeProto_withTimeZone([timeZoneLike = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const zonedDateTime = Q(thisTemporalZonedDateTimeValue(thisValue));
  const timeZone = Q(ToTemporalTimeZoneIdentifier(timeZoneLike));
  return X(CreateTemporalZonedDateTime(zonedDateTime.EpochNanoseconds, timeZone, zonedDateTime.Calendar));
}

/** https://tc39.es/proposal-temporal/#sec-temporal.zoneddatetime.prototype.withcalendar */
function ZonedDateTimeProto_withCalendar([calendarLike = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const zonedDateTime = Q(thisTemporalZonedDateTimeValue(thisValue));
  const calendar = Q(ToTemporalCalendarIdentifier(calendarLike));
  return X(CreateTemporalZonedDateTime(zonedDateTime.EpochNanoseconds, zonedDateTime.TimeZone, calendar));
}

/** https://tc39.es/proposal-temporal/#sec-temporal.zoneddatetime.prototype.add */
function* ZonedDateTimeProto_add([temporalDurationLike = Value.undefined, options = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const zonedDateTime = Q(thisTemporalZonedDateTimeValue(thisValue));
  return Q(yield* AddDurationToZonedDateTime('add', zonedDateTime, temporalDurationLike, options));
}

/** https://tc39.es/proposal-temporal/#sec-temporal.zoneddatetime.prototype.subtract */
function* ZonedDateTimeProto_subtract([temporalDurationLike = Value.undefined, options = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const zonedDateTime = Q(thisTemporalZonedDateTimeValue(thisValue));
  return Q(yield* AddDurationToZonedDateTime('subtract', zonedDateTime, temporalDurationLike, options));
}

/** https://tc39.es/proposal-temporal/#sec-temporal.zoneddatetime.prototype.until */
function* ZonedDateTimeProto_until([other = Value.undefined, options = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const zonedDateTime = Q(thisTemporalZonedDateTimeValue(thisValue));
  return Q(yield* DifferenceTemporalZonedDateTime('until', zonedDateTime, other, options));
}

/** https://tc39.es/proposal-temporal/#sec-temporal.zoneddatetime.prototype.since */
function* ZonedDateTimeProto_since([other = Value.undefined, options = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const zonedDateTime = Q(thisTemporalZonedDateTimeValue(thisValue));
  return Q(yield* DifferenceTemporalZonedDateTime('since', zonedDateTime, other, options));
}

/** https://tc39.es/proposal-temporal/#sec-temporal.zoneddatetime.prototype.round */
function* ZonedDateTimeProto_round([roundTo = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const zonedDateTime = Q(thisTemporalZonedDateTimeValue(thisValue));
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
  let maximum;
  let inclusive;
  if (smallestUnit === 'day') {
    maximum = 1n;
    inclusive = true;
  } else {
    maximum = MaximumTemporalDurationRoundingIncrement(smallestUnit as TemporalUnit);
    Assert(maximum !== 'no-maximum');
    inclusive = false;
  }
  Q(ValidateTemporalRoundingIncrement(roundingIncrement, maximum, inclusive));
  if (smallestUnit === 'nanosecond' && roundingIncrement === 1n) {
    return X(CreateTemporalZonedDateTime(zonedDateTime.EpochNanoseconds, zonedDateTime.TimeZone, zonedDateTime.Calendar));
  }
  let thisEpochNanoseconds = zonedDateTime.EpochNanoseconds;
  const timeZone = zonedDateTime.TimeZone;
  const calendar = zonedDateTime.Calendar;
  const isoDateTime = GetISODateTimeFor(timeZone, thisEpochNanoseconds);
  let epochNanoseconds;
  if (smallestUnit === 'day') {
    const dateStart = isoDateTime.ISODate;
    const dateEnd = AddDaysToISODate(dateStart, 1n);
    const startNanoseconds = Q(GetStartOfDay(timeZone, dateStart));
    Assert(thisEpochNanoseconds >= startNanoseconds);
    const endNanoseconds = Q(GetStartOfDay(timeZone, dateEnd));
    thisEpochNanoseconds = min(thisEpochNanoseconds, endNanoseconds - 1n);
    const dayLengthNanoseconds = endNanoseconds - startNanoseconds;
    const dayProgressNanoseconds = TimeDurationFromEpochNanosecondsDifference(startNanoseconds, thisEpochNanoseconds);
    const roundedDayNanoseconds = X(RoundTimeDurationToIncrement(dayProgressNanoseconds, dayLengthNanoseconds, roundingMode));
    epochNanoseconds = AddTimeDurationToEpochNanoseconds(roundedDayNanoseconds, startNanoseconds);
  } else {
    const roundResult = RoundISODateTime(isoDateTime, roundingIncrement, smallestUnit as TimeUnit | 'day', roundingMode);
    const offsetNanoseconds = GetOffsetNanosecondsFor(timeZone, thisEpochNanoseconds);
    epochNanoseconds = Q(InterpretISODateTimeOffset(roundResult.ISODate, roundResult.Time, 'option', offsetNanoseconds, timeZone, 'compatible', 'prefer', 'match-exactly'));
  }
  return X(CreateTemporalZonedDateTime(epochNanoseconds, timeZone, calendar));
}

/** https://tc39.es/proposal-temporal/#sec-temporal.zoneddatetime.prototype.equals */
function* ZonedDateTimeProto_equals([_other = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const zonedDateTime = Q(thisTemporalZonedDateTimeValue(thisValue));
  const other = Q(yield* ToTemporalZonedDateTime(_other));
  if (zonedDateTime.EpochNanoseconds !== other.EpochNanoseconds) {
    return Value.false;
  }
  if (!TimeZoneEquals(zonedDateTime.TimeZone, other.TimeZone)) {
    return Value.false;
  }
  if (zonedDateTime.Calendar !== other.Calendar) return Value.false;
  return Value.true;
}

/** https://tc39.es/proposal-temporal/#sec-temporal.zoneddatetime.prototype.tostring */
function* ZonedDateTimeProto_toString([options = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const zonedDateTime = Q(thisTemporalZonedDateTimeValue(thisValue));
  const resolvedOptions = Q(GetOptionsObject(options));
  const showCalendar = Q(yield* GetTemporalShowCalendarNameOption(resolvedOptions));
  const digits = Q(yield* GetTemporalFractionalSecondDigitsOption(resolvedOptions));
  const showOffset = Q(yield* GetTemporalShowOffsetOption(resolvedOptions));
  const roundingMode = Q(yield* GetRoundingModeOption(resolvedOptions, 'trunc'));
  const smallestUnit = Q(yield* GetTemporalUnitValuedOption(resolvedOptions, 'smallestUnit', 'optional'));
  const showTimeZone = Q(yield* GetTemporalShowTimeZoneNameOption(resolvedOptions));
  Q(ValidateTemporalUnitValue(smallestUnit, 'time'));
  if (smallestUnit === 'hour') {
    return Throw.RangeError('smallestUnit cannot be hour');
  }
  const precision = ToSecondsStringPrecisionRecord(
    smallestUnit as Exclude<TimeUnit, 'hour'> | 'no-unit',
    digits,
  );
  return Value(TemporalZonedDateTimeToString(zonedDateTime, precision.Precision, showCalendar, showTimeZone, showOffset, precision.Increment, precision.Unit, roundingMode));
}

/** https://tc39.es/proposal-temporal/#sec-temporal.zoneddatetime.prototype.tolocalestring */
function ZonedDateTimeProto_toLocaleString(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const zonedDateTime = Q(thisTemporalZonedDateTimeValue(thisValue));
  return Value(TemporalZonedDateTimeToString(zonedDateTime, 'auto', 'auto', 'auto', 'auto'));
}

/** https://tc39.es/proposal-temporal/#sec-temporal.zoneddatetime.prototype.tojson */
function ZonedDateTimeProto_toJSON(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const zonedDateTime = Q(thisTemporalZonedDateTimeValue(thisValue));
  return Value(TemporalZonedDateTimeToString(zonedDateTime, 'auto', 'auto', 'auto', 'auto'));
}

/** https://tc39.es/proposal-temporal/#sec-temporal.zoneddatetime.prototype.valueof */
function ZonedDateTimeProto_valueOf(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  Q(thisTemporalZonedDateTimeValue(thisValue));
  return Throw.TypeError('Temporal.ZonedDateTime cannot be converted to primitive value. If you are comparing two Temporal.ZonedDateTime objects with > or <, use Temporal.ZonedDateTime.compare() instead.');
}

/** https://tc39.es/proposal-temporal/#sec-temporal.zoneddatetime.prototype.startofday */
function ZonedDateTimeProto_startOfDay(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const zonedDateTime = Q(thisTemporalZonedDateTimeValue(thisValue));
  const timeZone = zonedDateTime.TimeZone;
  const calendar = zonedDateTime.Calendar;
  const isoDateTime = GetISODateTimeFor(timeZone, zonedDateTime.EpochNanoseconds).ISODate;
  const epochNanoseconds = Q(GetStartOfDay(timeZone, isoDateTime));
  return X(CreateTemporalZonedDateTime(epochNanoseconds, timeZone, calendar));
}

/** https://tc39.es/proposal-temporal/#sec-temporal.zoneddatetime.prototype.gettimezonetransition */
function* ZonedDateTimeProto_getTimeZoneTransition([directionParam = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const zonedDateTime = Q(thisTemporalZonedDateTimeValue(thisValue));
  const timeZone = zonedDateTime.TimeZone;
  if (directionParam instanceof UndefinedValue) {
    return Throw.TypeError('directionParam is required');
  }
  if (directionParam instanceof JSStringValue) {
    const paramString = directionParam;
    directionParam = OrdinaryObjectCreate(Value.null);
    X(CreateDataPropertyOrThrow(directionParam, 'direction', paramString));
  } else {
    directionParam = Q(GetOptionsObject(directionParam));
  }
  const direction = Q(yield* GetDirectionOption(directionParam));
  if (IsOffsetTimeZoneIdentifier(timeZone)) {
    return Value.null;
  }
  let transition;
  if (direction === 'next') {
    transition = GetNamedTimeZoneNextTransition(timeZone, zonedDateTime.EpochNanoseconds);
  } else {
    Assert(direction === 'previous');
    transition = GetNamedTimeZonePreviousTransition(timeZone, zonedDateTime.EpochNanoseconds);
  }
  if (transition === null) return Value.null;
  return X(CreateTemporalZonedDateTime(transition, timeZone, zonedDateTime.Calendar));
}

/** https://tc39.es/proposal-temporal/#sec-temporal.zoneddatetime.prototype.toinstant */
function ZonedDateTimeProto_toInstant(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const zonedDateTime = Q(thisTemporalZonedDateTimeValue(thisValue));
  return X(CreateTemporalInstant(zonedDateTime.EpochNanoseconds));
}

/** https://tc39.es/proposal-temporal/#sec-temporal.zoneddatetime.prototype.toplaindate */
function ZonedDateTimeProto_toPlainDate(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const zonedDateTime = Q(thisTemporalZonedDateTimeValue(thisValue));
  const isoDateTime = GetISODateTimeFor(zonedDateTime.TimeZone, zonedDateTime.EpochNanoseconds);
  return X(CreateTemporalDate(isoDateTime.ISODate, zonedDateTime.Calendar));
}

/** https://tc39.es/proposal-temporal/#sec-temporal.zoneddatetime.prototype.toplaintime */
function ZonedDateTimeProto_toPlainTime(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const zonedDateTime = Q(thisTemporalZonedDateTimeValue(thisValue));
  const isoDateTime = GetISODateTimeFor(zonedDateTime.TimeZone, zonedDateTime.EpochNanoseconds);
  return X(CreateTemporalTime(isoDateTime.Time));
}

/** https://tc39.es/proposal-temporal/#sec-temporal.zoneddatetime.prototype.toplaindatetime */
function ZonedDateTimeProto_toPlainDateTime(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const zonedDateTime = Q(thisTemporalZonedDateTimeValue(thisValue));
  const isoDateTime = GetISODateTimeFor(zonedDateTime.TimeZone, zonedDateTime.EpochNanoseconds);
  return X(CreateTemporalDateTime(isoDateTime, zonedDateTime.Calendar));
}

export function bootstrapTemporalZonedDateTimePrototype(realmRec: Realm) {
  const prototype = bootstrapPrototype(realmRec, [
    ['calendarId', [ZonedDateTimeProto_calendarIdGetter]],
    ['timeZoneId', [ZonedDateTimeProto_timeZoneIdGetter]],
    ['era', [ZonedDateTimeProto_eraGetter]],
    ['eraYear', [ZonedDateTimeProto_eraYearGetter]],
    ['year', [ZonedDateTimeProto_yearGetter]],
    ['yearOfWeek', [ZonedDateTimeProto_yearOfWeekGetter]],
    ['inLeapYear', [ZonedDateTimeProto_inLeapYearGetter]],
    ['month', [ZonedDateTimeProto_monthGetter]],
    ['monthCode', [ZonedDateTimeProto_monthCodeGetter]],
    ['monthsInYear', [ZonedDateTimeProto_monthsInYearGetter]],
    ['day', [ZonedDateTimeProto_dayGetter]],
    ['weekOfYear', [ZonedDateTimeProto_weekOfYearGetter]],
    ['dayOfWeek', [ZonedDateTimeProto_dayOfWeekGetter]],
    ['dayOfYear', [ZonedDateTimeProto_dayOfYearGetter]],
    ['daysInWeek', [ZonedDateTimeProto_daysInWeekGetter]],
    ['daysInMonth', [ZonedDateTimeProto_daysInMonthGetter]],
    ['daysInYear', [ZonedDateTimeProto_daysInYearGetter]],
    ['hour', [ZonedDateTimeProto_hourGetter]],
    ['hoursInDay', [ZonedDateTimeProto_hoursInDayGetter]],
    ['minute', [ZonedDateTimeProto_minuteGetter]],
    ['second', [ZonedDateTimeProto_secondGetter]],
    ['millisecond', [ZonedDateTimeProto_millisecondGetter]],
    ['microsecond', [ZonedDateTimeProto_microsecondGetter]],
    ['nanosecond', [ZonedDateTimeProto_nanosecondGetter]],
    ['epochMilliseconds', [ZonedDateTimeProto_epochMillisecondsGetter]],
    ['epochNanoseconds', [ZonedDateTimeProto_epochNanosecondsGetter]],
    ['offsetNanoseconds', [ZonedDateTimeProto_offsetNanosecondsGetter]],
    ['offset', [ZonedDateTimeProto_offsetGetter]],
    ['with', ZonedDateTimeProto_with, 1],
    ['withTimeZone', ZonedDateTimeProto_withTimeZone, 1],
    ['withCalendar', ZonedDateTimeProto_withCalendar, 1],
    ['withPlainTime', ZonedDateTimeProto_withPlainTime, 0],
    ['add', ZonedDateTimeProto_add, 1],
    ['subtract', ZonedDateTimeProto_subtract, 1],
    ['until', ZonedDateTimeProto_until, 1],
    ['since', ZonedDateTimeProto_since, 1],
    ['round', ZonedDateTimeProto_round, 1],
    ['equals', ZonedDateTimeProto_equals, 1],
    ['toString', ZonedDateTimeProto_toString, 0],
    ['toLocaleString', ZonedDateTimeProto_toLocaleString, 0],
    ['toJSON', ZonedDateTimeProto_toJSON, 0],
    ['valueOf', ZonedDateTimeProto_valueOf, 0],
    ['startOfDay', ZonedDateTimeProto_startOfDay, 0],
    ['getTimeZoneTransition', ZonedDateTimeProto_getTimeZoneTransition, 1],
    ['toInstant', ZonedDateTimeProto_toInstant, 0],
    ['toPlainDate', ZonedDateTimeProto_toPlainDate, 0],
    ['toPlainTime', ZonedDateTimeProto_toPlainTime, 0],
    ['toPlainDateTime', ZonedDateTimeProto_toPlainDateTime, 0],
  ], realmRec.Intrinsics['%Object.prototype%'], 'Temporal.ZonedDateTime');
  realmRec.Intrinsics['%Temporal.ZonedDateTime.prototype%'] = prototype;
  return prototype;
}
