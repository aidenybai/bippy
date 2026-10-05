import { bootstrapConstructor } from '../bootstrap.mts';
import { SnapToInteger } from '../../abstract-ops/type-conversion.mts';
import { bootstrapTemporalPlainDatePrototype } from './PlainDatePrototype.mts';
import {
  type Realm, Value, UndefinedValue, Q, JSStringValue, type FunctionCallContext, type Arguments, F, type OrdinaryObject, type ValueEvaluator,
  Throw,
  CompareISODate,
  CreateISODateRecord,
  CreateTemporalDate,
  ToTemporalDate,
  type KnownCalendarType,
  CanonicalizeCalendar,
  type Integer,
} from '#self';

export interface TemporalPlainDateObject extends OrdinaryObject {
  /** https://tc39.es/proposal-temporal/#sec-properties-of-temporal-plaindate-instances */
  readonly InitializedTemporalDate: never;
  readonly ISODate: ISODateRecord;
  readonly Calendar: KnownCalendarType;
}
export function isTemporalPlainDateObject(o: Value): o is TemporalPlainDateObject {
  return 'InitializedTemporalDate' in o;
}

/** https://tc39.es/proposal-temporal/#sec-temporal-iso-date-records */
export interface ISODateRecord {
  readonly Year: Integer;
  readonly Month: Integer;
  readonly Day: Integer;
}

/** https://tc39.es/proposal-temporal/#sec-temporal.plaindate */
function* PlainDateConstructor([isoYear = Value.undefined, isoMonth = Value.undefined, isoDay = Value.undefined, _calendar = Value.undefined]: Arguments, { NewTarget }: FunctionCallContext) {
  if (NewTarget instanceof UndefinedValue) {
    return Throw.TypeError('Temporal.PlainDate constructor cannot be called without new');
  }
  const year = Q(yield* SnapToInteger(isoYear, 'truncate'));
  const month = Q(yield* SnapToInteger(isoMonth, 'truncate'));
  const day = Q(yield* SnapToInteger(isoDay, 'truncate'));
  if (_calendar instanceof UndefinedValue) {
    _calendar = Value('iso8601');
  }
  if (!(_calendar instanceof JSStringValue)) {
    return Throw.TypeError('calendar must be a string, but $1', _calendar);
  }
  const calendar = Q(CanonicalizeCalendar(_calendar.stringValue()));
  const isoDate = Q(CreateISODateRecord(year, month, day));
  return Q(yield* CreateTemporalDate(isoDate, calendar, NewTarget));
}

/** https://tc39.es/proposal-temporal/#sec-temporal.plaindate.from */
function* PlainDate_From([item = Value.undefined, options = Value.undefined]: Arguments): ValueEvaluator {
  return Q(yield* ToTemporalDate(item, options));
}

/** https://tc39.es/proposal-temporal/#sec-temporal.plaindate.compare */
function* PlainDate_Compare([_xPlainDate = Value.undefined, _yPlainDate = Value.undefined]: Arguments): ValueEvaluator {
  const xPlainDate = Q(yield* ToTemporalDate(_xPlainDate));
  const yPlainDate = Q(yield* ToTemporalDate(_yPlainDate));
  return F(Number(CompareISODate(xPlainDate.ISODate, yPlainDate.ISODate)));
}

export function bootstrapTemporalPlainDate(realmRec: Realm) {
  const prototype = bootstrapTemporalPlainDatePrototype(realmRec);
  realmRec.Intrinsics['%Temporal.PlainDate.prototype%'] = prototype;

  const constructor = bootstrapConstructor(realmRec, PlainDateConstructor, 'PlainDate', 3, prototype, [
    ['from', PlainDate_From, 1],
    ['compare', PlainDate_Compare, 2],
  ]);
  realmRec.Intrinsics['%Temporal.PlainDate%'] = constructor;

  return constructor;
}
