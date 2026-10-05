import type { ISODateRecord } from '../../intrinsics/Temporal/PlainDate.mts';
import { type TemporalPlainMonthDayObject, isTemporalPlainMonthDayObject } from '../../intrinsics/Temporal/PlainMonthDay.mts';
import { ParseISODateTime } from '../../parser/TemporalParser.mts';
import { ToZeroPaddedDecimalString } from './addition.mts';
import {
  Value, type ValueEvaluator, ObjectValue, Q, GetTemporalOverflowOption, X, GetTemporalCalendarIdentifierWithISODefault, PrepareCalendarFields, CalendarMonthDayFromFields, JSStringValue, Throw, CanonicalizeCalendar, CreateISODateRecord, ISODateWithinLimits, ISODateToFields, type KnownCalendarType, type FunctionObject, surroundingAgent, OrdinaryCreateFromConstructor, type Mutable, PadISOYear, FormatCalendarAnnotation,
  GetOptionsObject,
} from '#self';

/** https://tc39.es/proposal-temporal/#sec-temporal-totemporalmonthday */
export function* ToTemporalMonthDay(
  item: Value,
  options: Value = Value.undefined,
): ValueEvaluator<TemporalPlainMonthDayObject> {
  if (item instanceof ObjectValue) {
    if (isTemporalPlainMonthDayObject(item)) {
      const resolvedOptions = Q(GetOptionsObject(options));
      Q(yield* GetTemporalOverflowOption(resolvedOptions));
      return X(CreateTemporalMonthDay(item.ISODate, item.Calendar));
    }
    const calendar = Q(yield* GetTemporalCalendarIdentifierWithISODefault(item));
    const fields = Q(yield* PrepareCalendarFields(calendar, item, 'date-fields', 'no-non-calendar-fields', 'no-required-fields'));
    const resolvedOptions = Q(GetOptionsObject(options));
    const overflow = Q(yield* GetTemporalOverflowOption(resolvedOptions));
    const isoDate = Q(yield* CalendarMonthDayFromFields(calendar, fields, overflow));
    return X(CreateTemporalMonthDay(isoDate, calendar));
  }
  if (!(item instanceof JSStringValue)) {
    return Throw.TypeError('$1 is not a string', item);
  }
  const result = Q(ParseISODateTime(item.stringValue(), 'month-day'));
  const calendar = result.Calendar ?? 'iso8601';
  const calendarType = Q(CanonicalizeCalendar(calendar));
  const resolvedOptions = Q(GetOptionsObject(options));
  Q(yield* GetTemporalOverflowOption(resolvedOptions));
  if (calendarType === 'iso8601') {
    const referenceISOYear = 1972n;
    const isoDate = X(CreateISODateRecord(referenceISOYear, result.Month, result.Day));
    return X(CreateTemporalMonthDay(isoDate, calendarType));
  }
  let isoDate = X(CreateISODateRecord(result.Year!, result.Month, result.Day));
  if (!ISODateWithinLimits(isoDate)) {
    return Throw.RangeError('PlainMonthDay out of range');
  }
  const result2 = Q(ISODateToFields(calendarType, isoDate, 'month-day'));
  isoDate = Q(yield* CalendarMonthDayFromFields(calendarType, result2, 'constrain'));
  return X(CreateTemporalMonthDay(isoDate, calendarType));
}

/** https://tc39.es/proposal-temporal/#sec-temporal-createtemporalmonthday */
export function* CreateTemporalMonthDay(
  isoDate: ISODateRecord,
  calendar: KnownCalendarType,
  newTarget?: FunctionObject,
): ValueEvaluator<TemporalPlainMonthDayObject> {
  if (!ISODateWithinLimits(isoDate)) {
    return Throw.RangeError('PlainMonthDay out of range');
  }
  if (newTarget === undefined) {
    newTarget = surroundingAgent.intrinsic('%Temporal.PlainMonthDay%');
  }
  const object = Q(yield* OrdinaryCreateFromConstructor(newTarget, '%Temporal.PlainMonthDay.prototype%', [
    'InitializedTemporalMonthDay',
    'ISODate',
    'Calendar',
  ])) as Mutable<TemporalPlainMonthDayObject>;
  object.ISODate = isoDate;
  object.Calendar = calendar;
  return object;
}

/** https://tc39.es/proposal-temporal/#sec-temporal-temporalmonthdaytostring */
export function TemporalMonthDayToString(
  monthDay: TemporalPlainMonthDayObject,
  showCalendar: 'auto' | 'always' | 'never' | 'critical',
): string {
  const month = ToZeroPaddedDecimalString(monthDay.ISODate.Month, 2n);
  const day = ToZeroPaddedDecimalString(monthDay.ISODate.Day, 2n);
  let result = `${month}-${day}`;
  if ((showCalendar === 'always' || showCalendar === 'critical') || monthDay.Calendar !== 'iso8601') {
    const year = PadISOYear(monthDay.ISODate.Year);
    result = `${year}-${result}`;
  }
  const calendarString = FormatCalendarAnnotation(monthDay.Calendar, showCalendar);
  return result + calendarString;
}
