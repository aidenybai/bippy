import { SystemTimeZoneIdentifier } from '../../abstract-ops/temporal/addition.mts';
import { ToTemporalTimeZoneIdentifier } from '../../abstract-ops/temporal/time-zone.mts';
import { bootstrapPrototype } from '../bootstrap.mts';
import {
  type Realm, X, Value, Q, type Arguments, type PlainCompletion,
  CreateTemporalInstant,
  SystemDateTime,
  SystemUTCEpochNanoseconds,
  CreateTemporalDate,
  CreateTemporalZonedDateTime,
  CreateTemporalDateTime,
  CreateTemporalTime,
} from '#self';

/** https://tc39.es/proposal-temporal/#sec-temporal.now.timezoneid */
function TemporalNow_timeZoneId(): Value {
  return Value(SystemTimeZoneIdentifier());
}

/** https://tc39.es/proposal-temporal/#sec-temporal.now.instant */
function TemporalNow_instant(): Value {
  const ns = SystemUTCEpochNanoseconds();
  return X(CreateTemporalInstant(ns));
}

/** https://tc39.es/proposal-temporal/#sec-temporal.now.plaindatetimeiso */
function TemporalNow_plainDateTimeISO([temporalTimeZoneLike = Value.undefined]: Arguments): PlainCompletion<Value> {
  const isoDateTime = Q(SystemDateTime(temporalTimeZoneLike));
  return X(CreateTemporalDateTime(isoDateTime, 'iso8601'));
}

/** https://tc39.es/proposal-temporal/#sec-temporal.now.zoneddatetimeiso */
function TemporalNow_zonedDateTimeISO([temporalTimeZoneLike = Value.undefined]: Arguments): PlainCompletion<Value> {
  let timeZone;
  if (temporalTimeZoneLike === Value.undefined) {
    timeZone = SystemTimeZoneIdentifier();
  } else {
    timeZone = Q(ToTemporalTimeZoneIdentifier(temporalTimeZoneLike));
  }
  const ns = SystemUTCEpochNanoseconds();
  return X(CreateTemporalZonedDateTime(ns, timeZone, 'iso8601'));
}

/** https://tc39.es/proposal-temporal/#sec-temporal.now.plaindateiso */
function TemporalNow_plainDateISO([temporalTimeZoneLike = Value.undefined]: Arguments): PlainCompletion<Value> {
  const isoDateTime = Q(SystemDateTime(temporalTimeZoneLike));
  return X(CreateTemporalDate(isoDateTime.ISODate, 'iso8601'));
}

/** https://tc39.es/proposal-temporal/#sec-temporal.now.plaintimeiso */
function TemporalNow_plainTimeISO([temporalTimeZoneLike = Value.undefined]: Arguments): PlainCompletion<Value> {
  const isoDateTime = Q(SystemDateTime(temporalTimeZoneLike));
  return X(CreateTemporalTime(isoDateTime.Time));
}

export function bootstrapTemporalNow(realmRec: Realm) {
  const Now = bootstrapPrototype(realmRec, [
    ['timeZoneId', TemporalNow_timeZoneId, 0],
    ['instant', TemporalNow_instant, 0],
    ['plainDateTimeISO', TemporalNow_plainDateTimeISO, 0],
    ['zonedDateTimeISO', TemporalNow_zonedDateTimeISO, 0],
    ['plainDateISO', TemporalNow_plainDateISO, 0],
    ['plainTimeISO', TemporalNow_plainTimeISO, 0],
  ], realmRec.Intrinsics['%Object.prototype%'], 'Temporal.Now');
  return Now;
}
