import { bootstrapConstructor } from '../bootstrap.mts';
import {
  CanonicalizeCalendar,
  type KnownCalendarType,
} from '../../abstract-ops/temporal/calendar.mts';
import { SnapToInteger } from '../../abstract-ops/type-conversion.mts';
import { bootstrapTemporalPlainYearMonthPrototype } from './PlainYearMonthPrototype.mts';
import type { ISODateRecord } from './PlainDate.mts';
import {
  JSStringValue,
  Q,
  Throw,
  Value,
  UndefinedValue,
  F,
  type Arguments,
  type FunctionCallContext,
  type Realm,
  type OrdinaryObject,
  type ValueEvaluator,
  CompareISODate,
  CreateISODateRecord,
  CreateTemporalYearMonth,
  ToTemporalYearMonth,
} from '#self';

/** https://tc39.es/proposal-temporal/#sec-properties-of-temporal-plainyearmonth-instances */
export interface TemporalPlainYearMonthObject extends OrdinaryObject {
  readonly InitializedTemporalYearMonth: never;
  readonly ISODate: ISODateRecord;
  readonly Calendar: KnownCalendarType;
}

export function isTemporalPlainYearMonthObject(o: Value): o is TemporalPlainYearMonthObject {
  return 'InitializedTemporalYearMonth' in o;
}

/** https://tc39.es/proposal-temporal/#sec-temporal-iso-year-month-records */
export interface ISOYearMonthRecord {
  readonly Year: bigint;
  readonly Month: bigint;
}

/** https://tc39.es/proposal-temporal/#sec-temporal.plainyearmonth */
function* PlainYearMonthConstructor([
  isoYear = Value.undefined,
  isoMonth = Value.undefined,
  _calendar = Value.undefined,
  referenceISODay = Value.undefined,
]: Arguments, { NewTarget }: FunctionCallContext): ValueEvaluator {
  if (NewTarget instanceof UndefinedValue) {
    return Throw.TypeError('Temporal.PlainYearMonth cannot be called without new');
  }
  if (referenceISODay instanceof UndefinedValue) {
    referenceISODay = F(1);
  }
  const year = Q(yield* SnapToInteger(isoYear, 'truncate'));
  const month = Q(yield* SnapToInteger(isoMonth, 'truncate'));
  if (_calendar instanceof UndefinedValue) {
    _calendar = Value('iso8601');
  }
  if (!(_calendar instanceof JSStringValue)) {
    return Throw.TypeError('calendar is not a string');
  }
  const calendar = Q(CanonicalizeCalendar(_calendar.stringValue()));
  const ref = Q(yield* SnapToInteger(referenceISODay, 'truncate'));
  const isoDate = Q(CreateISODateRecord(year, month, ref));
  return Q(yield* CreateTemporalYearMonth(isoDate, calendar, NewTarget));
}

/** https://tc39.es/proposal-temporal/#sec-temporal.plainyearmonth.from */
function* PlainYearMonth_from([item = Value.undefined, options = Value.undefined]: Arguments): ValueEvaluator {
  return Q(yield* ToTemporalYearMonth(item, options));
}

/** https://tc39.es/proposal-temporal/#sec-temporal.plainyearmonth.compare */
function* PlainYearMonth_compare([_xPlainYearMonth = Value.undefined, _yPlainYearMonth = Value.undefined]: Arguments): ValueEvaluator {
  const xPlainYearMonth = Q(yield* ToTemporalYearMonth(_xPlainYearMonth));
  const yPlainYearMonth = Q(yield* ToTemporalYearMonth(_yPlainYearMonth));
  return F(Number(CompareISODate(xPlainYearMonth.ISODate, yPlainYearMonth.ISODate)));
}

export function bootstrapTemporalPlainYearMonth(realmRec: Realm) {
  const prototype = bootstrapTemporalPlainYearMonthPrototype(realmRec);

  const constructor = bootstrapConstructor(realmRec, PlainYearMonthConstructor, 'PlainYearMonth', 2, prototype, [
    ['from', PlainYearMonth_from, 1],
    ['compare', PlainYearMonth_compare, 2],
  ]);
  realmRec.Intrinsics['%Temporal.PlainYearMonth%'] = constructor;
  return constructor;
}
