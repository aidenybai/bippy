import { bootstrapPrototype } from '../bootstrap.mts';
import type { TimeZoneIdentifier } from '../../abstract-ops/temporal/addition.mts';
import type { TemporalPlainDateObject } from './PlainDate.mts';
import type { ISODateTimeRecord } from './PlainDateTime.mts';
import {
  AddDurationToDate,
  CalendarDateFromFields,
  CalendarISOToDate,
  CalendarMergeFields,
  CalendarMonthDayFromFields,
  CalendarYearMonthFromFields,
  CompareISODate,
  CreateTemporalDate,
  CreateTemporalDateTime,
  CreateTemporalMonthDay,
  CreateTemporalYearMonth,
  CreateTemporalZonedDateTime,
  DifferenceTemporalPlainDate,
  Get,
  GetEpochNanosecondsFor,
  GetStartOfDay,
  GetTemporalOverflowOption,
  GetTemporalShowCalendarNameOption,
  ISODateTimeWithinLimits,
  ISODateToFields,
  IsPartialTemporalObject,
  PrepareCalendarFields,
  Q,
  RequireInternalSlot,
  Throw,
  ToTemporalCalendarIdentifier,
  ToTemporalDate,
  ToTemporalTime,
  ToTemporalTimeZoneIdentifier,
  ToTimeRecordOrMidnight,
  Value,
  X,
  F,
  type Arguments,
  type FunctionCallContext,
  type PlainCompletion,
  type Realm,
  type ValueEvaluator,
  ObjectValue,
  TemporalDateToString,
  GetOptionsObject,
} from '#self';

function thisTemporalDateValue(value: Value): PlainCompletion<TemporalPlainDateObject> {
  Q(RequireInternalSlot(value, 'InitializedTemporalDate'));
  return value as TemporalPlainDateObject;
}

/** https://tc39.es/proposal-temporal/#sec-get-temporal.plaindate.prototype.calendarid */
function PlainDateProto_calendarIdGetter(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const plainDate = Q(thisTemporalDateValue(thisValue));
  return Value(plainDate.Calendar);
}

/** https://tc39.es/proposal-temporal/#sec-get-temporal.plaindate.prototype.era */
function PlainDateProto_eraGetter(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const plainDate = Q(thisTemporalDateValue(thisValue));
  const result = CalendarISOToDate(plainDate.Calendar, plainDate.ISODate).Era;
  if (result === undefined) return Value.undefined;
  return Value(result);
}

/** https://tc39.es/proposal-temporal/#sec-get-temporal.plaindate.prototype.erayear */
function PlainDateProto_eraYearGetter(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const plainDate = Q(thisTemporalDateValue(thisValue));
  const result = CalendarISOToDate(plainDate.Calendar, plainDate.ISODate).EraYear;
  return result === undefined ? Value.undefined : F(Number(result));
}

/** https://tc39.es/proposal-temporal/#sec-get-temporal.plaindate.prototype.year */
function PlainDateProto_yearGetter(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const plainDate = Q(thisTemporalDateValue(thisValue));
  return F(Number(CalendarISOToDate(plainDate.Calendar, plainDate.ISODate).Year));
}

/** https://tc39.es/proposal-temporal/#sec-get-temporal.plaindate.prototype.month */
function PlainDateProto_monthGetter(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const plainDate = Q(thisTemporalDateValue(thisValue));
  return F(Number(CalendarISOToDate(plainDate.Calendar, plainDate.ISODate).Month));
}

/** https://tc39.es/proposal-temporal/#sec-get-temporal.plaindate.prototype.monthcode */
function PlainDateProto_monthCodeGetter(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const plainDate = Q(thisTemporalDateValue(thisValue));
  return Value(CalendarISOToDate(plainDate.Calendar, plainDate.ISODate).MonthCode);
}

/** https://tc39.es/proposal-temporal/#sec-get-temporal.plaindate.prototype.day */
function PlainDateProto_dayGetter(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const plainDate = Q(thisTemporalDateValue(thisValue));
  return F(Number(CalendarISOToDate(plainDate.Calendar, plainDate.ISODate).Day));
}

/** https://tc39.es/proposal-temporal/#sec-get-temporal.plaindate.prototype.dayofweek */
function PlainDateProto_dayOfWeekGetter(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const plainDate = Q(thisTemporalDateValue(thisValue));
  return F(Number(CalendarISOToDate(plainDate.Calendar, plainDate.ISODate).DayOfWeek));
}

/** https://tc39.es/proposal-temporal/#sec-get-temporal.plaindate.prototype.dayofyear */
function PlainDateProto_dayOfYearGetter(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const plainDate = Q(thisTemporalDateValue(thisValue));
  return F(Number(CalendarISOToDate(plainDate.Calendar, plainDate.ISODate).DayOfYear));
}

/** https://tc39.es/proposal-temporal/#sec-get-temporal.plaindate.prototype.weekofyear */
function PlainDateProto_weekOfYearGetter(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const plainDate = Q(thisTemporalDateValue(thisValue));
  const result = CalendarISOToDate(plainDate.Calendar, plainDate.ISODate).WeekOfYear.Week;
  return result === undefined ? Value.undefined : F(Number(result));
}

/** https://tc39.es/proposal-temporal/#sec-get-temporal.plaindate.prototype.yearofweek */
function PlainDateProto_yearOfWeekGetter(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const plainDate = Q(thisTemporalDateValue(thisValue));
  const result = CalendarISOToDate(plainDate.Calendar, plainDate.ISODate).WeekOfYear.Year;
  return result === undefined ? Value.undefined : F(Number(result));
}

/** https://tc39.es/proposal-temporal/#sec-get-temporal.plaindate.prototype.daysinweek */
function PlainDateProto_daysInWeekGetter(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const plainDate = Q(thisTemporalDateValue(thisValue));
  return F(Number(CalendarISOToDate(plainDate.Calendar, plainDate.ISODate).DaysInWeek));
}

/** https://tc39.es/proposal-temporal/#sec-get-temporal.plaindate.prototype.daysinmonth */
function PlainDateProto_daysInMonthGetter(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const plainDate = Q(thisTemporalDateValue(thisValue));
  return F(Number(CalendarISOToDate(plainDate.Calendar, plainDate.ISODate).DaysInMonth));
}

/** https://tc39.es/proposal-temporal/#sec-get-temporal.plaindate.prototype.daysinyear */
function PlainDateProto_daysInYearGetter(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const plainDate = Q(thisTemporalDateValue(thisValue));
  return F(Number(CalendarISOToDate(plainDate.Calendar, plainDate.ISODate).DaysInYear));
}

/** https://tc39.es/proposal-temporal/#sec-get-temporal.plaindate.prototype.monthsinyear */
function PlainDateProto_monthsInYearGetter(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const plainDate = Q(thisTemporalDateValue(thisValue));
  return F(Number(CalendarISOToDate(plainDate.Calendar, plainDate.ISODate).MonthsInYear));
}

/** https://tc39.es/proposal-temporal/#sec-get-temporal.plaindate.prototype.inleapyear */
function PlainDateProto_inLeapYearGetter(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const plainDate = Q(thisTemporalDateValue(thisValue));
  return Value(CalendarISOToDate(plainDate.Calendar, plainDate.ISODate).InLeapYear);
}

/** https://tc39.es/proposal-temporal/#sec-temporal.plaindate.prototype.toplainyearmonth */
function* PlainDateProto_toPlainYearMonth(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const plainDate = Q(thisTemporalDateValue(thisValue));
  const calendar = plainDate.Calendar;
  const fields = ISODateToFields(calendar, plainDate.ISODate, 'date');
  const isoDate = Q(yield* CalendarYearMonthFromFields(calendar, fields, 'constrain'));
  return X(CreateTemporalYearMonth(isoDate, calendar));
}

/** https://tc39.es/proposal-temporal/#sec-temporal.plaindate.prototype.toplainmonthday */
function* PlainDateProto_toPlainMonthDay(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const plainDate = Q(thisTemporalDateValue(thisValue));
  const calendar = plainDate.Calendar;
  const fields = ISODateToFields(calendar, plainDate.ISODate, 'date');
  const isoDate = Q(yield* CalendarMonthDayFromFields(calendar, fields, 'constrain'));
  return X(CreateTemporalMonthDay(isoDate, calendar));
}

/** https://tc39.es/proposal-temporal/#sec-temporal.plaindate.prototype.add */
function* PlainDateProto_add([temporalDurationLike = Value.undefined, options = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const plainDate = Q(thisTemporalDateValue(thisValue));
  return Q(yield* AddDurationToDate('add', plainDate, temporalDurationLike, options));
}

/** https://tc39.es/proposal-temporal/#sec-temporal.plaindate.prototype.subtract */
function* PlainDateProto_subtract([temporalDurationLike = Value.undefined, options = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const plainDate = Q(thisTemporalDateValue(thisValue));
  return Q(yield* AddDurationToDate('subtract', plainDate, temporalDurationLike, options));
}

/** https://tc39.es/proposal-temporal/#sec-temporal.plaindate.prototype.with */
function* PlainDateProto_with([temporalDateLike = Value.undefined, options = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const plainDate = Q(thisTemporalDateValue(thisValue));
  if (!Q(yield* IsPartialTemporalObject(temporalDateLike))) {
    return Throw.TypeError('$1 is not a partial Temporal object', temporalDateLike);
  }
  const calendar = plainDate.Calendar;
  let fields = ISODateToFields(calendar, plainDate.ISODate, 'date');
  const partialDate = Q(yield* PrepareCalendarFields(calendar, temporalDateLike as ObjectValue, 'date-fields', 'no-non-calendar-fields', 'partial'));
  fields = CalendarMergeFields(calendar, fields, partialDate);
  const resolvedOptions = Q(GetOptionsObject(options));
  const overflow = Q(yield* GetTemporalOverflowOption(resolvedOptions));
  const isoDate = Q(yield* CalendarDateFromFields(calendar, fields, overflow));
  return X(CreateTemporalDate(isoDate, calendar));
}

/** https://tc39.es/proposal-temporal/#sec-temporal.plaindate.prototype.withcalendar */
function PlainDateProto_withCalendar([calendarLike = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const plainDate = Q(thisTemporalDateValue(thisValue));
  const calendar = Q(ToTemporalCalendarIdentifier(calendarLike));
  return X(CreateTemporalDate(plainDate.ISODate, calendar));
}

/** https://tc39.es/proposal-temporal/#sec-temporal.plaindate.prototype.until */
function* PlainDateProto_until([other = Value.undefined, options = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const plainDate = Q(thisTemporalDateValue(thisValue));
  return Q(yield* DifferenceTemporalPlainDate('until', plainDate, other, options));
}

/** https://tc39.es/proposal-temporal/#sec-temporal.plaindate.prototype.since */
function* PlainDateProto_since([other = Value.undefined, options = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const plainDate = Q(thisTemporalDateValue(thisValue));
  return Q(yield* DifferenceTemporalPlainDate('since', plainDate, other, options));
}

/** https://tc39.es/proposal-temporal/#sec-temporal.plaindate.prototype.equals */
function* PlainDateProto_equals([_other = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const plainDate = Q(thisTemporalDateValue(thisValue));
  const other = Q(yield* ToTemporalDate(_other));
  if (CompareISODate(plainDate.ISODate, other.ISODate) !== 0n) {
    return Value.false;
  }
  if (plainDate.Calendar !== other.Calendar) return Value.false;
  return Value.true;
}

/** https://tc39.es/proposal-temporal/#sec-temporal.plaindate.prototype.toplaindatetime */
function* PlainDateProto_toPlainDateTime([temporalTime = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const plainDate = Q(thisTemporalDateValue(thisValue));
  const time = Q(yield* ToTimeRecordOrMidnight(temporalTime));
  const isoDateTime: ISODateTimeRecord = { ISODate: plainDate.ISODate, Time: time };
  return Q(yield* CreateTemporalDateTime(isoDateTime, plainDate.Calendar));
}

/** https://tc39.es/proposal-temporal/#sec-temporal.plaindate.prototype.tozoneddatetime */
function* PlainDateProto_toZonedDateTime([item = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const plainDate = Q(thisTemporalDateValue(thisValue));
  let timeZone: TimeZoneIdentifier;
  let temporalTime: Value;
  if (item instanceof ObjectValue) {
    const timeZoneLike = Q(yield* Get(item, 'timeZone'));
    if (timeZoneLike === Value.undefined) {
      timeZone = Q(ToTemporalTimeZoneIdentifier(item));
      temporalTime = Value.undefined;
    } else {
      timeZone = Q(ToTemporalTimeZoneIdentifier(timeZoneLike));
      temporalTime = Q(yield* Get(item, 'plainTime'));
    }
  } else {
    timeZone = Q(ToTemporalTimeZoneIdentifier(item));
    temporalTime = Value.undefined;
  }
  let epochNanoseconds: bigint;
  if (temporalTime === Value.undefined) {
    epochNanoseconds = Q(GetStartOfDay(timeZone, plainDate.ISODate));
  } else {
    const temporalTime2 = Q(yield* ToTemporalTime(temporalTime));
    const isoDateTime: ISODateTimeRecord = { ISODate: plainDate.ISODate, Time: temporalTime2.Time };
    if (!ISODateTimeWithinLimits(isoDateTime)) {
      return Throw.RangeError('DateTime outside of range');
    }
    epochNanoseconds = Q(GetEpochNanosecondsFor(timeZone, isoDateTime, 'compatible'));
  }
  return X(CreateTemporalZonedDateTime(epochNanoseconds, timeZone, plainDate.Calendar));
}

/** https://tc39.es/proposal-temporal/#sec-temporal.plaindate.prototype.tostring */
function* PlainDateProto_toString([options = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const plainDate = Q(thisTemporalDateValue(thisValue));
  const resolvedOptions = Q(GetOptionsObject(options));
  const showCalendar = Q(yield* GetTemporalShowCalendarNameOption(resolvedOptions));
  return Value(TemporalDateToString(plainDate, showCalendar));
}

/** https://tc39.es/proposal-temporal/#sec-temporal.plaindate.prototype.tolocalestring */
function PlainDateProto_toLocaleString(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const plainDate = Q(thisTemporalDateValue(thisValue));
  return Value(TemporalDateToString(plainDate, 'auto'));
}

/** https://tc39.es/proposal-temporal/#sec-temporal.plaindate.prototype.tojson */
function PlainDateProto_toJSON(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const plainDate = Q(thisTemporalDateValue(thisValue));
  return Value(TemporalDateToString(plainDate, 'auto'));
}

/** https://tc39.es/proposal-temporal/#sec-temporal.plaindate.prototype.valueof */
function PlainDateProto_valueOf(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  Q(thisTemporalDateValue(thisValue));
  return Throw.TypeError('Temporal.PlainDate cannot be converted to primitive value. If you are comparing two Temporal.PlainDate objects with > or <, use Temporal.PlainDate.compare() instead.');
}

export function bootstrapTemporalPlainDatePrototype(realmRec: Realm) {
  const prototype = bootstrapPrototype(realmRec, [
    ['calendarId', [PlainDateProto_calendarIdGetter]],
    ['era', [PlainDateProto_eraGetter]],
    ['eraYear', [PlainDateProto_eraYearGetter]],
    ['year', [PlainDateProto_yearGetter]],
    ['month', [PlainDateProto_monthGetter]],
    ['monthCode', [PlainDateProto_monthCodeGetter]],
    ['day', [PlainDateProto_dayGetter]],
    ['dayOfWeek', [PlainDateProto_dayOfWeekGetter]],
    ['dayOfYear', [PlainDateProto_dayOfYearGetter]],
    ['weekOfYear', [PlainDateProto_weekOfYearGetter]],
    ['yearOfWeek', [PlainDateProto_yearOfWeekGetter]],
    ['daysInWeek', [PlainDateProto_daysInWeekGetter]],
    ['daysInMonth', [PlainDateProto_daysInMonthGetter]],
    ['daysInYear', [PlainDateProto_daysInYearGetter]],
    ['monthsInYear', [PlainDateProto_monthsInYearGetter]],
    ['inLeapYear', [PlainDateProto_inLeapYearGetter]],
    ['toPlainYearMonth', PlainDateProto_toPlainYearMonth, 0],
    ['toPlainMonthDay', PlainDateProto_toPlainMonthDay, 0],
    ['add', PlainDateProto_add, 1],
    ['subtract', PlainDateProto_subtract, 1],
    ['with', PlainDateProto_with, 1],
    ['withCalendar', PlainDateProto_withCalendar, 1],
    ['until', PlainDateProto_until, 1],
    ['since', PlainDateProto_since, 1],
    ['equals', PlainDateProto_equals, 1],
    ['toPlainDateTime', PlainDateProto_toPlainDateTime, 0],
    ['toZonedDateTime', PlainDateProto_toZonedDateTime, 1],
    ['toString', PlainDateProto_toString, 0],
    ['toLocaleString', PlainDateProto_toLocaleString, 0],
    ['toJSON', PlainDateProto_toJSON, 0],
    ['valueOf', PlainDateProto_valueOf, 0],
  ], realmRec.Intrinsics['%Object.prototype%'], 'Temporal.PlainDate');
  realmRec.Intrinsics['%Temporal.PlainDate.prototype%'] = prototype;
  return prototype;
}
