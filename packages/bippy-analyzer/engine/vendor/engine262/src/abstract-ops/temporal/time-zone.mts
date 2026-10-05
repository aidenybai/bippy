import type { ISODateRecord } from '../../intrinsics/Temporal/PlainDate.mts';
import type { ISODateTimeRecord } from '../../intrinsics/Temporal/PlainDateTime.mts';
import { ParseTemporalTimeZoneString, ParseTimeZoneIdentifier } from '../../parser/TemporalParser.mts';
import {
  DateFromTime, HourFromTime, MinuteFromTime, MonthFromTime, SecondFromTime, MillisecondFromTime, YearFromTime,
  GetUTCEpochNanoseconds, IsOffsetTimeZoneIdentifier,
} from '../date-objects.mts';
import { isTemporalZonedDateTimeObject } from '../../intrinsics/Temporal/ZonedDateTime.mts';
import { abs, floorDiv, modulo } from '../math.mts';
import { Decimal } from '../../host-defined/decimal.mts';
import {
  GetNamedTimeZoneEpochNanoseconds,
  AvailableNamedTimeZoneIdentifiers,
  GetNamedTimeZoneOffsetNanoseconds,
} from './addition.mts';
import type { TimeZoneIdentifier } from './addition.mts';
import {
  RoundNumberToIncrement, ValidateISODaysRange,
  FormatTimeString,
  type EpochNanoseconds,
} from './temporal.mts';
import {
  Assert, JSStringValue, ObjectValue, Value, type PlainCompletion, Q,
  Throw,
  surroundingAgent,
  X,
  AddDaysToISODate,
  AddTime,
  BalanceISODateTime,
  IsWithinEpochNanosecondsInterval,
  MidnightTimeRecord,
  NanosecondsPerDay,
  NanosecondsPerMinute,
  NanosecondsPerMillisecond,
  TimeDurationFromComponents,
  type Integer,
  type FiniteTimeValue,
  CompareISODateTime,
  NanosecondsPerHour,
  NanosecondsPerSecond,
} from '#self';

/** https://tc39.es/proposal-temporal/#sec-available-named-time-zone-identifier-return-record */
export interface AvailableNamedTimeZoneIdentifierReturnRecord {
  readonly Identifier: TimeZoneIdentifier;
  readonly Result: TimeZoneIdentifierRecord | undefined;
}

// https://tc39.es/proposal-temporal/#sec-temporal-getavailablenamedtimezoneidentifier
export function GetAvailableNamedTimeZoneIdentifier(timeZoneIdentifier: TimeZoneIdentifier): TimeZoneIdentifierRecord | undefined {
  const agentRecord = surroundingAgent.AgentRecord;
  const previousReturns = agentRecord.GetAvailableNamedTimeZoneIdentifierReturns;
  for (const previousReturn of previousReturns) {
    if (previousReturn.Identifier.toLowerCase() === timeZoneIdentifier.toLowerCase()) {
      return previousReturn.Result;
    }
    if (previousReturn.Result !== undefined && previousReturn.Result.PrimaryIdentifier.toLowerCase() === timeZoneIdentifier.toLowerCase()) {
      const record: TimeZoneIdentifierRecord = {
        Identifier: timeZoneIdentifier,
        PrimaryIdentifier: timeZoneIdentifier,
      };
      previousReturns.push({ Identifier: timeZoneIdentifier, Result: record });
      return record;
    }
  }
  for (const record of AvailableNamedTimeZoneIdentifiers()) {
    if (record.Identifier.toLowerCase() === timeZoneIdentifier.toLowerCase()) {
      previousReturns.push({ Identifier: timeZoneIdentifier, Result: record });
      return record;
    }
  }
  previousReturns.push({ Identifier: timeZoneIdentifier, Result: undefined });
  return undefined;
}

/** https://tc39.es/ecma262/#sec-time-zone-identifier-record */
export interface TimeZoneIdentifierRecord {
  readonly Identifier: TimeZoneIdentifier;
  readonly PrimaryIdentifier: TimeZoneIdentifier;
}

// https://tc39.es/proposal-temporal/#sec-temporal-getnamedtimezonenexttransition
export function GetNamedTimeZoneNextTransition(timeZoneIdentifier: TimeZoneIdentifier, _epochNanoseconds: EpochNanoseconds): bigint | null {
  Assert(timeZoneIdentifier === 'UTC');
  return null;
}

// https://tc39.es/proposal-temporal/#sec-temporal-getnamedtimezoneprevioustransition
export function GetNamedTimeZonePreviousTransition(timeZoneIdentifier: TimeZoneIdentifier, _epochNanoseconds: EpochNanoseconds): bigint | null {
  Assert(timeZoneIdentifier === 'UTC');
  return null;
}

// https://tc39.es/proposal-temporal/#sec-temporal-formatoffsettimezoneidentifier
export function FormatOffsetTimeZoneIdentifier(offsetMinutes: Integer, style: 'separated' | 'unseparated' = 'separated'): TimeZoneIdentifier {
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absoluteMinutes = abs(offsetMinutes);
  const hour = floorDiv(absoluteMinutes, 60n);
  const minute = modulo(absoluteMinutes, 60n);
  const timeString = FormatTimeString(hour, minute, 0n, 0n, 'minute', style);
  return sign + timeString as TimeZoneIdentifier;
}

// https://tc39.es/proposal-temporal/#sec-temporal-formatutcoffsetnanoseconds
export function FormatUTCOffsetNanoseconds(offsetNanoseconds: Integer): string {
  const sign = offsetNanoseconds >= 0 ? '+' : '-';
  const absoluteNanoseconds = abs(offsetNanoseconds);
  const hour = floorDiv(absoluteNanoseconds, NanosecondsPerHour);
  const minute = modulo(floorDiv(absoluteNanoseconds, NanosecondsPerMinute), 60n);
  const second = modulo(floorDiv(absoluteNanoseconds, NanosecondsPerSecond), 60n);
  const subSecondNanoseconds = modulo(absoluteNanoseconds, NanosecondsPerSecond);
  const precision: 'minute' | 'auto' = second === 0n && subSecondNanoseconds === 0n ? 'minute' : 'auto';
  const timeString = FormatTimeString(hour, minute, second, subSecondNanoseconds, precision);
  return sign + timeString;
}

// https://tc39.es/proposal-temporal/#sec-temporal-formatdatetimeutcoffsetrounded
export function FormatDateTimeUTCOffsetRounded(offsetNanoseconds: Integer): string {
  offsetNanoseconds = RoundNumberToIncrement(Decimal(offsetNanoseconds), NanosecondsPerMinute, 'halfExpand');
  const offsetMinutes = offsetNanoseconds / NanosecondsPerMinute;
  return FormatOffsetTimeZoneIdentifier(offsetMinutes);
}

// https://tc39.es/proposal-temporal/#sec-temporal-totemporaltimezoneidentifier
export function ToTemporalTimeZoneIdentifier(temporalTimeZoneLike: Value | string): PlainCompletion<TimeZoneIdentifier> {
  if (temporalTimeZoneLike instanceof ObjectValue && isTemporalZonedDateTimeObject(temporalTimeZoneLike)) {
    return temporalTimeZoneLike.TimeZone;
  }
  if (!(temporalTimeZoneLike instanceof JSStringValue) && typeof temporalTimeZoneLike !== 'string') {
    return Throw.TypeError('$1 is not a string', temporalTimeZoneLike);
  }
  const temporalTimeZoneLikeString = temporalTimeZoneLike instanceof JSStringValue ? temporalTimeZoneLike.stringValue() : temporalTimeZoneLike;
  const parseResult = Q(ParseTemporalTimeZoneString(temporalTimeZoneLikeString));
  const offsetMinutes = parseResult.OffsetMinutes;
  if (offsetMinutes !== undefined) {
    return FormatOffsetTimeZoneIdentifier(offsetMinutes);
  }
  const name = parseResult.Name;
  Assert(name !== undefined);
  const timeZoneIdentifierRecord = GetAvailableNamedTimeZoneIdentifier(name as TimeZoneIdentifier);
  if (timeZoneIdentifierRecord === undefined) {
    return Throw.RangeError('Invalid time zone identifier: $1', temporalTimeZoneLikeString);
  }
  return timeZoneIdentifierRecord.Identifier;
}

// https://tc39.es/proposal-temporal/#sec-temporal-getoffsetnanosecondsfor
export function GetOffsetNanosecondsFor(timeZone: TimeZoneIdentifier, epochNanoseconds: EpochNanoseconds): Integer {
  const parseResult = X(ParseTimeZoneIdentifier(timeZone));
  if (parseResult.OffsetMinutes !== undefined) return parseResult.OffsetMinutes * NanosecondsPerMinute;
  Assert(parseResult.Name !== undefined);
  return GetNamedTimeZoneOffsetNanoseconds(parseResult.Name, epochNanoseconds);
}

// https://tc39.es/proposal-temporal/#sec-temporal-getisodatetimefor
export function GetISODateTimeFor(timeZone: TimeZoneIdentifier, epochNanoseconds: EpochNanoseconds): ISODateTimeRecord {
  Assert(IsWithinEpochNanosecondsInterval(epochNanoseconds));
  const offsetNanoseconds = GetOffsetNanosecondsFor(timeZone, epochNanoseconds);
  const remainderNanoseconds = modulo(epochNanoseconds, NanosecondsPerMillisecond);
  const epochMilliseconds = (epochNanoseconds - remainderNanoseconds) / NanosecondsPerMillisecond;
  const year = YearFromTime(Number(epochMilliseconds) as FiniteTimeValue);
  const month = MonthFromTime(Number(epochMilliseconds) as FiniteTimeValue) + 1n;
  const day = DateFromTime(Number(epochMilliseconds) as FiniteTimeValue);
  const hour = HourFromTime(Number(epochMilliseconds) as FiniteTimeValue);
  const minute = MinuteFromTime(Number(epochMilliseconds) as FiniteTimeValue);
  const second = SecondFromTime(Number(epochMilliseconds) as FiniteTimeValue);
  const millisecond = MillisecondFromTime(Number(epochMilliseconds) as FiniteTimeValue);
  const microsecond = floorDiv(remainderNanoseconds, 1000n);
  Assert(microsecond < 1000);
  const nanosecond = modulo(remainderNanoseconds, 1000n);
  return BalanceISODateTime(year, month, day, BigInt(hour), BigInt(minute), BigInt(second), BigInt(millisecond), microsecond, nanosecond + offsetNanoseconds);
}

// https://tc39.es/proposal-temporal/#sec-temporal-getepochnanosecondsfor
export function GetEpochNanosecondsFor(
  timeZone: TimeZoneIdentifier,
  isoDateTime: ISODateTimeRecord,
  disambiguation: 'compatible' | 'earlier' | 'later' | 'reject',
): PlainCompletion<EpochNanoseconds> {
  const possibleEpochNanoseconds = Q(GetPossibleEpochNanoseconds(timeZone, isoDateTime));
  return DisambiguatePossibleEpochNanoseconds(possibleEpochNanoseconds, timeZone, isoDateTime, disambiguation);
}

// https://tc39.es/proposal-temporal/#sec-temporal-disambiguatepossibleepochnanoseconds
export function DisambiguatePossibleEpochNanoseconds(
  possibleEpochNanoseconds: readonly EpochNanoseconds[],
  timeZone: TimeZoneIdentifier,
  isoDateTime: ISODateTimeRecord,
  disambiguation: 'compatible' | 'earlier' | 'later' | 'reject',
): PlainCompletion<EpochNanoseconds> {
  let count = possibleEpochNanoseconds.length;
  if (count === 1) {
    return possibleEpochNanoseconds[0];
  }
  if (count !== 0) {
    if (disambiguation === 'earlier' || disambiguation === 'compatible') {
      return possibleEpochNanoseconds[0];
    }
    if (disambiguation === 'later') {
      return possibleEpochNanoseconds[count - 1];
    }
    Assert(disambiguation === 'reject');
    return Throw.RangeError('Multiple possible epoch nanoseconds');
  }
  Assert(count === 0);
  if (disambiguation === 'reject') {
    return Throw.RangeError('No possible epoch nanoseconds');
  }

  const _nanoseconds = GetUTCEpochNanoseconds(isoDateTime);
  // 6. Let before be the latest possible ISO Date-Time Record for which CompareISODateTime(before, isoDateTime) = -1 and !GetPossibleEpochNanoseconds(timeZone, before) is not empty.
  let before: ISODateTimeRecord;
  {
    const dayBeforeNanoseconds = _nanoseconds - NanosecondsPerDay;
    Assert(IsWithinEpochNanosecondsInterval(dayBeforeNanoseconds));
    before = GetISODateTimeFor(timeZone, dayBeforeNanoseconds);
  }
  Assert(CompareISODateTime(before, isoDateTime) === -1n && X(GetPossibleEpochNanoseconds(timeZone, before)).length > 0);

  // 7. Let after be the earliest possible ISO Date-Time Record for which CompareISODateTime(after, isoDateTime) = 1 and !GetPossibleEpochNanoseconds(timeZone, after) is not empty.
  let after: ISODateTimeRecord;
  {
    const dayAfterNanoseconds = _nanoseconds + NanosecondsPerDay;
    Assert(IsWithinEpochNanosecondsInterval(dayAfterNanoseconds));
    after = GetISODateTimeFor(timeZone, dayAfterNanoseconds);
  }
  Assert(CompareISODateTime(after, isoDateTime) === 1n && X(GetPossibleEpochNanoseconds(timeZone, after)).length > 0);

  const beforePossible = X(GetPossibleEpochNanoseconds(timeZone, before));
  Assert(beforePossible.length === 1);
  const afterPossible = X(GetPossibleEpochNanoseconds(timeZone, after));
  Assert(afterPossible.length === 1);
  const offsetBefore = GetOffsetNanosecondsFor(timeZone, beforePossible[0]);
  const offsetAfter = GetOffsetNanosecondsFor(timeZone, afterPossible[0]);
  const nanoseconds = offsetAfter - offsetBefore;
  Assert(nanoseconds >= -NanosecondsPerDay && nanoseconds <= NanosecondsPerDay);
  if (disambiguation === 'earlier') {
    const timeDuration = X(TimeDurationFromComponents(0n, 0n, 0n, 0n, 0n, -nanoseconds));
    const earlierTime = AddTime(isoDateTime.Time, timeDuration);
    const earlierDate = AddDaysToISODate(isoDateTime.ISODate, earlierTime.Days);
    const earlierDateTime: ISODateTimeRecord = { ISODate: earlierDate, Time: earlierTime };
    possibleEpochNanoseconds = Q(GetPossibleEpochNanoseconds(timeZone, earlierDateTime));
    Assert(possibleEpochNanoseconds.length > 0);
    return possibleEpochNanoseconds[0];
  }
  Assert(disambiguation === 'compatible' || disambiguation === 'later');
  const timeDuration = X(TimeDurationFromComponents(0n, 0n, 0n, 0n, 0n, nanoseconds));
  const laterTime = AddTime(isoDateTime.Time, timeDuration);
  const laterDate = AddDaysToISODate(isoDateTime.ISODate, laterTime.Days);
  const laterDateTime: ISODateTimeRecord = { ISODate: laterDate, Time: laterTime };
  possibleEpochNanoseconds = Q(GetPossibleEpochNanoseconds(timeZone, laterDateTime));
  count = possibleEpochNanoseconds.length;
  Assert(count > 0);
  return possibleEpochNanoseconds[count - 1];
}

// https://tc39.es/proposal-temporal/#sec-temporal-getpossibleepochnanoseconds
export function GetPossibleEpochNanoseconds(
  timeZone: TimeZoneIdentifier,
  isoDateTime: ISODateTimeRecord,
): PlainCompletion<EpochNanoseconds[]> {
  const parseResult = X(ParseTimeZoneIdentifier(timeZone));
  let possibleEpochNanoseconds: EpochNanoseconds[];
  if (parseResult.OffsetMinutes !== undefined) {
    const balanced = BalanceISODateTime(
      isoDateTime.ISODate.Year,
      isoDateTime.ISODate.Month,
      isoDateTime.ISODate.Day,
      isoDateTime.Time.Hour,
      isoDateTime.Time.Minute - parseResult.OffsetMinutes,
      isoDateTime.Time.Second,
      isoDateTime.Time.Millisecond,
      isoDateTime.Time.Microsecond,
      isoDateTime.Time.Nanosecond,
    );
    Q(ValidateISODaysRange(balanced.ISODate));
    const epochNanoseconds = GetUTCEpochNanoseconds(balanced);
    possibleEpochNanoseconds = [epochNanoseconds];
  } else {
    Assert(parseResult.Name !== undefined);
    possibleEpochNanoseconds = GetNamedTimeZoneEpochNanoseconds(parseResult.Name as TimeZoneIdentifier, isoDateTime);
  }
  for (const epochNanoseconds of possibleEpochNanoseconds) {
    if (!IsWithinEpochNanosecondsInterval(epochNanoseconds)) {
      return Throw.RangeError('$1 is not a valid epoch nanoseconds', epochNanoseconds);
    }
  }
  return possibleEpochNanoseconds;
}

/** https://tc39.es/proposal-temporal/#sec-temporal-getstartofday */
export function GetStartOfDay(
  timeZone: TimeZoneIdentifier,
  isoDate: ISODateRecord,
): PlainCompletion<EpochNanoseconds> {
  const isoDateTime: ISODateTimeRecord = { ISODate: isoDate, Time: MidnightTimeRecord() };
  const possibleEpochNanoseconds = Q(GetPossibleEpochNanoseconds(timeZone, isoDateTime));
  if (possibleEpochNanoseconds.length) {
    return possibleEpochNanoseconds[0];
  }
  Assert(!IsOffsetTimeZoneIdentifier(timeZone));

  let wallClockAdvance = 1n;
  while (true) {
    const timeAfter = AddTime(isoDateTime.Time, wallClockAdvance);
    const isoDateAfter = AddDaysToISODate(isoDate, timeAfter.Days);
    const isoDateTimeAfter: ISODateTimeRecord = { ISODate: isoDateAfter, Time: timeAfter };
    const possibleEpochNanosecondsAfter = GetNamedTimeZoneEpochNanoseconds(timeZone, isoDateTimeAfter);
    if (possibleEpochNanosecondsAfter.length !== 0) {
      Assert(possibleEpochNanosecondsAfter.length === 1);
      const result = possibleEpochNanosecondsAfter[0];
      if (!IsWithinEpochNanosecondsInterval(result)) {
        return Throw.RangeError('$1 is not a valid epoch nanoseconds', result);
      }
      return result;
    }
    wallClockAdvance += 1n;
  }
}

// https://tc39.es/proposal-temporal/#sec-temporal-timezoneequals
export function TimeZoneEquals(xTimeZone: TimeZoneIdentifier, yTimeZone: TimeZoneIdentifier): boolean {
  if (xTimeZone === yTimeZone) {
    return true;
  }
  if (!IsOffsetTimeZoneIdentifier(xTimeZone) && !IsOffsetTimeZoneIdentifier(yTimeZone)) {
    const xRecord = GetAvailableNamedTimeZoneIdentifier(xTimeZone);
    const yRecord = GetAvailableNamedTimeZoneIdentifier(yTimeZone);
    Assert(xRecord !== undefined);
    Assert(yRecord !== undefined);
    if (xRecord.PrimaryIdentifier === yRecord.PrimaryIdentifier) {
      return true;
    }
  }
  // 3. Assert: If one and two are both offset time zone identifiers, they do not represent the same number of offset minutes.
  if (IsOffsetTimeZoneIdentifier(xTimeZone) && IsOffsetTimeZoneIdentifier(yTimeZone)) {
    const oneOffsetMinutes = X(ParseTimeZoneIdentifier(xTimeZone)).OffsetMinutes;
    const twoOffsetMinutes = X(ParseTimeZoneIdentifier(yTimeZone)).OffsetMinutes;
    Assert(oneOffsetMinutes !== twoOffsetMinutes);
  }
  return false;
}
