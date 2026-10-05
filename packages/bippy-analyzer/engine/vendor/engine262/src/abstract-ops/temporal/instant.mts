import type { TemporalDurationObject } from '../../intrinsics/Temporal/Duration.mts';
import { type TemporalInstantObject, isTemporalInstantObject } from '../../intrinsics/Temporal/Instant.mts';
import { isTemporalZonedDateTimeObject } from '../../intrinsics/Temporal/ZonedDateTime.mts';
import { ParseISODateTime } from '../../parser/TemporalParser.mts';
import { GetUTCEpochNanoseconds, ParseDateTimeUTCOffset } from '../date-objects.mts';
import { Decimal } from '../../host-defined/decimal.mts';
import {
  type RoundingMode, type TimeZoneIdentifier,
} from './addition.mts';
import {
  type FunctionObject, type ValueEvaluator, Assert, surroundingAgent, Q, OrdinaryCreateFromConstructor, type Mutable, Value, ObjectValue, X, ToPrimitive, JSStringValue, Throw, ValidateISODaysRange, type TimeDuration, type PlainCompletion, AddTimeDurationToEpochNanoseconds, type TimeUnit, type InternalDurationRecord, TimeDurationFromEpochNanosecondsDifference, RoundTimeDuration, CombineDateAndTimeDuration, ZeroDateDuration, TemporalUnitLength, RoundNumberToIncrementAsIfPositive, GetISODateTimeFor, GetOffsetNanosecondsFor, FormatDateTimeUTCOffsetRounded, GetDifferenceSettings, TemporalDurationFromInternal, CreateNegatedTemporalDuration, ToTemporalDuration, DefaultTemporalLargestUnit, isDateUnit, ToInternalDurationRecordWith24HourDays, MinEpochNanoseconds, MaxEpochNanoseconds,
  BalanceISODateTime,
  FormatISODateTime,
  type EpochNanoseconds,
  type Integer,
  GetOptionsObject,
} from '#self';

/** https://tc39.es/proposal-temporal/#sec-iswithinepochnanosecondsinterval */
export function IsWithinEpochNanosecondsInterval(epochNanoseconds: Integer): boolean {
  if (epochNanoseconds < MinEpochNanoseconds || epochNanoseconds > MaxEpochNanoseconds) {
    return false;
  }
  return true;
}

/** https://tc39.es/proposal-temporal/#sec-temporal-createtemporalinstant */
export function* CreateTemporalInstant(epochNanoseconds: EpochNanoseconds, newTarget?: FunctionObject): ValueEvaluator<TemporalInstantObject> {
  Assert(IsWithinEpochNanosecondsInterval(epochNanoseconds));
  if (newTarget === undefined) {
    newTarget = surroundingAgent.intrinsic('%Temporal.Instant%');
  }
  const object = Q(yield* OrdinaryCreateFromConstructor(newTarget, '%Temporal.Instant.prototype%', [
    'InitializedTemporalInstant',
    'EpochNanoseconds',
  ])) as Mutable<TemporalInstantObject>;
  object.EpochNanoseconds = epochNanoseconds;
  return object;
}

/** https://tc39.es/proposal-temporal/#sec-temporal-totemporalinstant */
export function* ToTemporalInstant(item: Value): ValueEvaluator<TemporalInstantObject> {
  if (item instanceof ObjectValue) {
    if (isTemporalInstantObject(item) || isTemporalZonedDateTimeObject(item)) {
      return X(CreateTemporalInstant(item.EpochNanoseconds));
    }
    item = Q(yield* ToPrimitive(item, 'string'));
  }
  if (!(item instanceof JSStringValue)) {
    return Throw.TypeError('$1 is not a string', item);
  }
  const parsed = Q(ParseISODateTime(item.stringValue(), 'instant'));
  // Assert: Either parsed.[[TimeZone]].[[OffsetString]] is not empty or parsed.[[TimeZone]].[[Z]] is true, but not both.
  {
    const a = parsed.TimeZone.OffsetString !== undefined;
    const b = parsed.TimeZone.Z;
    Assert((a || b) && !(a && b));
  }
  const OffsetString = parsed.TimeZone.OffsetString!;
  const offsetNanoseconds = parsed.TimeZone.Z ? 0n : X(ParseDateTimeUTCOffset(OffsetString));
  const time = parsed.Time;
  Assert(time !== 'start-of-day');
  const balanced = BalanceISODateTime(parsed.Year!, parsed.Month, parsed.Day, time.Hour, time.Minute, time.Second, time.Millisecond, time.Microsecond, time.Nanosecond - offsetNanoseconds);
  Q(ValidateISODaysRange(balanced.ISODate));
  const epochNanoseconds = GetUTCEpochNanoseconds(balanced);
  if (!IsWithinEpochNanosecondsInterval(epochNanoseconds)) {
    return Throw.RangeError('$1 is not a valid epoch nanoseconds', epochNanoseconds);
  }
  return X(CreateTemporalInstant(epochNanoseconds));
}

/** https://tc39.es/proposal-temporal/#sec-temporal-compareepochnanoseconds */
export function CompareEpochNanoseconds(xEpochNanoseconds: EpochNanoseconds, yEpochNanoseconds: EpochNanoseconds): -1 | 0 | 1 {
  if (xEpochNanoseconds > yEpochNanoseconds) return 1;
  if (xEpochNanoseconds < yEpochNanoseconds) return -1;
  return 0;
}

/** https://tc39.es/proposal-temporal/#sec-temporal-addepochnanoseconds */
export function AddEpochNanoseconds(epochNanoseconds: EpochNanoseconds, timeDuration: TimeDuration): PlainCompletion<EpochNanoseconds> {
  const result = AddTimeDurationToEpochNanoseconds(timeDuration, epochNanoseconds);
  if (!IsWithinEpochNanosecondsInterval(result)) {
    return Throw.RangeError('$1 is not a valid epoch nanoseconds', result);
  }
  return result;
}

/** https://tc39.es/proposal-temporal/#sec-temporal-differenceinstant */
export function DifferenceEpochNanoseconds(
  epochNanosecondsFrom: EpochNanoseconds,
  epochNanosecondsTo: EpochNanoseconds,
  roundingIncrement: Integer,
  smallestUnit: TimeUnit,
  roundingMode: RoundingMode,
): InternalDurationRecord {
  let timeDuration = TimeDurationFromEpochNanosecondsDifference(epochNanosecondsFrom, epochNanosecondsTo);
  timeDuration = X(RoundTimeDuration(timeDuration, roundingIncrement, smallestUnit, roundingMode));
  return CombineDateAndTimeDuration(ZeroDateDuration(), timeDuration);
}

/** https://tc39.es/ecma262/pr/3759/#sec-roundepochnanoseconds */
export function RoundEpochNanoseconds(
  epochNanoseconds: EpochNanoseconds,
  increment: Integer,
  unit: TimeUnit,
  roundingMode: RoundingMode,
): EpochNanoseconds {
  const incrementNanoseconds = increment * TemporalUnitLength(unit);
  return BigInt(RoundNumberToIncrementAsIfPositive(Decimal(epochNanoseconds), incrementNanoseconds, roundingMode));
}

/** https://tc39.es/proposal-temporal/#sec-temporal-temporalinstant-tostring */
export function TemporalInstantToString(
  instant: TemporalInstantObject,
  timeZone: TimeZoneIdentifier | undefined,
  precision: Integer | 'minute' | 'auto',
): string {
  let outputTimeZone = timeZone;
  if (outputTimeZone === undefined) {
    outputTimeZone = 'UTC' as TimeZoneIdentifier;
  }
  const epochNanoseconds = instant.EpochNanoseconds;
  const isoDateTime = GetISODateTimeFor(outputTimeZone, epochNanoseconds);
  const dateTimeString = FormatISODateTime(isoDateTime, 'iso8601', precision, 'never');
  let timeZoneString;
  if (timeZone === undefined) {
    timeZoneString = 'Z';
  } else {
    const offsetNanoseconds = GetOffsetNanosecondsFor(outputTimeZone, epochNanoseconds);
    timeZoneString = FormatDateTimeUTCOffsetRounded(offsetNanoseconds);
  }
  return dateTimeString + timeZoneString;
}

/** https://tc39.es/proposal-temporal/#sec-temporal-differencetemporalinstant */
export function* DifferenceTemporalInstant(
  operation: 'since' | 'until',
  instant: TemporalInstantObject,
  _other: Value,
  options: Value,
): ValueEvaluator<TemporalDurationObject> {
  const other = Q(yield* ToTemporalInstant(_other));
  const resolvedOptions = Q(GetOptionsObject(options));
  const settings = Q(yield* GetDifferenceSettings(operation, resolvedOptions, 'time', [], 'nanosecond', 'second'));
  const internalDuration = DifferenceEpochNanoseconds(instant.EpochNanoseconds, other.EpochNanoseconds, settings.RoundingIncrement, settings.SmallestUnit as TimeUnit, settings.RoundingMode);
  let result = X(TemporalDurationFromInternal(internalDuration, settings.LargestUnit));
  if (operation === 'since') {
    result = CreateNegatedTemporalDuration(result);
  }
  return result;
}

/** https://tc39.es/proposal-temporal/#sec-temporal-adddurationtoinstant */
export function* AddDurationToInstant(
  operation: 'add' | 'subtract',
  instant: TemporalInstantObject,
  temporalDurationLike: Value,
): ValueEvaluator<TemporalInstantObject> {
  let duration = Q(yield* ToTemporalDuration(temporalDurationLike));
  if (operation === 'subtract') {
    duration = CreateNegatedTemporalDuration(duration);
  }
  const largestUnit = DefaultTemporalLargestUnit(duration);
  if (isDateUnit(largestUnit)) {
    return Throw.RangeError('Cannot add a date to an instant');
  }
  const internalDuration = ToInternalDurationRecordWith24HourDays(duration);
  const ns = Q(AddEpochNanoseconds(instant.EpochNanoseconds, internalDuration.Time));
  return X(CreateTemporalInstant(ns));
}
