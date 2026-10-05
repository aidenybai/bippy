import { bootstrapConstructor } from '../bootstrap.mts';
import {
  CanonicalizeCalendar,
  type KnownCalendarType,
} from '../../abstract-ops/temporal/calendar.mts';
import { SnapToInteger } from '../../abstract-ops/type-conversion.mts';
import { bootstrapTemporalPlainDateTimePrototype } from './PlainDateTimePrototype.mts';
import type { ISODateRecord } from './PlainDate.mts';
import {
  JSStringValue,
  Q,
  Throw,
  Value,
  type OrdinaryObject,
  type ValueEvaluator,
  type Realm,
  type Arguments,
  type FunctionCallContext,
  UndefinedValue,
  F,
  CompareISODateTime,
  CreateISODateRecord,
  CreateTemporalDateTime,
  CreateTimeRecord,
  ToTemporalDateTime,
  type TimeRecord,
} from '#self';

/** https://tc39.es/proposal-temporal/#sec-properties-of-temporal-plaindatetime-instances */
export interface TemporalPlainDateTimeObject extends OrdinaryObject {
  readonly InitializedTemporalDateTime: never;
  readonly ISODateTime: ISODateTimeRecord;
  readonly Calendar: KnownCalendarType;
}
export function isTemporalPlainDateTimeObject(o: Value): o is TemporalPlainDateTimeObject {
  return 'InitializedTemporalDateTime' in o;
}

/** https://tc39.es/proposal-temporal/#sec-temporal-iso-date-time-records */
export interface ISODateTimeRecord {
  readonly ISODate: ISODateRecord;
  readonly Time: TimeRecord;
}

/** https://tc39.es/proposal-temporal/#sec-temporal.plaindatetime */
function* PlainDateTimeConstructor([
  _isoYear = Value.undefined,
  _isoMonth = Value.undefined,
  _isoDay = Value.undefined,
  _hour = Value.undefined,
  _minute = Value.undefined,
  _second = Value.undefined,
  _millisecond = Value.undefined,
  _microsecond = Value.undefined,
  _nanosecond = Value.undefined,
  _calendar = Value.undefined,
]: Arguments, { NewTarget }: FunctionCallContext): ValueEvaluator {
  if (NewTarget instanceof UndefinedValue) {
    return Throw.TypeError('Temporal.PlainDateTime cannot be called without new');
  }
  const isoYear = Q(yield* SnapToInteger(_isoYear, 'truncate'));
  const isoMonth = Q(yield* SnapToInteger(_isoMonth, 'truncate'));
  const isoDay = Q(yield* SnapToInteger(_isoDay, 'truncate'));
  const hour = _hour instanceof UndefinedValue ? 0n : Q(yield* SnapToInteger(_hour, 'truncate'));
  const minute = _minute instanceof UndefinedValue ? 0n : Q(yield* SnapToInteger(_minute, 'truncate'));
  const second = _second instanceof UndefinedValue ? 0n : Q(yield* SnapToInteger(_second, 'truncate'));
  const millisecond = _millisecond instanceof UndefinedValue ? 0n : Q(yield* SnapToInteger(_millisecond, 'truncate'));
  const microsecond = _microsecond instanceof UndefinedValue ? 0n : Q(yield* SnapToInteger(_microsecond, 'truncate'));
  const nanosecond = _nanosecond instanceof UndefinedValue ? 0n : Q(yield* SnapToInteger(_nanosecond, 'truncate'));
  if (_calendar instanceof UndefinedValue) {
    _calendar = Value('iso8601');
  }
  if (!(_calendar instanceof JSStringValue)) {
    return Throw.TypeError('calendar is not a string');
  }
  const calendar = Q(CanonicalizeCalendar(_calendar.stringValue()));
  const isoDate = Q(CreateISODateRecord(isoYear, isoMonth, isoDay));
  const time = Q(CreateTimeRecord(hour, minute, second, millisecond, microsecond, nanosecond));
  const isoDateTime: ISODateTimeRecord = { ISODate: isoDate, Time: time };
  return Q(yield* CreateTemporalDateTime(isoDateTime, calendar, NewTarget));
}

/** https://tc39.es/proposal-temporal/#sec-temporal.plaindatetime.from */
function* PlainDateTime_from([item = Value.undefined, options = Value.undefined]: Arguments): ValueEvaluator {
  return Q(yield* ToTemporalDateTime(item, options));
}

/** https://tc39.es/proposal-temporal/#sec-temporal.plaindatetime.compare */
function* PlainDateTime_compare([_xPlainDateTime = Value.undefined, _yPlainDateTime = Value.undefined]: Arguments): ValueEvaluator {
  const xPlainDateTime = Q(yield* ToTemporalDateTime(_xPlainDateTime));
  const yPlainDateTime = Q(yield* ToTemporalDateTime(_yPlainDateTime));
  return F(Number(CompareISODateTime(xPlainDateTime.ISODateTime, yPlainDateTime.ISODateTime)));
}

export function bootstrapTemporalPlainDateTime(realmRec: Realm) {
  const prototype = bootstrapTemporalPlainDateTimePrototype(realmRec);

  const constructor = bootstrapConstructor(realmRec, PlainDateTimeConstructor, 'PlainDateTime', 3, prototype, [
    ['from', PlainDateTime_from, 1],
    ['compare', PlainDateTime_compare, 2],
  ]);
  realmRec.Intrinsics['%Temporal.PlainDateTime%'] = constructor;
  return constructor;
}
