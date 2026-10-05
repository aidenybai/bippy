import type { ISODateTimeRecord } from '../../intrinsics/Temporal/PlainDateTime.mts';
import { HostSystemUTCEpochNanoseconds } from '../date-objects.mts';
import { SystemTimeZoneIdentifier } from './addition.mts';
import {
  GetGlobalObject, Value, type PlainCompletion, Q, ToTemporalTimeZoneIdentifier, GetISODateTimeFor,
  type EpochNanoseconds,
} from '#self';

/** https://tc39.es/proposal-temporal/#sec-temporal-systemutcepochnanoseconds */
export function SystemUTCEpochNanoseconds(): EpochNanoseconds {
  const global = GetGlobalObject();
  return HostSystemUTCEpochNanoseconds(global);
}

/** https://tc39.es/proposal-temporal/#sec-temporal-systemdatetime */
export function SystemDateTime(temporalTimeZoneLike: Value): PlainCompletion<ISODateTimeRecord> {
  let timeZone;
  if (temporalTimeZoneLike === Value.undefined) {
    timeZone = SystemTimeZoneIdentifier();
  } else {
    timeZone = Q(ToTemporalTimeZoneIdentifier(temporalTimeZoneLike));
  }
  const epochNanoseconds = SystemUTCEpochNanoseconds();
  return GetISODateTimeFor(timeZone, epochNanoseconds);
}
