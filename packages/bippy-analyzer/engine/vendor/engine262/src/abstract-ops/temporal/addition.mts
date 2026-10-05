// Addition/Edition to the main spec.
// Code here should move elsewhere after Temporal is merged.

import type { ISODateTimeRecord } from '../../intrinsics/Temporal/PlainDateTime.mts';
import { GetUTCEpochNanoseconds } from '../date-objects.mts';
import { type Integer } from '../spec-types.mjs';
import { __ts_cast__ } from '../../utils/language.mts';
import { SnapToInteger } from '../type-conversion.mts';
import { type EpochNanoseconds } from './temporal.mts';
import { type TimeZoneIdentifierRecord } from './time-zone.mts';
import { mark_TimeZoneAwareNotImplemented } from './not-implemented.mts';
import {
  Assert,
  Get,
  ObjectValue, Q, Throw, ToString, UndefinedValue, Value, type PlainEvaluator,
} from '#self';

/** https://tc39.es/proposal-temporal/#sec-year-week-record-specification-type */
export interface YearWeekRecord {
  readonly Week: bigint | undefined;
  readonly Year: bigint | undefined;
}

/** https://tc39.es/proposal-temporal/#sec-getroundingmodeoption */
export function* GetRoundingModeOption(
  options: ObjectValue,
  fallback: RoundingMode,
): PlainEvaluator<RoundingMode> {
  const value = Q(yield* Get(options, 'roundingMode'));
  if (value instanceof UndefinedValue) return fallback;
  const stringValue = Q(yield* ToString(value));
  const acceptedValues = ['ceil', 'floor', 'expand', 'trunc', 'halfCeil', 'halfFloor', 'halfExpand', 'halfTrunc', 'halfEven'] as readonly RoundingMode[];
  if (!acceptedValues.includes(stringValue as RoundingMode)) {
    return Throw.RangeError('"roundingMode" on object $1 is not valid ($2), only $3 are accepted', options, stringValue, acceptedValues.join(', '));
  }
  return stringValue as RoundingMode;
}

/** https://tc39.es/proposal-temporal/#table-temporal-rounding-modes */
export type RoundingMode = 'ceil' | 'floor' | 'expand' | 'trunc' | 'halfCeil' | 'halfFloor' | 'halfExpand' | 'halfTrunc' | 'halfEven';

/** https://tc39.es/proposal-temporal/#table-unsigned-rounding-modes */
export type UnsignedRoundingMode = 'infinity' | 'zero' | 'half-infinity' | 'half-zero' | 'half-even';

/** https://tc39.es/proposal-temporal/#sec-getroundingincrementoption */
export function* GetRoundingIncrementOption(
  options: ObjectValue,
): PlainEvaluator<Integer> {
  const value = Q(yield* Get(options, 'roundingIncrement'));
  if (value === Value.undefined) {
    return 1n;
  }
  return yield* SnapToInteger(value, 'truncate', 1n, BigInt(1e9));
}

/** https://tc39.es/proposal-temporal/#sec-time-zone-identifiers */
export type TimeZoneIdentifier = string & { specName: 'TimeZoneIdentifier'; };

export const NoTimeZone = undefined;
export type NoTimeZone = undefined;

/** https://tc39.es/proposal-temporal/#sec-getnamedtimezoneepochnanoseconds */
export function GetNamedTimeZoneEpochNanoseconds(
  timeZoneIdentifier: TimeZoneIdentifier,
  isoDateTime: ISODateTimeRecord,
): EpochNanoseconds[] {
  mark_TimeZoneAwareNotImplemented();
  Assert(timeZoneIdentifier === 'UTC');
  const epochNanoseconds = GetUTCEpochNanoseconds(isoDateTime);
  return [epochNanoseconds];
}

/** https://tc39.es/ecma262/#sec-getnamedtimezoneoffsetnanoseconds */
export function GetNamedTimeZoneOffsetNanoseconds(timeZoneIdentifier: string, _epochNanoseconds: EpochNanoseconds): Integer {
  mark_TimeZoneAwareNotImplemented();
  Assert(timeZoneIdentifier === 'UTC');
  return 0n;
}

/** https://tc39.es/proposal-temporal/#sec-systemtimezoneidentifier */
export function SystemTimeZoneIdentifier(): TimeZoneIdentifier {
  mark_TimeZoneAwareNotImplemented();
  // 1. If the implementation only supports the UTC time zone, return "UTC".
  return 'UTC' as TimeZoneIdentifier;
  // 2. Let systemTimeZoneString be the String representing the host environment's current time zone as a time zone identifier in normalized format, either a primary time zone identifier or an offset time zone identifier.
  // 3. Return systemTimeZoneString.
}

/** https://tc39.es/ecma262/#sec-tozeropaddeddecimalstring */
export function ToZeroPaddedDecimalString(n: Integer, minLength: Integer) {
  const string = n.toString();
  return string.padStart(Number(minLength), '0');
}

/** https://tc39.es/ecma262/#sec-availablenamedtimezoneidentifiers */
export function AvailableNamedTimeZoneIdentifiers(): TimeZoneIdentifierRecord[] {
  mark_TimeZoneAwareNotImplemented();
  return [{
    Identifier: 'UTC' as TimeZoneIdentifier,
    PrimaryIdentifier: 'UTC' as TimeZoneIdentifier,
  }];
}
