import { __ts_cast__ } from '../../utils/language.mts';
import { type TemporalDurationObject, isTemporalDurationObject } from '../../intrinsics/Temporal/Duration.mts';
import { type TemporalPlainDateObject } from '../../intrinsics/Temporal/PlainDate.mts';
import { type ISODateTimeRecord } from '../../intrinsics/Temporal/PlainDateTime.mts';
import { ParseTemporalDurationString } from '../../parser/TemporalParser.mts';
import {
  abs, floorDiv, modulo, remainder, truncateDiv,
} from '../math.mts';
import { SnapToInteger } from '../type-conversion.mts';
import { Decimal } from '../../host-defined/decimal.mts';
import { GetUTCEpochNanoseconds } from '../date-objects.mts';
import {
  type TimeZoneIdentifier, NoTimeZone, type RoundingMode,
} from './addition.mts';
import { CalendarDateAdd, type KnownCalendarType, CalendarDateUntil } from './calendar.mts';
import {
  type TemporalUnit, isDateUnit, RoundNumberToIncrement, ISODateToEpochDays, type TimeUnit, TemporalUnitLength, type DateUnit, GetUnsignedRoundingMode, ApplyUnsignedRoundingMode, isCalendarUnit, isTimeUnit, LargerOfTwoTemporalUnits, FormatFractionalSeconds,
  type Float64RepresentableInteger,
  type EpochNanoseconds,
} from './temporal.mts';
import { GetEpochNanosecondsFor } from './time-zone.mts';
import {
  X, type ValueEvaluator, Assert, type PlainCompletion, surroundingAgent, Value, ObjectValue, JSStringValue, type Mutable, Q, type PlainEvaluator, Get, type FunctionObject, OrdinaryCreateFromConstructor, HoursPerDay, MinutesPerHour, SecondsPerMinute, NanosecondsPerSecond, NanosecondsPerMillisecond, NanosecondsPerMicrosecond, NanosecondsPerMinute, NanosecondsPerHour,
  NanosecondsPerDay,
  AddDaysToISODate,
  Throw,
  type Integer,
  type MathematicalValue,
} from '#self';

/** https://tc39.es/proposal-temporal/#sec-temporal-date-duration-records */
export interface DateDurationRecord {
  readonly Years: Float64RepresentableInteger;
  readonly Months: Float64RepresentableInteger;
  readonly Weeks: Float64RepresentableInteger;
  Days: Float64RepresentableInteger;
}

/** https://tc39.es/proposal-temporal/#sec-temporal-partial-duration-records */
export interface PartialDurationRecord {
  readonly Years: Float64RepresentableInteger | undefined;
  readonly Months: Float64RepresentableInteger | undefined;
  readonly Weeks: Float64RepresentableInteger | undefined;
  readonly Days: Float64RepresentableInteger | undefined;
  readonly Hours: Float64RepresentableInteger | undefined;
  readonly Minutes: Float64RepresentableInteger | undefined;
  readonly Seconds: Float64RepresentableInteger | undefined;
  readonly Milliseconds: Float64RepresentableInteger | undefined;
  readonly Microseconds: Float64RepresentableInteger | undefined;
  readonly Nanoseconds: Float64RepresentableInteger | undefined;
}

/** https://tc39.es/proposal-temporal/#sec-temporal-internal-duration-records */
export interface InternalDurationRecord {
  readonly Date: DateDurationRecord;
  readonly Time: TimeDuration;
}

/** https://tc39.es/proposal-temporal/#sec-temporal-internal-duration-records */
export type TimeDuration = Integer & { specName?: 'TimeDuration' };

/** https://tc39.es/proposal-temporal/#sec-temporal-zerodateduration */
export function ZeroDateDuration(): DateDurationRecord {
  return X(CreateDateDurationRecord(0n, 0n, 0n, 0n));
}

/** https://tc39.es/proposal-temporal/#sec-temporal-tointernaldurationrecord */
export function ToInternalDurationRecord(duration: TemporalDurationObject): InternalDurationRecord {
  const dateDuration = X(CreateDateDurationRecord(duration.Years, duration.Months, duration.Weeks, duration.Days));
  const timeDuration = X(TimeDurationFromComponents(duration.Hours, duration.Minutes, duration.Seconds, duration.Milliseconds, duration.Microseconds, duration.Nanoseconds));
  return CombineDateAndTimeDuration(dateDuration, timeDuration);
}

/** https://tc39.es/proposal-temporal/#sec-temporal-tointernaldurationrecordwith24hourdays */
export function ToInternalDurationRecordWith24HourDays(duration: TemporalDurationObject): InternalDurationRecord {
  let timeDuration = X(TimeDurationFromComponents(duration.Hours, duration.Minutes, duration.Seconds, duration.Milliseconds, duration.Microseconds, duration.Nanoseconds));
  timeDuration = X(Add24HourDaysToTimeDuration(timeDuration, duration.Days));
  const dateDuration = X(CreateDateDurationRecord(duration.Years, duration.Months, duration.Weeks, 0n));
  return CombineDateAndTimeDuration(dateDuration, timeDuration);
}

/** https://tc39.es/proposal-temporal/#sec-temporal-temporaldurationfrominternal */
export function TemporalDurationFromInternal(internalDuration: InternalDurationRecord, largestUnit: TemporalUnit): ValueEvaluator<TemporalDurationObject> {
  let days = 0n;
  let hours = 0n;
  let minutes = 0n;
  let seconds = 0n;
  let milliseconds = 0n;
  let microseconds = 0n;
  const sign = TimeDurationSign(internalDuration.Time);
  let nanoseconds = abs(internalDuration.Time);
  if (isDateUnit(largestUnit)) {
    microseconds = floorDiv(nanoseconds, 1000n);
    nanoseconds = modulo(nanoseconds, 1000n);
    milliseconds = floorDiv(microseconds, 1000n);
    microseconds = modulo(microseconds, 1000n);
    seconds = floorDiv(milliseconds, 1000n);
    milliseconds = modulo(milliseconds, 1000n);
    minutes = floorDiv(seconds, 60n);
    seconds = modulo(seconds, 60n);
    hours = floorDiv(minutes, 60n);
    minutes = modulo(minutes, 60n);
    days = floorDiv(hours, 24n);
    hours = modulo(hours, 24n);
  } else if (largestUnit === 'hour') {
    microseconds = floorDiv(nanoseconds, 1000n);
    nanoseconds = modulo(nanoseconds, 1000n);
    milliseconds = floorDiv(microseconds, 1000n);
    microseconds = modulo(microseconds, 1000n);
    seconds = floorDiv(milliseconds, 1000n);
    milliseconds = modulo(milliseconds, 1000n);
    minutes = floorDiv(seconds, 60n);
    seconds = modulo(seconds, 60n);
    hours = floorDiv(minutes, 60n);
    minutes = modulo(minutes, 60n);
  } else if (largestUnit === 'minute') {
    microseconds = floorDiv(nanoseconds, 1000n);
    nanoseconds = modulo(nanoseconds, 1000n);
    milliseconds = floorDiv(microseconds, 1000n);
    microseconds = modulo(microseconds, 1000n);
    seconds = floorDiv(milliseconds, 1000n);
    milliseconds = modulo(milliseconds, 1000n);
    minutes = floorDiv(seconds, 60n);
    seconds = modulo(seconds, 60n);
  } else if (largestUnit === 'second') {
    microseconds = floorDiv(nanoseconds, 1000n);
    nanoseconds = modulo(nanoseconds, 1000n);
    milliseconds = floorDiv(microseconds, 1000n);
    microseconds = modulo(microseconds, 1000n);
    seconds = floorDiv(milliseconds, 1000n);
    milliseconds = modulo(milliseconds, 1000n);
  } else if (largestUnit === 'millisecond') {
    microseconds = floorDiv(nanoseconds, 1000n);
    nanoseconds = modulo(nanoseconds, 1000n);
    milliseconds = floorDiv(microseconds, 1000n);
    microseconds = modulo(microseconds, 1000n);
  } else if (largestUnit === 'microsecond') {
    microseconds = floorDiv(nanoseconds, 1000n);
    nanoseconds = modulo(nanoseconds, 1000n);
  } else {
    Assert(largestUnit === 'nanosecond');
  }
  return CreateTemporalDuration(BigInt(internalDuration.Date.Years), BigInt(internalDuration.Date.Months), BigInt(internalDuration.Date.Weeks), BigInt(internalDuration.Date.Days) + days * sign, hours * sign, minutes * sign, seconds * sign, milliseconds * sign, microseconds * sign, nanoseconds * sign);
}

/** https://tc39.es/proposal-temporal/#sec-temporal-createdatedurationrecord */
export function CreateDateDurationRecord(years: Integer, months: Integer, weeks: Integer, days: Integer): PlainCompletion<DateDurationRecord> {
  if (!IsValidDuration(years, months, weeks, days, 0n, 0n, 0n, 0n, 0n, 0n)) {
    return Throw.RangeError('Duration($1, $2, $3, $4) is not a valid duration', years, months, weeks, days);
  }
  return {
    Years: Number(years),
    Months: Number(months),
    Weeks: Number(weeks),
    Days: Number(days),
  };
}

/** https://tc39.es/proposal-temporal/#sec-temporal-adjustdatedurationrecord */
export function AdjustDateDurationRecord(
  dateDuration: DateDurationRecord,
  days: Integer,
  weeks?: Integer,
  months?: Integer,
): PlainCompletion<DateDurationRecord> {
  weeks ??= BigInt(dateDuration.Weeks);
  months ??= BigInt(dateDuration.Months);
  return CreateDateDurationRecord(BigInt(dateDuration.Years), months, weeks, days);
}

/** https://tc39.es/proposal-temporal/#sec-temporal-combinedateandtimeduration */
export function CombineDateAndTimeDuration(dateDuration: DateDurationRecord, timeDuration: TimeDuration): InternalDurationRecord {
  const dateSign = DateDurationSign(dateDuration);
  const timeSign = TimeDurationSign(timeDuration);
  if (dateSign !== 0n && timeSign !== 0n) {
    Assert(dateSign === timeSign);
  }
  return {
    Date: dateDuration,
    Time: timeDuration,
  };
}

/** https://tc39.es/proposal-temporal/#sec-temporal-totemporalduration */
export function* ToTemporalDuration(item: Value): ValueEvaluator<TemporalDurationObject> {
  if (isTemporalDurationObject(item)) {
    return X(CreateTemporalDuration(item.Years, item.Months, item.Weeks, item.Days, item.Hours, item.Minutes, item.Seconds, item.Milliseconds, item.Microseconds, item.Nanoseconds));
  }
  if (!(item instanceof ObjectValue)) {
    if (!(item instanceof JSStringValue)) {
      return Throw.TypeError('Cannot convert $1 to Temporal.Duration', item);
    }
    return Q(yield* ParseTemporalDurationString(item.stringValue()));
  }
  const result = {
    Years: 0,
    Months: 0,
    Weeks: 0,
    Days: 0,
    Hours: 0,
    Minutes: 0,
    Seconds: 0,
    Milliseconds: 0,
    Microseconds: 0,
    Nanoseconds: 0,
  } satisfies Mutable<PartialDurationRecord>;
  const partial = Q(yield* ToPartialDurationRecord(item));
  if (partial.Years !== undefined) result.Years = partial.Years;
  if (partial.Months !== undefined) result.Months = partial.Months;
  if (partial.Weeks !== undefined) result.Weeks = partial.Weeks;
  if (partial.Days !== undefined) result.Days = partial.Days;
  if (partial.Hours !== undefined) result.Hours = partial.Hours;
  if (partial.Minutes !== undefined) result.Minutes = partial.Minutes;
  if (partial.Seconds !== undefined) result.Seconds = partial.Seconds;
  if (partial.Milliseconds !== undefined) result.Milliseconds = partial.Milliseconds;
  if (partial.Microseconds !== undefined) result.Microseconds = partial.Microseconds;
  if (partial.Nanoseconds !== undefined) result.Nanoseconds = partial.Nanoseconds;
  return Q(yield* CreateTemporalDuration(BigInt(result.Years), BigInt(result.Months), BigInt(result.Weeks), BigInt(result.Days), BigInt(result.Hours), BigInt(result.Minutes), BigInt(result.Seconds), BigInt(result.Milliseconds), BigInt(result.Microseconds), BigInt(result.Nanoseconds)));
}

/** https://tc39.es/proposal-temporal/#sec-temporal-durationsign */
export function DurationSign(duration: TemporalDurationObject): -1 | 0 | 1 {
  for (const value of [
    duration.Years,
    duration.Months,
    duration.Weeks,
    duration.Days,
    duration.Hours,
    duration.Minutes,
    duration.Seconds,
    duration.Milliseconds,
    duration.Microseconds,
    duration.Nanoseconds,
  ]) {
    if (value < 0) return -1;
    if (value > 0) return 1;
  }
  return 0;
}

/** https://tc39.es/proposal-temporal/#sec-temporal-datedurationsign */
export function DateDurationSign(dateDuration: DateDurationRecord): -1n | 0n | 1n {
  if (dateDuration.Years < 0) return -1n;
  if (dateDuration.Years > 0) return 1n;
  if (dateDuration.Months < 0) return -1n;
  if (dateDuration.Months > 0) return 1n;
  if (dateDuration.Weeks < 0) return -1n;
  if (dateDuration.Weeks > 0) return 1n;
  if (dateDuration.Days < 0) return -1n;
  if (dateDuration.Days > 0) return 1n;
  return 0n;
}

/** https://tc39.es/proposal-temporal/#sec-temporal-internaldurationsign */
export function InternalDurationSign(internalDuration: InternalDurationRecord): -1n | 0n | 1n {
  const dateSign = DateDurationSign(internalDuration.Date);
  if (dateSign !== 0n) {
    return dateSign;
  }
  return TimeDurationSign(internalDuration.Time);
}

/** https://tc39.es/proposal-temporal/#sec-temporal-isvalidduration */
export function IsValidDuration(
  years: Integer,
  months: Integer,
  weeks: Integer,
  days: Integer,
  hours: Integer,
  minutes: Integer,
  seconds: Integer,
  milliseconds: Integer,
  microseconds: Integer,
  nanoseconds: Integer,
): boolean {
  let sign = 0;
  for (const value of [years, months, weeks, days, hours, minutes, seconds, milliseconds, microseconds, nanoseconds]) {
    Assert(Number.isFinite(Number(value)));
    if (value < 0) {
      if (sign > 0) return false;
      sign = -1;
    } else if (value > 0) {
      if (sign < 0) return false;
      sign = 1;
    }
  }
  if (years <= -(2 ** 32) || years >= 2 ** 32) return false;
  if (months <= -(2 ** 32) || months >= 2 ** 32) return false;
  if (weeks <= -(2 ** 32) || weeks >= 2 ** 32) return false;
  const normalizedNanoseconds = days * NanosecondsPerDay
    + hours * NanosecondsPerHour
    + minutes * NanosecondsPerMinute
    + seconds * NanosecondsPerSecond
    + BigInt(Number(milliseconds)) * NanosecondsPerMillisecond
    + BigInt(Number(microseconds)) * NanosecondsPerMicrosecond
    + BigInt(Number(nanoseconds));
  if (normalizedNanoseconds >= ((2n ** 53n) * NanosecondsPerSecond) || normalizedNanoseconds <= -((2n ** 53n) * NanosecondsPerSecond)) return false;
  return true;
}

/** https://tc39.es/proposal-temporal/#sec-temporal-defaulttemporallargestunit */
export function DefaultTemporalLargestUnit(duration: TemporalDurationObject): TemporalUnit {
  if (duration.Years !== 0n) return 'year';
  if (duration.Months !== 0n) return 'month';
  if (duration.Weeks !== 0n) return 'week';
  if (duration.Days !== 0n) return 'day';
  if (duration.Hours !== 0n) return 'hour';
  if (duration.Minutes !== 0n) return 'minute';
  if (duration.Seconds !== 0n) return 'second';
  if (duration.Milliseconds !== 0n) return 'millisecond';
  if (duration.Microseconds !== 0n) return 'microsecond';
  return 'nanosecond';
}

/** https://tc39.es/proposal-temporal/#sec-topartialdurationrecord */
export function* ToPartialDurationRecord(temporalDurationLike: Value): PlainEvaluator<PartialDurationRecord> {
  if (!(temporalDurationLike instanceof ObjectValue)) {
    return Throw.TypeError('Cannot convert $1 to TemporalPartialDurationRecord', temporalDurationLike);
  }
  const result: Mutable<PartialDurationRecord> = {
    Days: undefined,
    Hours: undefined,
    Microseconds: undefined,
    Milliseconds: undefined,
    Minutes: undefined,
    Months: undefined,
    Nanoseconds: undefined,
    Seconds: undefined,
    Weeks: undefined,
    Years: undefined,
  };
  const days = Q(yield* Get(temporalDurationLike, 'days'));
  if (days !== Value.undefined) {
    result.Days = Number(Q(yield* SnapToInteger(days, 'reject')));
  }
  const hours = Q(yield* Get(temporalDurationLike, 'hours'));
  if (hours !== Value.undefined) {
    result.Hours = Number(Q(yield* SnapToInteger(hours, 'reject')));
  }
  const microseconds = Q(yield* Get(temporalDurationLike, 'microseconds'));
  if (microseconds !== Value.undefined) {
    result.Microseconds = Number(Q(yield* SnapToInteger(microseconds, 'reject')));
  }
  const milliseconds = Q(yield* Get(temporalDurationLike, 'milliseconds'));
  if (milliseconds !== Value.undefined) {
    result.Milliseconds = Number(Q(yield* SnapToInteger(milliseconds, 'reject')));
  }
  const minutes = Q(yield* Get(temporalDurationLike, 'minutes'));
  if (minutes !== Value.undefined) {
    result.Minutes = Number(Q(yield* SnapToInteger(minutes, 'reject')));
  }
  const months = Q(yield* Get(temporalDurationLike, 'months'));
  if (months !== Value.undefined) {
    result.Months = Number(Q(yield* SnapToInteger(months, 'reject')));
  }
  const nanoseconds = Q(yield* Get(temporalDurationLike, 'nanoseconds'));
  if (nanoseconds !== Value.undefined) {
    result.Nanoseconds = Number(Q(yield* SnapToInteger(nanoseconds, 'reject')));
  }
  const seconds = Q(yield* Get(temporalDurationLike, 'seconds'));
  if (seconds !== Value.undefined) {
    result.Seconds = Number(Q(yield* SnapToInteger(seconds, 'reject')));
  }
  const weeks = Q(yield* Get(temporalDurationLike, 'weeks'));
  if (weeks !== Value.undefined) {
    result.Weeks = Number(Q(yield* SnapToInteger(weeks, 'reject')));
  }
  const years = Q(yield* Get(temporalDurationLike, 'years'));
  if (years !== Value.undefined) {
    result.Years = Number(Q(yield* SnapToInteger(years, 'reject')));
  }

  if (years === Value.undefined
    && months === Value.undefined
    && weeks === Value.undefined
    && days === Value.undefined
    && hours === Value.undefined
    && minutes === Value.undefined
    && seconds === Value.undefined
    && milliseconds === Value.undefined
    && microseconds === Value.undefined
    && nanoseconds === Value.undefined) {
    return Throw.TypeError('Invalid duration');
  }
  return result;
}

/** https://tc39.es/proposal-temporal/#sec-temporal-createtemporalduration */
export function* CreateTemporalDuration(
  years: Integer,
  months: Integer,
  weeks: Integer,
  days: Integer,
  hours: Integer,
  minutes: Integer,
  seconds: Integer,
  milliseconds: Integer,
  microseconds: Integer,
  nanoseconds: Integer,
  newTarget?: FunctionObject,
): ValueEvaluator<TemporalDurationObject> {
  if (!IsValidDuration(years, months, weeks, days, hours, minutes, seconds, milliseconds, microseconds, nanoseconds)) {
    return Throw.RangeError('Invalid duration');
  }
  if (newTarget === undefined) {
    newTarget = surroundingAgent.currentRealmRecord.Intrinsics['%Temporal.Duration%'];
  }
  const object = Q(yield* OrdinaryCreateFromConstructor(newTarget, '%Temporal.Duration.prototype%', [
    'InitializedTemporalDuration',
    'Years',
    'Months',
    'Weeks',
    'Days',
    'Hours',
    'Minutes',
    'Seconds',
    'Milliseconds',
    'Microseconds',
    'Nanoseconds',
  ])) as Mutable<TemporalDurationObject>;
  object.Years = BigInt(Number(years));
  object.Months = BigInt(Number(months));
  object.Weeks = BigInt(Number(weeks));
  object.Days = BigInt(Number(days));
  object.Hours = BigInt(Number(hours));
  object.Minutes = BigInt(Number(minutes));
  object.Seconds = BigInt(Number(seconds));
  object.Milliseconds = BigInt(Number(milliseconds));
  object.Microseconds = BigInt(Number(microseconds));
  object.Nanoseconds = BigInt(Number(nanoseconds));
  return object;
}

/** https://tc39.es/proposal-temporal/#sec-temporal-createnegatedtemporalduration */
export function CreateNegatedTemporalDuration(duration: TemporalDurationObject): TemporalDurationObject {
  return X(CreateTemporalDuration(
    -duration.Years,
    -duration.Months,
    -duration.Weeks,
    -duration.Days,
    -duration.Hours,
    -duration.Minutes,
    -duration.Seconds,
    -duration.Milliseconds,
    -duration.Microseconds,
    -duration.Nanoseconds,
  ));
}

/** https://tc39.es/proposal-temporal/#sec-temporal-timedurationfromcomponents */
export function TimeDurationFromComponents(
  hours: Integer,
  minutes: Integer,
  seconds: Integer,
  milliseconds: Integer,
  microseconds: Integer,
  nanoseconds: Integer,
): PlainCompletion<TimeDuration> {
  const secondsPart = (hours * MinutesPerHour + minutes) * SecondsPerMinute + seconds;
  const result = secondsPart * NanosecondsPerSecond
    + milliseconds * NanosecondsPerMillisecond
    + microseconds * NanosecondsPerMicrosecond
    + nanoseconds;
  // If _nanoseconds_ is not a time duration
  if (abs(result) > maxTimeDuration) {
    return Throw.RangeError('Invalid duration');
  }
  return result;
}

/** https://tc39.es/proposal-temporal/#sec-temporal-addtimeduration */
export function AddTimeDuration(xTimeDuration: TimeDuration, yTimeDuration: TimeDuration): PlainCompletion<TimeDuration> {
  const result = xTimeDuration + yTimeDuration;
  // If _result_ is not a time duration
  if (abs(result) > maxTimeDuration) {
    return Throw.RangeError('Invalid duration');
  }
  return result;
}

/** https://tc39.es/proposal-temporal/#sec-temporal-add24hourdaystotimeduration */
export function Add24HourDaysToTimeDuration(timeDuration: TimeDuration, days: Integer): PlainCompletion<TimeDuration> {
  const result = timeDuration + days * NanosecondsPerDay;
  // If _result_ is not a time duration
  if (abs(result) > maxTimeDuration) {
    return Throw.RangeError('Invalid duration');
  }
  return result;
}

/** https://tc39.es/proposal-temporal/#sec-temporal-addtimedurationtoepochnanoseconds */
export function AddTimeDurationToEpochNanoseconds(timeDuration: TimeDuration, epochNanoseconds: EpochNanoseconds): Integer {
  return timeDuration + epochNanoseconds;
}

/** https://tc39.es/proposal-temporal/#sec-temporal-comparetimeduration */
export function CompareTimeDuration(one: TimeDuration, two: TimeDuration): -1 | 0 | 1 {
  if (one > two) {
    return 1;
  }
  if (one < two) {
    return -1;
  }
  return 0;
}

/** https://tc39.es/proposal-temporal/#sec-temporal-timedurationfromepochnanosecondsdifference */
export function TimeDurationFromEpochNanosecondsDifference(epochNanosecondsFrom: EpochNanoseconds, epochNanosecondsTo: EpochNanoseconds): TimeDuration {
  const result = epochNanosecondsTo - epochNanosecondsFrom;
  // Assert: _result_ is a time duration.
  Assert(abs(result) <= maxTimeDuration);
  return result;
}

/** https://tc39.es/proposal-temporal/#sec-temporal-roundtimedurationtoincrement */
export function RoundTimeDurationToIncrement(
  timeDuration: TimeDuration,
  increment: Integer,
  roundingMode: RoundingMode,
): PlainCompletion<TimeDuration> {
  const rounded = RoundNumberToIncrement(Decimal(timeDuration), increment, roundingMode);
  // If _rounded_ is not a time duration
  if (abs(rounded) > maxTimeDuration) {
    return Throw.RangeError('Invalid duration');
  }
  return rounded;
}

/** https://tc39.es/proposal-temporal/#sec-temporal-timedurationsign */
export function TimeDurationSign(timeDuration: TimeDuration): -1n | 0n | 1n {
  if (timeDuration < 0) {
    return -1n;
  }
  if (timeDuration > 0) {
    return 1n;
  }
  return 0n;
}

/** https://tc39.es/proposal-temporal/#sec-temporal-datedurationdays */
export function DateDurationDays(dateDuration: DateDurationRecord, plainRelativeTo: TemporalPlainDateObject): PlainCompletion<Integer> {
  const yearsMonthsWeeksDuration = X(AdjustDateDurationRecord(dateDuration, 0n));
  if (DateDurationSign(yearsMonthsWeeksDuration) === 0n) {
    return BigInt(dateDuration.Days);
  }
  const isoDateTo = Q(CalendarDateAdd(plainRelativeTo.Calendar, plainRelativeTo.ISODate, yearsMonthsWeeksDuration, 'constrain'));
  const epochDaysFrom = ISODateToEpochDays(plainRelativeTo.ISODate.Year, plainRelativeTo.ISODate.Month - 1n, plainRelativeTo.ISODate.Day);
  const epochDaysTo = ISODateToEpochDays(isoDateTo.Year, isoDateTo.Month - 1n, isoDateTo.Day);
  const yearsMonthsWeeksInDays = epochDaysTo - epochDaysFrom;
  return BigInt(dateDuration.Days) + yearsMonthsWeeksInDays;
}

/** https://tc39.es/proposal-temporal/#sec-temporal-roundtimeduration */
export function RoundTimeDuration(
  timeDuration: TimeDuration,
  increment: Integer,
  unit: TimeUnit,
  roundingMode: RoundingMode,
): PlainCompletion<TimeDuration> {
  return RoundTimeDurationToIncrement(timeDuration, TemporalUnitLength(unit) * increment, roundingMode);
}

/** https://tc39.es/proposal-temporal/#sec-temporal-totaltimeduration */
export function TotalTimeDuration(timeDuration: TimeDuration, unit: TimeUnit | 'day'): MathematicalValue {
  return Decimal(timeDuration).divide(TemporalUnitLength(unit));
}

/** https://tc39.es/proposal-temporal/#sec-temporal-duration-nudge-result-records */
export interface DurationNudgeResultRecord {
  readonly Duration: InternalDurationRecord;
  readonly NudgedEpochNanoseconds: EpochNanoseconds;
  readonly DidExpandCalendarUnit: boolean;
}

/** https://tc39.es/proposal-temporal/#sec-temporal-computenudgewindow */
export function ComputeNudgeWindow(
  sign: -1n | 1n,
  duration: InternalDurationRecord,
  originEpochNanoseconds: EpochNanoseconds,
  isoDateTime: ISODateTimeRecord,
  timeZone: TimeZoneIdentifier | undefined,
  calendar: KnownCalendarType,
  increment: Integer,
  unit: DateUnit,
  additionalShift: boolean,
): PlainCompletion<{
  InnerBound: MathematicalValue;
  OuterBound: MathematicalValue;
  StartEpochNanoseconds: EpochNanoseconds;
  EndEpochNanoseconds: EpochNanoseconds;
  StartDuration: InternalDurationRecord;
  EndDuration: InternalDurationRecord;
}> {
  let innerBound: MathematicalValue;
  let outerBound: MathematicalValue;
  let startDateDuration;
  let endDateDuration;
  if (unit === 'year') {
    const years = RoundNumberToIncrement(Decimal(duration.Date.Years), increment, 'trunc');
    if (!additionalShift) {
      innerBound = Decimal(years);
    } else {
      innerBound = Decimal(years + increment * sign);
    }
    outerBound = innerBound.add(increment * sign);
    startDateDuration = Q(CreateDateDurationRecord(innerBound.toBigInt(), 0n, 0n, 0n));
    endDateDuration = Q(CreateDateDurationRecord(outerBound.toBigInt(), 0n, 0n, 0n));
  } else if (unit === 'month') {
    const months = RoundNumberToIncrement(Decimal(duration.Date.Months), increment, 'trunc');
    if (!additionalShift) {
      innerBound = Decimal(months);
    } else {
      innerBound = Decimal(months + increment * sign);
    }
    outerBound = innerBound.add(increment * sign);
    startDateDuration = Q(AdjustDateDurationRecord(duration.Date, 0n, 0n, innerBound.toBigInt()));
    endDateDuration = Q(AdjustDateDurationRecord(duration.Date, 0n, 0n, outerBound.toBigInt()));
  } else if (unit === 'week') {
    const yearsMonths = X(AdjustDateDurationRecord(duration.Date, 0n, 0n));
    const weeksStart = Q(CalendarDateAdd(calendar, isoDateTime.ISODate, yearsMonths, 'constrain'));
    const weeksEnd = AddDaysToISODate(weeksStart, BigInt(duration.Date.Days));
    const untilResult = CalendarDateUntil(calendar, weeksStart, weeksEnd, 'week');
    const weeks = RoundNumberToIncrement(Decimal(duration.Date.Weeks + untilResult.Weeks), increment, 'trunc');
    innerBound = Decimal(weeks);
    outerBound = innerBound.add(increment * sign);
    startDateDuration = Q(AdjustDateDurationRecord(duration.Date, 0n, innerBound.toBigInt()));
    endDateDuration = Q(AdjustDateDurationRecord(duration.Date, 0n, outerBound.toBigInt()));
  } else {
    Assert(unit === 'day');
    const days = RoundNumberToIncrement(Decimal(duration.Date.Days), increment, 'trunc');
    innerBound = Decimal(days);
    outerBound = innerBound.add(increment * sign);
    startDateDuration = Q(AdjustDateDurationRecord(duration.Date, innerBound.toBigInt()));
    endDateDuration = Q(AdjustDateDurationRecord(duration.Date, outerBound.toBigInt()));
  }
  if (sign === 1n) Assert(innerBound.greaterThanOrEqual(0) && innerBound.lessThan(outerBound));
  if (sign === -1n) Assert(innerBound.lessThanOrEqual(0) && innerBound.greaterThan(outerBound));
  let startEpochNanoseconds;
  if (DateDurationSign(startDateDuration) === 0n) {
    startEpochNanoseconds = originEpochNanoseconds;
  } else {
    const start = Q(CalendarDateAdd(calendar, isoDateTime.ISODate, startDateDuration, 'constrain'));
    const startDateTime: ISODateTimeRecord = { ISODate: start, Time: isoDateTime.Time };
    if (timeZone === NoTimeZone) {
      startEpochNanoseconds = GetUTCEpochNanoseconds(startDateTime);
    } else {
      startEpochNanoseconds = Q(GetEpochNanosecondsFor(timeZone, startDateTime, 'compatible'));
    }
  }
  const end = Q(CalendarDateAdd(calendar, isoDateTime.ISODate, endDateDuration, 'constrain'));
  const endDateTime: ISODateTimeRecord = { ISODate: end, Time: isoDateTime.Time };
  let endEpochNanoseconds;
  if (timeZone === NoTimeZone) {
    endEpochNanoseconds = GetUTCEpochNanoseconds(endDateTime);
  } else {
    endEpochNanoseconds = Q(GetEpochNanosecondsFor(timeZone, endDateTime, 'compatible'));
  }
  const startDuration = CombineDateAndTimeDuration(startDateDuration, 0n);
  const endDuration = CombineDateAndTimeDuration(endDateDuration, 0n);
  return {
    InnerBound: innerBound,
    OuterBound: outerBound,
    StartEpochNanoseconds: startEpochNanoseconds,
    EndEpochNanoseconds: endEpochNanoseconds,
    StartDuration: startDuration,
    EndDuration: endDuration,
  };
}

/** https://tc39.es/proposal-temporal/#sec-temporal-nudgetocalendarunit */
export function NudgeToCalendarUnit(
  sign: -1n | 1n,
  duration: InternalDurationRecord,
  originEpochNanoseconds: EpochNanoseconds,
  destEpochNanoseconds: EpochNanoseconds,
  isoDateTime: ISODateTimeRecord,
  timeZone: TimeZoneIdentifier | undefined,
  calendar: KnownCalendarType,
  increment: Integer,
  unit: DateUnit,
  roundingMode: RoundingMode,
): PlainCompletion<{ NudgeResult: DurationNudgeResultRecord; Total: MathematicalValue }> {
  let didExpandCalendarUnit = false;
  let nudgeWindow = Q(ComputeNudgeWindow(sign, duration, originEpochNanoseconds, isoDateTime, timeZone, calendar, increment, unit, false));
  let startEpochNanoseconds = nudgeWindow.StartEpochNanoseconds;
  let endEpochNanoseconds = nudgeWindow.EndEpochNanoseconds;
  if (sign === 1n) {
    if (!(startEpochNanoseconds <= destEpochNanoseconds && destEpochNanoseconds <= endEpochNanoseconds)) {
      nudgeWindow = Q(ComputeNudgeWindow(sign, duration, originEpochNanoseconds, isoDateTime, timeZone, calendar, increment, unit, true));
      Assert(nudgeWindow.StartEpochNanoseconds <= destEpochNanoseconds && destEpochNanoseconds <= nudgeWindow.EndEpochNanoseconds);
      didExpandCalendarUnit = true;
    }
  } else {
    if (!(endEpochNanoseconds <= destEpochNanoseconds && destEpochNanoseconds <= startEpochNanoseconds)) {
      nudgeWindow = Q(ComputeNudgeWindow(sign, duration, originEpochNanoseconds, isoDateTime, timeZone, calendar, increment, unit, true));
      Assert(nudgeWindow.EndEpochNanoseconds <= destEpochNanoseconds && destEpochNanoseconds <= nudgeWindow.StartEpochNanoseconds);
      didExpandCalendarUnit = true;
    }
  }
  const innerBound = nudgeWindow.InnerBound;
  const outerBound = nudgeWindow.OuterBound;
  startEpochNanoseconds = nudgeWindow.StartEpochNanoseconds;
  endEpochNanoseconds = nudgeWindow.EndEpochNanoseconds;
  const startDuration = nudgeWindow.StartDuration;
  const endDuration = nudgeWindow.EndDuration;
  Assert(startEpochNanoseconds !== endEpochNanoseconds);
  const progress = Decimal(destEpochNanoseconds - startEpochNanoseconds).divide(endEpochNanoseconds - startEpochNanoseconds);
  const total = innerBound.add(progress.multiply(increment * sign));
  // 16. NOTE: The above two steps cannot be implemented directly using floating-point arithmetic. This division can be implemented as if expressing total as the quotient of two time durations (which may not be safe integers), performing all other calculations before the division, and finally performing one division operation with a floating-point result for total. The division can be implemented in C++ with the __float128 type if the compiler supports it, or with software emulation such as in the SoftFP library.
  Assert(progress.greaterThanOrEqual(0) && progress.lessThanOrEqual(1));
  const isNegative = sign < 0 ? 'negative' : 'positive';
  const unsignedRoundingMode = GetUnsignedRoundingMode(roundingMode, isNegative);
  let roundedUnit: MathematicalValue;
  if (progress.equals(1)) {
    roundedUnit = outerBound.abs();
  } else {
    Assert(innerBound.abs().lessThanOrEqual(total.abs()) && total.abs().lessThan(outerBound.abs()));
    roundedUnit = ApplyUnsignedRoundingMode(total.abs(), innerBound.abs(), outerBound.abs(), unsignedRoundingMode);
  }
  let resultDuration: InternalDurationRecord;
  let nudgedEpochNanoseconds;
  if (roundedUnit.equals(outerBound.abs())) {
    didExpandCalendarUnit = true;
    resultDuration = endDuration;
    nudgedEpochNanoseconds = endEpochNanoseconds;
  } else {
    resultDuration = startDuration;
    nudgedEpochNanoseconds = startEpochNanoseconds;
  }
  const nudgeResult: DurationNudgeResultRecord = {
    Duration: resultDuration,
    NudgedEpochNanoseconds: nudgedEpochNanoseconds,
    DidExpandCalendarUnit: didExpandCalendarUnit,
  };
  return { NudgeResult: nudgeResult, Total: total };
}

/** https://tc39.es/proposal-temporal/#sec-temporal-nudgetozonedtime */
export function NudgeToZonedTime(
  sign: -1n | 1n,
  duration: InternalDurationRecord,
  isoDateTime: ISODateTimeRecord,
  timeZone: TimeZoneIdentifier,
  calendar: KnownCalendarType,
  increment: Integer,
  unit: TimeUnit,
  roundingMode: RoundingMode,
): PlainCompletion<DurationNudgeResultRecord> {
  const start = Q(CalendarDateAdd(calendar, isoDateTime.ISODate, duration.Date, 'constrain'));
  const startDateTime: ISODateTimeRecord = { ISODate: start, Time: isoDateTime.Time };
  const endDate = AddDaysToISODate(start, sign);
  const endDateTime: ISODateTimeRecord = { ISODate: endDate, Time: isoDateTime.Time };
  const startEpochNanoseconds = Q(GetEpochNanosecondsFor(timeZone, startDateTime, 'compatible'));
  const endEpochNanoseconds = Q(GetEpochNanosecondsFor(timeZone, endDateTime, 'compatible'));
  const daySpan = TimeDurationFromEpochNanosecondsDifference(startEpochNanoseconds, endEpochNanoseconds);
  Assert(TimeDurationSign(daySpan) === sign);
  const unitLength = TemporalUnitLength(unit);
  let roundedTimeDuration = Q(RoundTimeDurationToIncrement(duration.Time, increment * unitLength, roundingMode));
  const beyondDaySpan = X(AddTimeDuration(roundedTimeDuration, -daySpan));
  let didRoundBeyondDay;
  let dayDelta: Integer;
  let nudgedEpochNanoseconds;
  if (TimeDurationSign(beyondDaySpan) !== -sign) {
    didRoundBeyondDay = true;
    dayDelta = sign;
    roundedTimeDuration = Q(RoundTimeDurationToIncrement(beyondDaySpan, increment * unitLength, roundingMode));
    nudgedEpochNanoseconds = AddTimeDurationToEpochNanoseconds(roundedTimeDuration, endEpochNanoseconds);
  } else {
    didRoundBeyondDay = false;
    dayDelta = 0n;
    nudgedEpochNanoseconds = AddTimeDurationToEpochNanoseconds(roundedTimeDuration, startEpochNanoseconds);
  }
  const dateDuration = X(AdjustDateDurationRecord(duration.Date, BigInt(duration.Date.Days) + dayDelta));
  const resultDuration = CombineDateAndTimeDuration(dateDuration, roundedTimeDuration);
  return {
    Duration: resultDuration,
    NudgedEpochNanoseconds: nudgedEpochNanoseconds,
    DidExpandCalendarUnit: didRoundBeyondDay,
  };
}

/** https://tc39.es/proposal-temporal/#sec-temporal-nudgetodayortime */
export function NudgeToDayOrTime(
  duration: InternalDurationRecord,
  destEpochNanoseconds: EpochNanoseconds,
  largestUnit: TemporalUnit,
  increment: Integer,
  smallestUnit: TimeUnit | 'day',
  roundingMode: RoundingMode,
): PlainCompletion<DurationNudgeResultRecord> {
  const timeDuration = X(Add24HourDaysToTimeDuration(duration.Time, BigInt(duration.Date.Days)));
  const roundedTime = Q(RoundTimeDurationToIncrement(timeDuration, TemporalUnitLength(smallestUnit) * increment, roundingMode));
  const diffTime = X(AddTimeDuration(roundedTime, -timeDuration));
  const wholeDays = TotalTimeDuration(timeDuration, 'day').truncate().toBigInt();
  const roundedWholeDays = TotalTimeDuration(roundedTime, 'day').truncate().toBigInt();
  const dayDelta = roundedWholeDays - wholeDays;
  let dayDeltaSign: -1n | 0n | 1n;
  if (dayDelta < 0) dayDeltaSign = -1n;
  else if (dayDelta > 0) dayDeltaSign = 1n;
  else dayDeltaSign = 0n;
  const didExpandDays = dayDeltaSign === TimeDurationSign(timeDuration);
  const nudgedEpochNanoseconds = AddTimeDurationToEpochNanoseconds(diffTime, destEpochNanoseconds);
  let days = 0n;
  let remainder = roundedTime;
  if (isDateUnit(largestUnit)) {
    days = roundedWholeDays;
    remainder = X(AddTimeDuration(roundedTime, X(TimeDurationFromComponents(-roundedWholeDays * HoursPerDay, 0n, 0n, 0n, 0n, 0n))));
  }
  const dateDuration = X(AdjustDateDurationRecord(duration.Date, days));
  const resultDuration = CombineDateAndTimeDuration(dateDuration, remainder);
  return {
    Duration: resultDuration,
    NudgedEpochNanoseconds: nudgedEpochNanoseconds,
    DidExpandCalendarUnit: didExpandDays,
  };
}

/** https://tc39.es/proposal-temporal/#sec-temporal-bubblerelativeduration */
export function BubbleRelativeDuration(
  sign: -1n | 1n,
  duration: InternalDurationRecord,
  nudgedEpochNanoseconds: EpochNanoseconds,
  isoDateTime: ISODateTimeRecord,
  timeZone: TimeZoneIdentifier | undefined,
  calendar: KnownCalendarType,
  largestUnit: TemporalUnit,
  startUnit: 'month' | 'day',
): PlainCompletion<InternalDurationRecord> {
  if (LargerOfTwoTemporalUnits(startUnit, largestUnit) === startUnit) return duration;
  const bubbleUnits: TemporalUnit[] = [];
  if (largestUnit === 'year') bubbleUnits.unshift('year');
  if (startUnit === 'day') {
    if (largestUnit === 'year' || largestUnit === 'month') bubbleUnits.unshift('month');
    if (largestUnit === 'week') bubbleUnits.unshift('week');
  }
  for (const unit of bubbleUnits) {
    let endDuration: DateDurationRecord;
    if (unit === 'year') {
      const years = BigInt(duration.Date.Years) + sign;
      endDuration = Q(CreateDateDurationRecord(years, 0n, 0n, 0n));
    } else if (unit === 'month') {
      const months = BigInt(duration.Date.Months) + sign;
      endDuration = Q(AdjustDateDurationRecord(duration.Date, 0n, 0n, months));
    } else {
      Assert(unit === 'week');
      const weeks = BigInt(duration.Date.Weeks) + sign;
      endDuration = Q(AdjustDateDurationRecord(duration.Date, 0n, weeks));
    }
    const end = Q(CalendarDateAdd(calendar, isoDateTime.ISODate, endDuration, 'constrain'));
    const endDateTime: ISODateTimeRecord = { ISODate: end, Time: isoDateTime.Time };
    let endEpochNanoseconds;
    if (timeZone === undefined) {
      endEpochNanoseconds = GetUTCEpochNanoseconds(endDateTime);
    } else {
      endEpochNanoseconds = Q(GetEpochNanosecondsFor(timeZone, endDateTime, 'compatible'));
    }
    const beyondEnd = nudgedEpochNanoseconds - endEpochNanoseconds;
    let beyondEndSign: -1n | 0n | 1n;
    if (beyondEnd < 0) beyondEndSign = -1n;
    else if (beyondEnd > 0) beyondEndSign = 1n;
    else beyondEndSign = 0n;
    if (beyondEndSign === -sign) return duration;
    duration = CombineDateAndTimeDuration(endDuration, 0n);
  }
  return duration;
}

/** https://tc39.es/proposal-temporal/#sec-temporal-roundrelativeduration */
export function RoundRelativeDuration(
  duration: InternalDurationRecord,
  originEpochNanoseconds: EpochNanoseconds,
  destEpochNanoseconds: EpochNanoseconds,
  isoDateTime: ISODateTimeRecord,
  timeZone: TimeZoneIdentifier | NoTimeZone,
  calendar: KnownCalendarType,
  largestUnit: TemporalUnit,
  increment: Integer,
  smallestUnit: TemporalUnit,
  roundingMode: RoundingMode,
): PlainCompletion<InternalDurationRecord> {
  let irregularLengthUnit = false;
  if (isCalendarUnit(smallestUnit)) {
    irregularLengthUnit = true;
  }
  if (timeZone !== NoTimeZone && smallestUnit === 'day') {
    irregularLengthUnit = true;
  }
  let sign: -1n | 1n;
  if (InternalDurationSign(duration) < 0) {
    sign = -1n;
  } else {
    sign = 1n;
  }
  let nudgeResult;
  if (irregularLengthUnit) {
    const record = Q(NudgeToCalendarUnit(sign, duration, originEpochNanoseconds, destEpochNanoseconds, isoDateTime, timeZone, calendar, increment, smallestUnit as DateUnit, roundingMode));
    nudgeResult = record.NudgeResult;
  } else if (timeZone !== NoTimeZone) {
    Assert(isTimeUnit(smallestUnit));
    nudgeResult = Q(NudgeToZonedTime(sign, duration, isoDateTime, timeZone, calendar, increment, smallestUnit, roundingMode));
  } else {
    Assert(isTimeUnit(smallestUnit) || smallestUnit === 'day');
    nudgeResult = Q(NudgeToDayOrTime(duration, destEpochNanoseconds, largestUnit, increment, smallestUnit, roundingMode));
  }
  duration = nudgeResult.Duration;
  if (nudgeResult.DidExpandCalendarUnit && smallestUnit !== 'year' && smallestUnit !== 'week') {
    const startUnit = LargerOfTwoTemporalUnits(smallestUnit, 'day');
    Assert(startUnit === 'month' || startUnit === 'day');
    duration = Q(BubbleRelativeDuration(sign, duration, nudgeResult.NudgedEpochNanoseconds, isoDateTime, timeZone, calendar, largestUnit, startUnit));
  }
  return duration;
}

/** https://tc39.es/proposal-temporal/#sec-temporal-totalrelativeduration */
export function TotalRelativeDuration(
  duration: InternalDurationRecord,
  originEpochNanoseconds: EpochNanoseconds,
  destEpochNanoseconds: EpochNanoseconds,
  isoDateTime: ISODateTimeRecord,
  timeZone: TimeZoneIdentifier | NoTimeZone,
  calendar: KnownCalendarType,
  unit: TemporalUnit,
): PlainCompletion<MathematicalValue> {
  if (isCalendarUnit(unit) || (timeZone !== NoTimeZone && unit === 'day')) {
    let sign: -1n | 1n;
    if (InternalDurationSign(duration) < 0) sign = -1n;
    else sign = 1n;
    const record = Q(NudgeToCalendarUnit(sign, duration, originEpochNanoseconds, destEpochNanoseconds, isoDateTime, timeZone, calendar, 1n, unit, 'trunc'));
    return record.Total;
  }
  __ts_cast__<Exclude<TemporalUnit, 'day' | 'month' | 'week'>>(unit);
  const timeDuration = X(Add24HourDaysToTimeDuration(duration.Time, BigInt(duration.Date.Days)));
  return TotalTimeDuration(timeDuration, unit);
}

/** https://tc39.es/proposal-temporal/#sec-temporal-temporaldurationtostring */
export function TemporalDurationToString(
  duration: TemporalDurationObject,
  precision: Integer | 'auto',
): string {
  const sign = DurationSign(duration);
  let datePart = '';
  if (duration.Years !== 0n) {
    datePart += `${abs(duration.Years)}Y`;
  }
  if (duration.Months !== 0n) {
    datePart += `${abs(duration.Months)}M`;
  }
  if (duration.Weeks !== 0n) {
    datePart += `${abs(duration.Weeks)}W`;
  }
  if (duration.Days !== 0n) {
    datePart += `${abs(duration.Days)}D`;
  }
  let timePart = '';
  if (duration.Hours !== 0n) {
    timePart += `${abs(duration.Hours)}H`;
  }
  if (duration.Minutes !== 0n) {
    timePart += `${abs(duration.Minutes)}M`;
  }
  let zeroMinutesAndHigher = false;
  if (['second', 'millisecond', 'microsecond', 'nanosecond'].includes(DefaultTemporalLargestUnit(duration))) {
    zeroMinutesAndHigher = true;
  }
  const secondsDuration = X(TimeDurationFromComponents(0n, 0n, duration.Seconds, duration.Milliseconds, duration.Microseconds, duration.Nanoseconds));
  if (secondsDuration !== 0n || zeroMinutesAndHigher || precision !== 'auto') {
    const subSecondsPart = FormatFractionalSeconds(abs(remainder(secondsDuration, NanosecondsPerSecond)), precision);
    timePart += `${abs(truncateDiv(secondsDuration, NanosecondsPerSecond)).toString() + subSecondsPart}S`;
  }
  const signPart = sign < 0 ? '-' : '';
  let result = `${signPart}P${datePart}`;
  if (timePart !== '') {
    result += `T${timePart}`;
  }
  return result;
}

/** https://tc39.es/proposal-temporal/#sec-temporal-adddurations */
export function* AddDurations(
  operation: 'add' | 'subtract',
  duration: TemporalDurationObject,
  _other: Value,
): ValueEvaluator<TemporalDurationObject> {
  let other = Q(yield* ToTemporalDuration(_other));
  if (operation === 'subtract') {
    other = CreateNegatedTemporalDuration(other);
  }
  const xLargestUnit = DefaultTemporalLargestUnit(duration);
  const yLargestUnit = DefaultTemporalLargestUnit(other);
  const largestUnit = LargerOfTwoTemporalUnits(xLargestUnit, yLargestUnit);
  if (isCalendarUnit(largestUnit)) {
    return Throw.RangeError('Invalid duration');
  }
  const xInternalDuration = ToInternalDurationRecordWith24HourDays(duration);
  const yInternalDuration = ToInternalDurationRecordWith24HourDays(other);
  const timeResult = Q(AddTimeDuration(xInternalDuration.Time, yInternalDuration.Time));
  const result = CombineDateAndTimeDuration(ZeroDateDuration(), timeResult);
  return Q(yield* TemporalDurationFromInternal(result, largestUnit));
}

/** https://tc39.es/proposal-temporal/#eqn-maxTimeDuration */
export const maxTimeDuration = 9007199254740991999999999n;
