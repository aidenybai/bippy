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
  CalendarMonthDayFromFields,
  PrepareCalendarFields,
} from '../../abstract-ops/temporal/calendar.mts';
import { CompareISODate, CreateTemporalDate } from '../../abstract-ops/temporal/plain-date.mts';
import { CreateTemporalMonthDay, TemporalMonthDayToString, ToTemporalMonthDay } from '../../abstract-ops/temporal/plain-month-day.mts';
import type { TemporalPlainMonthDayObject } from './PlainMonthDay.mts';
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

function thisTemporalMonthDayValue(value: Value): PlainCompletion<TemporalPlainMonthDayObject> {
  Q(RequireInternalSlot(value, 'InitializedTemporalMonthDay'));
  return value as TemporalPlainMonthDayObject;
}

/** https://tc39.es/proposal-temporal/#sec-get-temporal.plainmonthday.prototype.calendarid */
function PlainMonthDayProto_calendarIdGetter(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const plainMonthDay = Q(thisTemporalMonthDayValue(thisValue));
  return Value(plainMonthDay.Calendar);
}

/** https://tc39.es/proposal-temporal/#sec-get-temporal.plainmonthday.prototype.monthcode */
function PlainMonthDayProto_monthCodeGetter(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const plainMonthDay = Q(thisTemporalMonthDayValue(thisValue));
  return Value(CalendarISOToDate(plainMonthDay.Calendar, plainMonthDay.ISODate).MonthCode);
}

/** https://tc39.es/proposal-temporal/#sec-get-temporal.plainmonthday.prototype.day */
function PlainMonthDayProto_dayGetter(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const plainMonthDay = Q(thisTemporalMonthDayValue(thisValue));
  return F(Number(CalendarISOToDate(plainMonthDay.Calendar, plainMonthDay.ISODate).Day));
}

/** https://tc39.es/proposal-temporal/#sec-temporal.plainmonthday.prototype.with */
function* PlainMonthDayProto_with([temporalMonthDayLike = Value.undefined, options = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const plainMonthDay = Q(thisTemporalMonthDayValue(thisValue));
  if (!Q(yield* IsPartialTemporalObject(temporalMonthDayLike))) {
    return Throw.TypeError('$1 is not a partial Temporal object', temporalMonthDayLike);
  }
  const calendar = plainMonthDay.Calendar;
  let fields = ISODateToFields(calendar, plainMonthDay.ISODate, 'month-day');
  const partialMonthDay = Q(yield* PrepareCalendarFields(calendar, temporalMonthDayLike as ObjectValue, 'date-fields', 'no-non-calendar-fields', 'partial'));
  fields = CalendarMergeFields(calendar, fields, partialMonthDay);
  const resolvedOptions = Q(GetOptionsObject(options));
  const overflow = Q(yield* GetTemporalOverflowOption(resolvedOptions));
  const isoDate = Q(yield* CalendarMonthDayFromFields(calendar, fields, overflow));
  return X(CreateTemporalMonthDay(isoDate, calendar));
}

/** https://tc39.es/proposal-temporal/#sec-temporal.plainmonthday.prototype.equals */
function* PlainMonthDayProto_equals([_other = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const plainMonthDay = Q(thisTemporalMonthDayValue(thisValue));
  const other = Q(yield* ToTemporalMonthDay(_other));
  if (CompareISODate(plainMonthDay.ISODate, other.ISODate) !== 0n) {
    return Value.false;
  }
  if (plainMonthDay.Calendar !== other.Calendar) return Value.false;
  return Value.true;
}

/** https://tc39.es/proposal-temporal/#sec-temporal.plainmonthday.prototype.tostring */
function* PlainMonthDayProto_toString([options = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const plainMonthDay = Q(thisTemporalMonthDayValue(thisValue));
  const resolvedOptions = Q(GetOptionsObject(options));
  const showCalendar = Q(yield* GetTemporalShowCalendarNameOption(resolvedOptions));
  return Value(TemporalMonthDayToString(plainMonthDay, showCalendar));
}

/** https://tc39.es/proposal-temporal/#sec-temporal.plainmonthday.prototype.tolocalestring */
function PlainMonthDayProto_toLocaleString(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const plainMonthDay = Q(thisTemporalMonthDayValue(thisValue));
  return Value(TemporalMonthDayToString(plainMonthDay, 'auto'));
}

/** https://tc39.es/proposal-temporal/#sec-temporal.plainmonthday.prototype.tojson */
function PlainMonthDayProto_toJSON(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  const plainMonthDay = Q(thisTemporalMonthDayValue(thisValue));
  return Value(TemporalMonthDayToString(plainMonthDay, 'auto'));
}

/** https://tc39.es/proposal-temporal/#sec-temporal.plainmonthday.prototype.valueof */
function PlainMonthDayProto_valueOf(_args: Arguments, { thisValue }: FunctionCallContext): PlainCompletion<Value> {
  Q(thisTemporalMonthDayValue(thisValue));
  return Throw.TypeError('Temporal.PlainMonthDay cannot be converted to primitive value. If you are comparing two Temporal.PlainMonthDay objects with > or <, use Temporal.PlainMonthDay.compare() instead.');
}

/** https://tc39.es/proposal-temporal/#sec-temporal.plainmonthday.prototype.toplaindate */
function* PlainMonthDayProto_toPlainDate([item = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const plainMonthDay = Q(thisTemporalMonthDayValue(thisValue));
  if (!(item instanceof ObjectValue)) {
    return Throw.TypeError('$1 is not an object', item);
  }
  const calendar = plainMonthDay.Calendar;
  const fields = ISODateToFields(calendar, plainMonthDay.ISODate, 'month-day');
  const inputFields = Q(yield* PrepareCalendarFields(calendar, item, 'only-year', 'no-non-calendar-fields', 'no-required-fields'));
  const mergedFields = CalendarMergeFields(calendar, fields, inputFields);
  const isoDate = Q(yield* CalendarDateFromFields(calendar, mergedFields, 'constrain'));
  return X(CreateTemporalDate(isoDate, calendar));
}

export function bootstrapTemporalPlainMonthDayPrototype(realmRec: Realm) {
  const prototype = bootstrapPrototype(realmRec, [
    ['calendarId', [PlainMonthDayProto_calendarIdGetter]],
    ['monthCode', [PlainMonthDayProto_monthCodeGetter]],
    ['day', [PlainMonthDayProto_dayGetter]],
    ['with', PlainMonthDayProto_with, 1],
    ['equals', PlainMonthDayProto_equals, 1],
    ['toString', PlainMonthDayProto_toString, 0],
    ['toLocaleString', PlainMonthDayProto_toLocaleString, 0],
    ['toJSON', PlainMonthDayProto_toJSON, 0],
    ['valueOf', PlainMonthDayProto_valueOf, 0],
    ['toPlainDate', PlainMonthDayProto_toPlainDate, 1],
  ], realmRec.Intrinsics['%Object.prototype%'], 'Temporal.PlainMonthDay');
  realmRec.Intrinsics['%Temporal.PlainMonthDay.prototype%'] = prototype;
  return prototype;
}
