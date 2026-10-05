import { bootstrapPrototype } from '../bootstrap.mts';
import {
  GetTemporalOverflowOption,
  GetTemporalShowCalendarNameOption,
  IsPartialTemporalObject,
  ISODateToFields,
} from '../../abstract-ops/temporal/temporal.mts';
import {
  CalendarDateFromFields,
  CalendarISOToDate,
  CalendarMergeFields,
  CalendarYearMonthFromFields,
  PrepareCalendarFields,
} from '../../abstract-ops/temporal/calendar.mts';
import { CompareISODate, CreateTemporalDate } from '../../abstract-ops/temporal/plain-date.mts';
import {
  AddDurationToYearMonth,
  CreateTemporalYearMonth,
  DifferenceTemporalPlainYearMonth,
  TemporalYearMonthToString,
  ToTemporalYearMonth,
} from '../../abstract-ops/temporal/plain-year-month.mts';
import type { TemporalPlainYearMonthObject } from './PlainYearMonth.mts';
import {
  F,
  GetOptionsObject,
  ObjectValue,
  Q,
  RequireInternalSlot,
  Throw,
  Value,
  X,
  type Arguments,
  type FunctionCallContext,
  type PlainCompletion,
  type Realm,
  type ValueEvaluator,
} from '#self';

function thisTemporalYearMonthValue(value: Value): PlainCompletion<TemporalPlainYearMonthObject> {
  Q(RequireInternalSlot(value, 'InitializedTemporalYearMonth'));
  return value as TemporalPlainYearMonthObject;
}

/** https://tc39.es/proposal-temporal/#sec-get-temporal.plainyearmonth.prototype.calendarid */
function PlainYearMonthProto_calendarIdGetter(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const plainYearMonth = Q(thisTemporalYearMonthValue(thisValue));
  return Value(plainYearMonth.Calendar);
}

/** https://tc39.es/proposal-temporal/#sec-get-temporal.plainyearmonth.prototype.era */
function PlainYearMonthProto_eraGetter(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const plainYearMonth = Q(thisTemporalYearMonthValue(thisValue));
  const result = CalendarISOToDate(plainYearMonth.Calendar, plainYearMonth.ISODate).Era;
  if (result === undefined) return Value.undefined;
  return Value(result);
}

/** https://tc39.es/proposal-temporal/#sec-get-temporal.plainyearmonth.prototype.erayear */
function PlainYearMonthProto_eraYearGetter(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const plainYearMonth = Q(thisTemporalYearMonthValue(thisValue));
  const result = CalendarISOToDate(plainYearMonth.Calendar, plainYearMonth.ISODate).EraYear;
  return result === undefined ? Value.undefined : F(Number(result));
}

/** https://tc39.es/proposal-temporal/#sec-get-temporal.plainyearmonth.prototype.year */
function PlainYearMonthProto_yearGetter(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const plainYearMonth = Q(thisTemporalYearMonthValue(thisValue));
  return F(Number(CalendarISOToDate(plainYearMonth.Calendar, plainYearMonth.ISODate).Year));
}

/** https://tc39.es/proposal-temporal/#sec-get-temporal.plainyearmonth.prototype.month */
function PlainYearMonthProto_monthGetter(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const plainYearMonth = Q(thisTemporalYearMonthValue(thisValue));
  return F(Number(CalendarISOToDate(plainYearMonth.Calendar, plainYearMonth.ISODate).Month));
}

/** https://tc39.es/proposal-temporal/#sec-get-temporal.plainyearmonth.prototype.monthcode */
function PlainYearMonthProto_monthCodeGetter(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const plainYearMonth = Q(thisTemporalYearMonthValue(thisValue));
  return Value(CalendarISOToDate(plainYearMonth.Calendar, plainYearMonth.ISODate).MonthCode);
}

/** https://tc39.es/proposal-temporal/#sec-get-temporal.plainyearmonth.prototype.daysinyear */
function PlainYearMonthProto_daysInYearGetter(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const plainYearMonth = Q(thisTemporalYearMonthValue(thisValue));
  return F(Number(CalendarISOToDate(plainYearMonth.Calendar, plainYearMonth.ISODate).DaysInYear));
}

/** https://tc39.es/proposal-temporal/#sec-get-temporal.plainyearmonth.prototype.daysinmonth */
function PlainYearMonthProto_daysInMonthGetter(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const plainYearMonth = Q(thisTemporalYearMonthValue(thisValue));
  return F(Number(CalendarISOToDate(plainYearMonth.Calendar, plainYearMonth.ISODate).DaysInMonth));
}

/** https://tc39.es/proposal-temporal/#sec-get-temporal.plainyearmonth.prototype.monthsinyear */
function PlainYearMonthProto_monthsInYearGetter(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const plainYearMonth = Q(thisTemporalYearMonthValue(thisValue));
  return F(Number(CalendarISOToDate(plainYearMonth.Calendar, plainYearMonth.ISODate).MonthsInYear));
}

/** https://tc39.es/proposal-temporal/#sec-get-temporal.plainyearmonth.prototype.inleapyear */
function PlainYearMonthProto_inLeapYearGetter(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const plainYearMonth = Q(thisTemporalYearMonthValue(thisValue));
  return Value(CalendarISOToDate(plainYearMonth.Calendar, plainYearMonth.ISODate).InLeapYear);
}

/** https://tc39.es/proposal-temporal/#sec-temporal.plainyearmonth.prototype.with */
function* PlainYearMonthProto_with([temporalYearMonthLike = Value.undefined, options = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const plainYearMonth = Q(thisTemporalYearMonthValue(thisValue));
  if (!Q(yield* IsPartialTemporalObject(temporalYearMonthLike))) {
    return Throw.TypeError('$1 is not a partial Temporal object', temporalYearMonthLike);
  }
  const calendar = plainYearMonth.Calendar;
  let fields = ISODateToFields(calendar, plainYearMonth.ISODate, 'year-month');
  const partialYearMonth = Q(yield* PrepareCalendarFields(calendar, temporalYearMonthLike as ObjectValue, 'year-month-fields', 'no-non-calendar-fields', 'partial'));
  fields = CalendarMergeFields(calendar, fields, partialYearMonth);
  const resolvedOptions = Q(GetOptionsObject(options));
  const overflow = Q(yield* GetTemporalOverflowOption(resolvedOptions));
  const isoDate = Q(yield* CalendarYearMonthFromFields(calendar, fields, overflow));
  return X(CreateTemporalYearMonth(isoDate, calendar));
}

/** https://tc39.es/proposal-temporal/#sec-temporal.plainyearmonth.prototype.add */
function* PlainYearMonthProto_add([temporalDurationLike = Value.undefined, options = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const plainYearMonth = Q(thisTemporalYearMonthValue(thisValue));
  return Q(yield* AddDurationToYearMonth('add', plainYearMonth, temporalDurationLike, options));
}

/** https://tc39.es/proposal-temporal/#sec-temporal.plainyearmonth.prototype.subtract */
function* PlainYearMonthProto_subtract([temporalDurationLike = Value.undefined, options = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const plainYearMonth = Q(thisTemporalYearMonthValue(thisValue));
  return Q(yield* AddDurationToYearMonth('subtract', plainYearMonth, temporalDurationLike, options));
}

/** https://tc39.es/proposal-temporal/#sec-temporal.plainyearmonth.prototype.until */
function* PlainYearMonthProto_until([other = Value.undefined, options = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const plainYearMonth = Q(thisTemporalYearMonthValue(thisValue));
  return Q(yield* DifferenceTemporalPlainYearMonth('until', plainYearMonth, other, options));
}

/** https://tc39.es/proposal-temporal/#sec-temporal.plainyearmonth.prototype.since */
function* PlainYearMonthProto_since([other = Value.undefined, options = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const plainYearMonth = Q(thisTemporalYearMonthValue(thisValue));
  return Q(yield* DifferenceTemporalPlainYearMonth('since', plainYearMonth, other, options));
}

/** https://tc39.es/proposal-temporal/#sec-temporal.plainyearmonth.prototype.equals */
function* PlainYearMonthProto_equals([_other = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const plainYearMonth = Q(thisTemporalYearMonthValue(thisValue));
  const other = Q(yield* ToTemporalYearMonth(_other));
  if (CompareISODate(plainYearMonth.ISODate, other.ISODate) !== 0n) {
    return Value.false;
  }
  if (plainYearMonth.Calendar !== other.Calendar) return Value.false;
  return Value.true;
}

/** https://tc39.es/proposal-temporal/#sec-temporal.plainyearmonth.prototype.tostring */
function* PlainYearMonthProto_toString([options = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const plainYearMonth = Q(thisTemporalYearMonthValue(thisValue));
  const resolvedOptions = Q(GetOptionsObject(options));
  const showCalendar = Q(yield* GetTemporalShowCalendarNameOption(resolvedOptions));
  return Value(TemporalYearMonthToString(plainYearMonth, showCalendar));
}

/** https://tc39.es/proposal-temporal/#sec-temporal.plainyearmonth.prototype.tolocalestring */
function PlainYearMonthProto_toLocaleString(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const plainYearMonth = Q(thisTemporalYearMonthValue(thisValue));
  return Value(TemporalYearMonthToString(plainYearMonth, 'auto'));
}

/** https://tc39.es/proposal-temporal/#sec-temporal.plainyearmonth.prototype.tojson */
function PlainYearMonthProto_toJSON(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const plainYearMonth = Q(thisTemporalYearMonthValue(thisValue));
  return Value(TemporalYearMonthToString(plainYearMonth, 'auto'));
}

/** https://tc39.es/proposal-temporal/#sec-temporal.plainyearmonth.prototype.valueof */
function PlainYearMonthProto_valueOf(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  Q(thisTemporalYearMonthValue(thisValue));
  return Throw.TypeError('Temporal.PlainYearMonth cannot be converted to primitive value. If you are comparing two Temporal.PlainYearMonth objects with > or <, use Temporal.PlainYearMonth.compare() instead.');
}

/** https://tc39.es/proposal-temporal/#sec-temporal.plainyearmonth.prototype.toplaindate */
function* PlainYearMonthProto_toPlainDate([item = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const plainYearMonth = Q(thisTemporalYearMonthValue(thisValue));
  if (!(item instanceof ObjectValue)) {
    return Throw.TypeError('$1 is not an object', item);
  }
  const calendar = plainYearMonth.Calendar;
  const fields = ISODateToFields(calendar, plainYearMonth.ISODate, 'year-month');
  const inputFields = Q(yield* PrepareCalendarFields(calendar, item, 'only-day', 'no-non-calendar-fields', 'no-required-fields'));
  const mergedFields = CalendarMergeFields(calendar, fields, inputFields);
  const isoDate = Q(yield* CalendarDateFromFields(calendar, mergedFields, 'constrain'));
  return X(CreateTemporalDate(isoDate, calendar));
}

export function bootstrapTemporalPlainYearMonthPrototype(realmRec: Realm) {
  const prototype = bootstrapPrototype(realmRec, [
    ['calendarId', [PlainYearMonthProto_calendarIdGetter]],
    ['era', [PlainYearMonthProto_eraGetter]],
    ['eraYear', [PlainYearMonthProto_eraYearGetter]],
    ['year', [PlainYearMonthProto_yearGetter]],
    ['month', [PlainYearMonthProto_monthGetter]],
    ['monthCode', [PlainYearMonthProto_monthCodeGetter]],
    ['daysInYear', [PlainYearMonthProto_daysInYearGetter]],
    ['daysInMonth', [PlainYearMonthProto_daysInMonthGetter]],
    ['monthsInYear', [PlainYearMonthProto_monthsInYearGetter]],
    ['inLeapYear', [PlainYearMonthProto_inLeapYearGetter]],
    ['with', PlainYearMonthProto_with, 1],
    ['add', PlainYearMonthProto_add, 1],
    ['subtract', PlainYearMonthProto_subtract, 1],
    ['until', PlainYearMonthProto_until, 1],
    ['since', PlainYearMonthProto_since, 1],
    ['equals', PlainYearMonthProto_equals, 1],
    ['toString', PlainYearMonthProto_toString, 0],
    ['toLocaleString', PlainYearMonthProto_toLocaleString, 0],
    ['toJSON', PlainYearMonthProto_toJSON, 0],
    ['valueOf', PlainYearMonthProto_valueOf, 0],
    ['toPlainDate', PlainYearMonthProto_toPlainDate, 1],
  ], realmRec.Intrinsics['%Object.prototype%'], 'Temporal.PlainYearMonth');
  realmRec.Intrinsics['%Temporal.PlainYearMonth.prototype%'] = prototype;
  return prototype;
}
