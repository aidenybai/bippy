import type { TemporalDurationObject } from '../../intrinsics/Temporal/Duration.mts';
import { isTemporalPlainDateTimeObject } from '../../intrinsics/Temporal/PlainDateTime.mts';
import { type TemporalPlainTimeObject, isTemporalPlainTimeObject } from '../../intrinsics/Temporal/PlainTime.mts';
import { isTemporalZonedDateTimeObject } from '../../intrinsics/Temporal/ZonedDateTime.mts';
import { ParseISODateTime } from '../../parser/TemporalParser.mts';
import {
  floorDiv, max, min, modulo,
} from '../math.mts';
import { SnapToInteger } from '../type-conversion.mts';
import { Decimal } from '../../host-defined/decimal.mts';
import { type RoundingMode } from './addition.mts';
import {
  Assert, type TimeDuration, TimeDurationFromComponents, NanosecondsPerDay, NanosecondsPerHour, NanosecondsPerMinute, NanosecondsPerSecond, NanosecondsPerMillisecond, NanosecondsPerMicrosecond, Value, type ValueEvaluator, ObjectValue, Q, GetTemporalOverflowOption, X, GetISODateTimeFor, JSStringValue, Throw, type PlainEvaluator, UndefinedValue, type PlainCompletion, type FunctionObject, surroundingAgent, OrdinaryCreateFromConstructor, type Mutable, Get, FormatTimeString, type TimeUnit, TemporalUnitLength, RoundNumberToIncrement, GetDifferenceSettings, RoundTimeDuration, CombineDateAndTimeDuration, ZeroDateDuration, TemporalDurationFromInternal, CreateNegatedTemporalDuration, ToTemporalDuration, ToInternalDurationRecord,
  type Integer,
  GetOptionsObject,
} from '#self';

/** https://tc39.es/proposal-temporal/#sec-temporal-time-records */
export interface TimeRecord {
  readonly Days: Integer;
  readonly Hour: Integer;
  readonly Minute: Integer;
  readonly Second: Integer;
  readonly Millisecond: Integer;
  readonly Microsecond: Integer;
  readonly Nanosecond: Integer;
}

/** https://tc39.es/proposal-temporal/#sec-temporal-createtimerecord */
export function CreateTimeRecord(hour: Integer, minute: Integer, second: Integer, millisecond: Integer, microsecond: Integer, nanosecond: Integer, deltaDays: Integer = 0n): PlainCompletion<TimeRecord> {
  if (!IsValidTime(hour, minute, second, millisecond, microsecond, nanosecond)) {
    return Throw.RangeError('Invalid time');
  }
  return {
    Days: deltaDays,
    Hour: hour,
    Minute: minute,
    Second: second,
    Millisecond: millisecond,
    Microsecond: microsecond,
    Nanosecond: nanosecond,
  };
}

/** https://tc39.es/proposal-temporal/#sec-temporal-midnighttimerecord */
export function MidnightTimeRecord(): TimeRecord {
  return {
    Days: 0n,
    Hour: 0n,
    Minute: 0n,
    Second: 0n,
    Millisecond: 0n,
    Microsecond: 0n,
    Nanosecond: 0n,
  };
}

/** https://tc39.es/proposal-temporal/#sec-temporal-noontimerecord */
export function NoonTimeRecord(): TimeRecord {
  return {
    Days: 0n,
    Hour: 12n,
    Minute: 0n,
    Second: 0n,
    Millisecond: 0n,
    Microsecond: 0n,
    Nanosecond: 0n,
  };
}

/** https://tc39.es/proposal-temporal/#sec-temporal-differencetime */
export function DifferenceTime(timeFrom: TimeRecord, timeTo: TimeRecord): TimeDuration {
  const hours = timeTo.Hour - timeFrom.Hour;
  const minutes = timeTo.Minute - timeFrom.Minute;
  const seconds = timeTo.Second - timeFrom.Second;
  const milliseconds = timeTo.Millisecond - timeFrom.Millisecond;
  const microseconds = timeTo.Microsecond - timeFrom.Microsecond;
  const nanoseconds = timeTo.Nanosecond - timeFrom.Nanosecond;
  const timeDuration = X(TimeDurationFromComponents(hours, minutes, seconds, milliseconds, microseconds, nanoseconds));
  Assert(timeDuration > -NanosecondsPerDay && timeDuration < NanosecondsPerDay);
  return timeDuration;
}

/** https://tc39.es/proposal-temporal/#sec-temporal-totemporaltime */
export function* ToTemporalTime(item: Value, options: Value = Value.undefined): ValueEvaluator<TemporalPlainTimeObject> {
  let result;
  if (item instanceof ObjectValue) {
    if (isTemporalPlainTimeObject(item)) {
      const resolvedOptions = Q(GetOptionsObject(options));
      Q(yield* GetTemporalOverflowOption(resolvedOptions));
      return X(CreateTemporalTime(item.Time));
    }
    if (isTemporalPlainDateTimeObject(item)) {
      const resolvedOptions = Q(GetOptionsObject(options));
      Q(yield* GetTemporalOverflowOption(resolvedOptions));
      return X(CreateTemporalTime(item.ISODateTime.Time));
    }
    if (isTemporalZonedDateTimeObject(item)) {
      const isoDateTime = GetISODateTimeFor(item.TimeZone, item.EpochNanoseconds);
      const resolvedOptions = Q(GetOptionsObject(options));
      Q(yield* GetTemporalOverflowOption(resolvedOptions));
      return X(CreateTemporalTime(isoDateTime.Time));
    }
    const result2 = Q(yield* ToPartialTimeRecord(item, 'complete'));
    const resolvedOptions = Q(GetOptionsObject(options));
    const overflow = Q(yield* GetTemporalOverflowOption(resolvedOptions));
    result = Q(RegulateTime(result2.Hour!, result2.Minute!, result2.Second!, result2.Millisecond!, result2.Microsecond!, result2.Nanosecond!, overflow));
  } else {
    if (!(item instanceof JSStringValue)) {
      return Throw.TypeError('Invalid time string $1', item);
    }
    const parseResult = Q(ParseISODateTime(item.stringValue(), 'time'));
    Assert(parseResult.Time !== 'start-of-day');
    result = parseResult.Time;
    const resolvedOptions = Q(GetOptionsObject(options));
    Q(yield* GetTemporalOverflowOption(resolvedOptions));
  }
  return X(CreateTemporalTime(result));
}

/** https://tc39.es/proposal-temporal/#sec-temporal-totimerecordormidnight */
export function* ToTimeRecordOrMidnight(item: Value): PlainEvaluator<TimeRecord> {
  if (item instanceof UndefinedValue) {
    return MidnightTimeRecord();
  }
  const plainTime = Q(yield* ToTemporalTime(item));
  return plainTime.Time;
}

/** https://tc39.es/proposal-temporal/#sec-temporal-regulatetime */
export function RegulateTime(hour: Integer, minute: Integer, second: Integer, millisecond: Integer, microsecond: Integer, nanosecond: Integer, overflow: 'constrain' | 'reject'): PlainCompletion<TimeRecord> {
  if (overflow === 'constrain') {
    hour = max(0n, min(23n, hour));
    minute = max(0n, min(59n, minute));
    second = max(0n, min(59n, second));
    millisecond = max(0n, min(999n, millisecond));
    microsecond = max(0n, min(999n, microsecond));
    nanosecond = max(0n, min(999n, nanosecond));
    return X(CreateTimeRecord(hour, minute, second, millisecond, microsecond, nanosecond));
  }
  Assert(overflow === 'reject');
  return Q(CreateTimeRecord(hour, minute, second, millisecond, microsecond, nanosecond));
}

/** https://tc39.es/proposal-temporal/#sec-isvalidtime */
export function IsValidTime(hour: Integer, minute: Integer, second: Integer, millisecond: Integer, microsecond: Integer, nanosecond: Integer): boolean {
  if (hour < 0n || hour > 23n) return false;
  if (minute < 0n || minute > 59n) return false;
  if (second < 0n || second > 59n) return false;
  if (millisecond < 0n || millisecond > 999n) return false;
  if (microsecond < 0n || microsecond > 999n) return false;
  if (nanosecond < 0n || nanosecond > 999n) return false;
  return true;
}

/** https://tc39.es/proposal-temporal/#sec-temporal-balancetime */
export function BalanceTime(hour: Integer, minute: Integer, second: Integer, millisecond: Integer, microsecond: Integer, nanosecond: Integer): TimeRecord {
  microsecond += floorDiv(nanosecond, 1000n);
  nanosecond = modulo(nanosecond, 1000n);
  millisecond += floorDiv(microsecond, 1000n);
  microsecond = modulo(microsecond, 1000n);
  second += floorDiv(millisecond, 1000n);
  millisecond = modulo(millisecond, 1000n);
  minute += floorDiv(second, 60n);
  second = modulo(second, 60n);
  hour += floorDiv(minute, 60n);
  minute = modulo(minute, 60n);
  const deltaDays = floorDiv(hour, 24n);
  hour = modulo(hour, 24n);
  return X(CreateTimeRecord(hour, minute, second, millisecond, microsecond, nanosecond, deltaDays));
}

/** https://tc39.es/proposal-temporal/#sec-temporal-createtemporaltime */
export function* CreateTemporalTime(time: TimeRecord, newTarget?: FunctionObject): ValueEvaluator<TemporalPlainTimeObject> {
  if (newTarget === undefined) {
    newTarget = surroundingAgent.intrinsic('%Temporal.PlainTime%');
  }
  const object = Q(yield* OrdinaryCreateFromConstructor(newTarget, '%Temporal.PlainTime.prototype%', [
    'InitializedTemporalTime',
    'Time',
  ])) as Mutable<TemporalPlainTimeObject>;
  object.Time = time;
  return object;
}

/** https://tc39.es/proposal-temporal/#table-temporal-temporaltimelike-record-fields */
export interface PartialTimeRecord {
  Hour: bigint | undefined;
  Minute: bigint | undefined;
  Second: bigint | undefined;
  Millisecond: bigint | undefined;
  Microsecond: bigint | undefined;
  Nanosecond: bigint | undefined;
}
/** https://tc39.es/proposal-temporal/#sec-topartialtimerecord */
export function* ToPartialTimeRecord(temporalTimeLike: ObjectValue, completeness: 'partial' | 'complete'): PlainEvaluator<PartialTimeRecord> {
  let result: Mutable<PartialTimeRecord>;
  if (completeness === 'complete') {
    result = {
      Hour: 0n,
      Minute: 0n,
      Second: 0n,
      Millisecond: 0n,
      Microsecond: 0n,
      Nanosecond: 0n,
    };
  } else {
    result = {
      Hour: undefined,
      Minute: undefined,
      Second: undefined,
      Millisecond: undefined,
      Microsecond: undefined,
      Nanosecond: undefined,
    };
  }
  let anyPresent = false;
  const hour = Q(yield* Get(temporalTimeLike, 'hour'));
  if (!(hour instanceof UndefinedValue)) {
    result.Hour = Q(yield* SnapToInteger(hour, 'truncate'));
    anyPresent = true;
  }
  const microsecond = Q(yield* Get(temporalTimeLike, 'microsecond'));
  if (!(microsecond instanceof UndefinedValue)) {
    result.Microsecond = Q(yield* SnapToInteger(microsecond, 'truncate'));
    anyPresent = true;
  }
  const millisecond = Q(yield* Get(temporalTimeLike, 'millisecond'));
  if (!(millisecond instanceof UndefinedValue)) {
    result.Millisecond = Q(yield* SnapToInteger(millisecond, 'truncate'));
    anyPresent = true;
  }
  const minute = Q(yield* Get(temporalTimeLike, 'minute'));
  if (!(minute instanceof UndefinedValue)) {
    result.Minute = Q(yield* SnapToInteger(minute, 'truncate'));
    anyPresent = true;
  }
  const nanosecond = Q(yield* Get(temporalTimeLike, 'nanosecond'));
  if (!(nanosecond instanceof UndefinedValue)) {
    result.Nanosecond = Q(yield* SnapToInteger(nanosecond, 'truncate'));
    anyPresent = true;
  }
  const second = Q(yield* Get(temporalTimeLike, 'second'));
  if (!(second instanceof UndefinedValue)) {
    result.Second = Q(yield* SnapToInteger(second, 'truncate'));
    anyPresent = true;
  }
  if (!anyPresent) {
    return Throw.TypeError('$1 does not look like a TemporalTimeLike object', temporalTimeLike);
  }
  return result;
}


/** https://tc39.es/proposal-temporal/#sec-temporal-timerecordtostring */
export function TimeRecordToString(time: TimeRecord, precision: Integer | 'minute' | 'auto'): string {
  const subSecondNanoseconds = time.Millisecond * NanosecondsPerMillisecond + time.Microsecond * NanosecondsPerMicrosecond + time.Nanosecond;
  return FormatTimeString(time.Hour, time.Minute, time.Second, subSecondNanoseconds, precision);
}

/** https://tc39.es/proposal-temporal/#sec-temporal-comparetimerecord */
export function CompareTimeRecord(xTime: TimeRecord, yTime: TimeRecord): -1n | 0n | 1n {
  if (xTime.Hour > yTime.Hour) return 1n;
  if (xTime.Hour < yTime.Hour) return -1n;
  if (xTime.Minute > yTime.Minute) return 1n;
  if (xTime.Minute < yTime.Minute) return -1n;
  if (xTime.Second > yTime.Second) return 1n;
  if (xTime.Second < yTime.Second) return -1n;
  if (xTime.Millisecond > yTime.Millisecond) return 1n;
  if (xTime.Millisecond < yTime.Millisecond) return -1n;
  if (xTime.Microsecond > yTime.Microsecond) return 1n;
  if (xTime.Microsecond < yTime.Microsecond) return -1n;
  if (xTime.Nanosecond > yTime.Nanosecond) return 1n;
  if (xTime.Nanosecond < yTime.Nanosecond) return -1n;
  return 0n;
}

/** https://tc39.es/proposal-temporal/#sec-temporal-addtime */
export function AddTime(time: TimeRecord, timeDuration: TimeDuration): TimeRecord {
  return BalanceTime(time.Hour, time.Minute, time.Second, time.Millisecond, time.Microsecond, time.Nanosecond + timeDuration);
}

/** https://tc39.es/proposal-temporal/#sec-temporal-roundtime */
export function RoundTime(time: TimeRecord, increment: Integer, unit: TimeUnit | 'day', roundingMode: RoundingMode): TimeRecord {
  let quantity = 0n;
  if (unit === 'day' || unit === 'hour') {
    quantity = time.Hour * NanosecondsPerHour;
  }
  if (unit === 'day' || unit === 'hour' || unit === 'minute') {
    quantity += time.Minute * NanosecondsPerMinute;
  }
  if (unit === 'day' || unit === 'hour' || unit === 'minute' || unit === 'second') {
    quantity += time.Second * NanosecondsPerSecond;
  }
  if (unit === 'day' || unit === 'hour' || unit === 'minute' || unit === 'second' || unit === 'millisecond') {
    quantity += time.Millisecond * NanosecondsPerMillisecond;
  }
  if (unit === 'day' || unit === 'hour' || unit === 'minute' || unit === 'second' || unit === 'millisecond' || unit === 'microsecond') {
    quantity += time.Microsecond * NanosecondsPerMicrosecond;
  }
  quantity += time.Nanosecond;
  const unitLength = TemporalUnitLength(unit);
  const result = RoundNumberToIncrement(Decimal(quantity), increment * unitLength, roundingMode) / unitLength;
  if (unit === 'day') return X(CreateTimeRecord(0n, 0n, 0n, 0n, 0n, 0n, result));
  if (unit === 'hour') return BalanceTime(result, 0n, 0n, 0n, 0n, 0n);
  if (unit === 'minute') return BalanceTime(time.Hour, result, 0n, 0n, 0n, 0n);
  if (unit === 'second') return BalanceTime(time.Hour, time.Minute, result, 0n, 0n, 0n);
  if (unit === 'millisecond') return BalanceTime(time.Hour, time.Minute, time.Second, result, 0n, 0n);
  if (unit === 'microsecond') return BalanceTime(time.Hour, time.Minute, time.Second, time.Millisecond, result, 0n);
  Assert(unit === 'nanosecond');
  return BalanceTime(time.Hour, time.Minute, time.Second, time.Millisecond, time.Microsecond, result);
}

/** https://tc39.es/proposal-temporal/#sec-temporal-differencetemporalplaintime */
export function* DifferenceTemporalPlainTime(operation: 'since' | 'until', temporalTime: TemporalPlainTimeObject, _other: Value, options: Value): ValueEvaluator<TemporalDurationObject> {
  const other = Q(yield* ToTemporalTime(_other));
  const resolvedOptions = Q(GetOptionsObject(options));
  const settings = Q(yield* GetDifferenceSettings(operation, resolvedOptions, 'time', [], 'nanosecond', 'hour'));
  let timeDuration = DifferenceTime(temporalTime.Time, other.Time);
  timeDuration = X(RoundTimeDuration(timeDuration, settings.RoundingIncrement, settings.SmallestUnit as TimeUnit, settings.RoundingMode));
  const duration = CombineDateAndTimeDuration(ZeroDateDuration(), timeDuration);
  let result = X(TemporalDurationFromInternal(duration, settings.LargestUnit));
  if (operation === 'since') {
    result = CreateNegatedTemporalDuration(result);
  }
  return result;
}

/** https://tc39.es/proposal-temporal/#sec-temporal-adddurationtotime */
export function* AddDurationToTime(operation: 'add' | 'subtract', temporalTime: TemporalPlainTimeObject, temporalDurationLike: Value): ValueEvaluator<TemporalPlainTimeObject> {
  let duration = Q(yield* ToTemporalDuration(temporalDurationLike));
  if (operation === 'subtract') duration = CreateNegatedTemporalDuration(duration);
  const internalDuration = ToInternalDurationRecord(duration);
  const result = AddTime(temporalTime.Time, internalDuration.Time);
  return X(CreateTemporalTime(result));
}
