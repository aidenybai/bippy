import { DateParser, ParseISODateTime } from '../../parser/TemporalParser.mts';
import {
  R, type Integer, type IntegralNumber, type MathematicalValue,
} from '../spec-types.mjs';
import { type ISODateRecord, type TemporalPlainDateObject, isTemporalPlainDateObject } from '../../intrinsics/Temporal/PlainDate.mts';
import { isTemporalPlainDateTimeObject } from '../../intrinsics/Temporal/PlainDateTime.mts';
import { type TemporalZonedDateTimeObject, isTemporalZonedDateTimeObject } from '../../intrinsics/Temporal/ZonedDateTime.mts';
import {
  floorDiv, modulo,
} from '../math.mts';
import { GetUTCEpochNanoseconds, ParseDateTimeUTCOffset } from '../date-objects.mts';
import {
  GetRoundingIncrementOption, GetRoundingModeOption, ToZeroPaddedDecimalString, type UnsignedRoundingMode, type TimeZoneIdentifier,
} from './addition.mts';
import type { RoundingMode } from './addition.mts';
import {
  CalendarISOToDate, CanonicalizeCalendar, GetTemporalCalendarIdentifierWithISODefault, PrepareCalendarFields, type CalendarFieldsRecord, type KnownCalendarType,
} from './calendar.mts';
import { ToTemporalTimeZoneIdentifier } from './time-zone.mts';
import {
  ToPrimitive, Throw, CreateISODateRecord, CreateTemporalDate, CreateTemporalZonedDateTime, InterpretISODateTimeOffset, InterpretTemporalDateTimeFields, NanosecondsPerDay, type ISODateTimeMatchBehaviour, type ISODateTimeOffsetBehaviour,
  Value, ObjectValue, JSStringValue, NumberValue, UndefinedValue, Q, Get, ToString, type PlainCompletion, type PlainEvaluator, Assert, type PropertyKeyValue, X,
  MillisecondsPerDay,
  Day,
  NanosecondsPerHour,
  NanosecondsPerMinute,
  NanosecondsPerSecond,
  NanosecondsPerMillisecond,
  NanosecondsPerMicrosecond,
} from '#self';

export type EpochNanoseconds = Integer & { /** @internal */ specName?: 'EpochNanoseconds' };
export type Float64RepresentableInteger = IntegralNumber;

/** https://tc39.es/proposal-temporal/#sec-isodatetoepochdays */
export function ISODateToEpochDays(year: Integer, month: Integer, date: Integer): Integer {
  const resolvedYear = year + floorDiv(month, 12n);
  const resolvedMonth = modulo(month, 12n);
  // Find an integer _epochMilliseconds_ such that YearFromTime(𝔽(_epochMilliseconds_)) = _resolvedYear_, MonthFromTime(𝔽(_epochMilliseconds_)) = _resolvedMonth_, and DateFromTime(𝔽(_epochMilliseconds_)) = 1.

  // epochMilliseconds = GetUTCEpochNanoseconds(resolvedYear, resolvedMonth + 1, date) / 1e6 - (date - 1) * MillisecondsPerDay
  const epochMilliseconds = (
    GetUTCEpochNanoseconds({
      ISODate: { Year: resolvedYear, Month: resolvedMonth + 1n, Day: date },
      Time: {
        Days: 0n, Hour: 0n, Microsecond: 0n, Millisecond: 0n, Minute: 0n, Nanosecond: 0n, Second: 0n,
      },
    }) / NanosecondsPerMillisecond
    - (date - 1n) * MillisecondsPerDay
  );

  return Day(Number(epochMilliseconds)) + date - 1n;
}

/** https://tc39.es/proposal-temporal/#sec-epochdaystoepochmilliseconds */
export function EpochDaysToEpochMilliseconds(day: Integer, time: Integer): Integer {
  return day * MillisecondsPerDay + time;
}

/** https://tc39.es/proposal-temporal/#sec-validateisodaysrange */
export function ValidateISODaysRange(isoDate: ISODateRecord): PlainCompletion<void> {
  const days = ISODateToEpochDays(isoDate.Year, isoDate.Month - 1n, isoDate.Day);
  if (days > 1e8 || days < -1e8) {
    return Throw.RangeError('ISODate is out of range');
  }
  return undefined;
}

/** https://tc39.es/proposal-temporal/#sec-temporal-units */
export type TemporalUnit = 'year' | 'month' | 'week' | 'day' | 'hour' | 'minute' | 'second' | 'millisecond' | 'microsecond' | 'nanosecond';

/** https://tc39.es/proposal-temporal/#table-temporal-units */
export type TimeUnit = 'hour' | 'minute' | 'second' | 'millisecond' | 'microsecond' | 'nanosecond';

export function isTimeUnit(unit: TemporalUnit | 'auto'): unit is TimeUnit {
  switch (unit) {
    case 'hour':
    case 'minute':
    case 'second':
    case 'millisecond':
    case 'microsecond':
    case 'nanosecond':
      return true;
    default:
      return false;
  }
}

/** https://tc39.es/proposal-temporal/#table-temporal-units */
export type DateUnit = 'year' | 'month' | 'week' | 'day';

export function isDateUnit(unit: TemporalUnit | 'auto'): unit is DateUnit {
  switch (unit) {
    case 'year':
    case 'month':
    case 'week':
    case 'day':
      return true;
    default:
      return false;
  }
}

/** https://tc39.es/proposal-temporal/#sec-temporalunitlength */
// note: spec return a MathmeticalValue
export function TemporalUnitLength(unit: TimeUnit | 'day'): Integer {
  if (unit === 'day') return NanosecondsPerDay;
  if (unit === 'hour') return NanosecondsPerHour;
  if (unit === 'minute') return NanosecondsPerMinute;
  if (unit === 'second') return NanosecondsPerSecond;
  if (unit === 'millisecond') return NanosecondsPerMillisecond;
  if (unit === 'microsecond') return NanosecondsPerMicrosecond;
  Assert(unit === 'nanosecond');
  return 1n;
}

/** https://tc39.es/proposal-temporal/#sec-gettemporaloverflowoption */
export function* GetTemporalOverflowOption(options: ObjectValue): PlainEvaluator<'constrain' | 'reject'> {
  const value = Q(yield* Get(options, 'overflow'));
  if (value instanceof UndefinedValue) return 'constrain';
  const stringValue = Q(yield* ToString(value));
  if (stringValue !== 'constrain' && stringValue !== 'reject') {
    return Throw.RangeError('overflow option is invalid ($1), only "constrain" and "reject" are accepted', stringValue);
  }
  return stringValue as 'constrain' | 'reject';
}

/** https://tc39.es/proposal-temporal/#sec-gettemporaldisambiguationoption */
export function* GetTemporalDisambiguationOption(options: ObjectValue): PlainEvaluator<'compatible' | 'earlier' | 'later' | 'reject'> {
  const value = Q(yield* Get(options, 'disambiguation'));
  if (value instanceof UndefinedValue) return 'compatible';
  const stringValue = Q(yield* ToString(value));
  const acceptedValues = ['compatible', 'earlier', 'later', 'reject'] as const;
  if (!(acceptedValues as readonly string[]).includes(stringValue)) {
    return Throw.RangeError('disambiguation option is invalid ($1), only "compatible", "earlier", "later" and "reject" are accepted', stringValue);
  }
  return stringValue as typeof acceptedValues[number];
}

/** https://tc39.es/proposal-temporal/#sec-negateroundingmode */
export function NegateRoundingMode(roundingMode: RoundingMode): RoundingMode {
  switch (roundingMode) {
    case 'ceil': return 'floor';
    case 'floor': return 'ceil';
    case 'halfCeil': return 'halfFloor';
    case 'halfFloor': return 'halfCeil';
    default: return roundingMode;
  }
}

export type TemporalOffsetOption = 'prefer' | 'use' | 'ignore' | 'reject';
/** https://tc39.es/proposal-temporal/#sec-gettemporaloffsetoption */
export function* GetTemporalOffsetOption(options: ObjectValue, fallback: TemporalOffsetOption): PlainEvaluator<TemporalOffsetOption> {
  const value = Q(yield* Get(options, 'offset'));
  if (value instanceof UndefinedValue) return fallback;
  const stringValue = Q(yield* ToString(value));
  const acceptedValues = ['prefer', 'use', 'ignore', 'reject'] as const;
  if (!(acceptedValues as readonly string[]).includes(stringValue)) {
    return Throw.RangeError('offset option is invalid ($1), only "prefer", "use", "ignore" and "reject" are accepted', stringValue);
  }
  return stringValue as TemporalOffsetOption;
}

export type ShowCalendarNameOption = 'auto' | 'always' | 'never' | 'critical';
/** https://tc39.es/proposal-temporal/#sec-gettemporalshowcalendarnameoption */
export function* GetTemporalShowCalendarNameOption(options: ObjectValue): PlainEvaluator<ShowCalendarNameOption> {
  const value = Q(yield* Get(options, 'calendarName'));
  if (value instanceof UndefinedValue) return 'auto';
  const stringValue = Q(yield* ToString(value));
  const acceptedValues = ['auto', 'always', 'never', 'critical'] as const;
  if (!(acceptedValues as readonly string[]).includes(stringValue)) {
    return Throw.RangeError('calendarName option is invalid ($1), only "auto", "always", "never" and "critical" are accepted', stringValue);
  }
  return stringValue as ShowCalendarNameOption;
}

export type ShowTimeZoneNameOption = 'auto' | 'never' | 'critical';
/** https://tc39.es/proposal-temporal/#sec-gettemporalshowtimezonenameoption */
export function* GetTemporalShowTimeZoneNameOption(options: ObjectValue): PlainEvaluator<ShowTimeZoneNameOption> {
  const value = Q(yield* Get(options, 'timeZoneName'));
  if (value instanceof UndefinedValue) return 'auto';
  const stringValue = Q(yield* ToString(value));
  const acceptedValues = ['auto', 'never', 'critical'] as const;
  if (!(acceptedValues as readonly string[]).includes(stringValue)) {
    return Throw.RangeError('timeZoneName option is invalid ($1), only "auto", "never" and "critical" are accepted', stringValue);
  }
  return stringValue as ShowTimeZoneNameOption;
}

/** https://tc39.es/proposal-temporal/#sec-gettemporalshowoffsetoption */
export function* GetTemporalShowOffsetOption(options: ObjectValue): PlainEvaluator<'auto' | 'never'> {
  const value = Q(yield* Get(options, 'offset'));
  if (value instanceof UndefinedValue) return 'auto';
  const stringValue = Q(yield* ToString(value));
  if (stringValue !== 'never' && stringValue !== 'auto') return Throw.RangeError('offset option is invalid ($1), only "auto" and "never" are accepted', stringValue);
  return stringValue as 'auto' | 'never';
}

export type DirectionOption = 'next' | 'previous';
/** https://tc39.es/proposal-temporal/#sec-getdirectionoption */
export function* GetDirectionOption(options: ObjectValue): PlainEvaluator<DirectionOption> {
  const value = Q(yield* Get(options, 'direction'));
  if (value instanceof UndefinedValue) return Throw.RangeError('direction option is required');
  const stringValue = Q(yield* ToString(value));
  if (stringValue !== 'next' && stringValue !== 'previous') return Throw.RangeError('direction option is not valid ($1), only "next" and "previous" are accepted', stringValue);
  return stringValue;
}

/** https://tc39.es/proposal-temporal/#sec-validatetemporalroundingincrement */
export function ValidateTemporalRoundingIncrement(increment: Integer, dividend: Integer, inclusive: boolean): PlainCompletion<void> {
  let maximum;
  if (inclusive) {
    maximum = dividend;
  } else {
    Assert(dividend > 1n);
    maximum = dividend - 1n;
  }
  if (increment > maximum) {
    return Throw.RangeError('$1 is out of range', increment);
  }
  if (modulo(dividend, increment) !== 0n) {
    return Throw.RangeError('$1 is out of range', increment);
  }
  return undefined;
}

/** https://tc39.es/proposal-temporal/#sec-gettemporalfractionalseconddigitsoption */
export function* GetTemporalFractionalSecondDigitsOption(options: ObjectValue): PlainEvaluator<'auto' | Integer> {
  const digitsValue = Q(yield* Get(options, 'fractionalSecondDigits'));
  if (digitsValue instanceof UndefinedValue) {
    return 'auto';
  }
  if (!(digitsValue instanceof NumberValue)) {
    if (Q(yield* ToString(digitsValue)) !== 'auto') {
      return Throw.RangeError('$1 is out of range', digitsValue);
    }
    return 'auto';
  }
  if (!digitsValue.isFinite()) {
    return Throw.RangeError('$1 is out of range', digitsValue);
  }
  const digitCount = BigInt(Math.floor(R(digitsValue)));
  if (digitCount < 0n || digitCount > 9n) {
    return Throw.RangeError('$1 is out of range', digitsValue);
  }
  return digitCount;
}

/** https://tc39.es/proposal-temporal/#sec-tosecondsstringprecisionrecord */
export function ToSecondsStringPrecisionRecord(smallestUnit: Exclude<TimeUnit, 'hour'> | 'no-unit', fractionalDigitCount: 'auto' | Integer):
  | { Precision: 'minute', Unit: 'minute', Increment: 1n }
  | { Precision: Integer, Unit: 'minute' | 'second' | 'millisecond' | 'microsecond' | 'nanosecond', Increment: bigint }
  | { Precision: 'auto' | Integer, Unit: 'nanosecond', Increment: 1n | 10n | 100n } {
  if (smallestUnit === 'minute') {
    return { Precision: 'minute', Unit: 'minute', Increment: 1n };
  }
  if (smallestUnit === 'second') {
    return { Precision: 0n, Unit: 'second', Increment: 1n };
  }
  if (smallestUnit === 'millisecond') {
    return { Precision: 3n, Unit: 'millisecond', Increment: 1n };
  }
  if (smallestUnit === 'microsecond') {
    return { Precision: 6n, Unit: 'microsecond', Increment: 1n };
  }
  if (smallestUnit === 'nanosecond') {
    return { Precision: 9n, Unit: 'nanosecond', Increment: 1n };
  }
  Assert(smallestUnit === 'no-unit');
  if (fractionalDigitCount === 'auto') {
    return { Precision: 'auto', Unit: 'nanosecond', Increment: 1n };
  }
  if (fractionalDigitCount === 0n) {
    return { Precision: 0n, Unit: 'second', Increment: 1n };
  }
  if (fractionalDigitCount >= 1n && fractionalDigitCount <= 3n) {
    return { Precision: fractionalDigitCount, Unit: 'millisecond', Increment: 10n ** (3n - fractionalDigitCount) as 1n | 10n | 100n };
  }
  if (fractionalDigitCount >= 4n && fractionalDigitCount <= 6n) {
    return { Precision: fractionalDigitCount, Unit: 'microsecond', Increment: 10n ** (6n - fractionalDigitCount) as 1n | 10n | 100n };
  }
  Assert(fractionalDigitCount >= 7n && fractionalDigitCount <= 9n);
  return { Precision: fractionalDigitCount, Unit: 'nanosecond', Increment: 10n ** (9n - fractionalDigitCount) as 1n | 10n | 100n };
}

/** https://tc39.es/proposal-temporal/#sec-gettemporalunitvaluedoption */
export function* GetTemporalUnitValuedOption(
  options: ObjectValue,
  key: PropertyKeyValue | string,
  defaultV: 'required' | 'optional',
): PlainEvaluator<TemporalUnit | 'no-unit' | 'auto'> {
  const value = Q(yield* Get(options, typeof key === 'string' ? Value(key) : key));
  if (value instanceof UndefinedValue) {
    if (defaultV === 'required') return Throw.RangeError('option $1 is required', key);
    return 'no-unit';
  }
  const stringValue = Q(yield* ToString(value));
  switch (stringValue) {
    case 'auto': return 'auto';
    case 'year':
    case 'years':
      return 'year';
    case 'month':
    case 'months':
      return 'month';
    case 'week':
    case 'weeks':
      return 'week';
    case 'day':
    case 'days':
      return 'day';
    case 'hour':
    case 'hours':
      return 'hour';
    case 'minute':
    case 'minutes':
      return 'minute';
    case 'second':
    case 'seconds':
      return 'second';
    case 'millisecond':
    case 'milliseconds':
      return 'millisecond';
    case 'microsecond':
    case 'microseconds':
      return 'microsecond';
    case 'nanosecond':
    case 'nanoseconds':
      return 'nanosecond';
    default:
      return Throw.RangeError('Invalid temporal unit value $1', stringValue);
  }
}

/** https://tc39.es/proposal-temporal/#sec-temporal-validatetemporalunitvaluedoption */
export function ValidateTemporalUnitValue(value: TemporalUnit | 'no-unit' | 'auto', unitGroup: 'date' | 'time' | 'datetime', extraValues?: Array<TemporalUnit | 'auto'>): PlainCompletion<void> {
  if (value === 'no-unit') return undefined;
  if (extraValues?.includes(value)) return undefined;
  if (isDateUnit(value) && (unitGroup === 'datetime' || unitGroup === 'date')) return undefined;
  if (isTimeUnit(value) && (unitGroup === 'datetime' || unitGroup === 'time')) return undefined;
  return Throw.RangeError('Invalid TemporalUnit value $1', value);
}

/** https://tc39.es/proposal-temporal/#sec-gettemporalrelativetooption */
export function* GetTemporalRelativeToOption(options: ObjectValue): PlainEvaluator<{
  PlainRelativeTo?: TemporalPlainDateObject,
  ZonedRelativeTo?: TemporalZonedDateTimeObject,
}> {
  const value = Q(yield* Get(options, 'relativeTo'));
  if (value instanceof UndefinedValue) {
    return { PlainRelativeTo: undefined, ZonedRelativeTo: undefined };
  }
  let offsetBehaviour: ISODateTimeOffsetBehaviour = 'option';
  let matchBehaviour: ISODateTimeMatchBehaviour = 'match-exactly';
  let timeZone: TimeZoneIdentifier | undefined;
  let isoDate;
  let time;
  let calendar: KnownCalendarType | undefined;
  let offsetString;
  if (value instanceof ObjectValue) {
    if (isTemporalZonedDateTimeObject(value)) {
      return { PlainRelativeTo: undefined, ZonedRelativeTo: value };
    }
    if (isTemporalPlainDateObject(value)) {
      return { PlainRelativeTo: value, ZonedRelativeTo: undefined };
    }
    if (isTemporalPlainDateTimeObject(value)) {
      const plainDate = X(CreateTemporalDate(value.ISODateTime.ISODate, value.Calendar));
      return { PlainRelativeTo: plainDate, ZonedRelativeTo: undefined };
    }
    calendar = Q(yield* GetTemporalCalendarIdentifierWithISODefault(value));
    const fields = Q(yield* PrepareCalendarFields(calendar, value, 'date-fields', 'time-fields-with-time-zone-and-offset', 'no-required-fields'));
    const result = Q(yield* InterpretTemporalDateTimeFields(calendar, fields, 'constrain'));
    timeZone = fields.TimeZone as TimeZoneIdentifier;
    offsetString = fields.OffsetString;
    if (offsetString === undefined) {
      offsetBehaviour = 'wall';
    }
    isoDate = result.ISODate;
    time = result.Time;
  } else {
    if (!(value instanceof JSStringValue)) {
      return Throw.TypeError('$1 is not a string', value);
    }
    const result = Q(ParseISODateTime(value.stringValue(), 'any-date-time'));
    offsetString = result.TimeZone.OffsetString;
    const annotation = result.TimeZone.TimeZoneAnnotation;
    if (!annotation) {
      timeZone = undefined;
    } else {
      timeZone = Q(ToTemporalTimeZoneIdentifier(annotation));
      if (result.TimeZone.Z === true) {
        offsetBehaviour = 'exact';
      } else if (!offsetString) {
        offsetBehaviour = 'wall';
      }
      matchBehaviour = 'match-minutes';
      if (offsetString) {
        const offsetParseResult = DateParser.parse(offsetString, (parser) => parser.with({ SubMinutePrecision: true }, () => parser.parseUTCOffset()));
        if (Array.isArray(offsetParseResult)) {
          Assert(false, 'offsetParseResult is a Parse Node');
        }
        if (offsetParseResult.Second !== undefined) {
          matchBehaviour = 'match-exactly';
        }
      }
    }
    let _calendar = result.Calendar;
    if (!_calendar) {
      _calendar = 'iso8601';
    }
    calendar = Q(CanonicalizeCalendar(_calendar));
    isoDate = X(CreateISODateRecord(result.Year!, result.Month, result.Day));
    time = result.Time;
  }
  if (timeZone === undefined) {
    const plainDate = Q(yield* CreateTemporalDate(isoDate, calendar));
    return { PlainRelativeTo: plainDate, ZonedRelativeTo: undefined };
  }
  let offsetNanoseconds;
  if (offsetBehaviour === 'option') {
    Assert(typeof offsetString === 'string');
    offsetNanoseconds = X(ParseDateTimeUTCOffset(offsetString));
  } else {
    offsetNanoseconds = 0n;
  }
  const epochNanoseconds = Q(InterpretISODateTimeOffset(isoDate, time, offsetBehaviour, offsetNanoseconds, timeZone, 'compatible', 'reject', matchBehaviour));
  const zonedRelativeTo = X(CreateTemporalZonedDateTime(epochNanoseconds, timeZone, calendar));
  return { PlainRelativeTo: undefined, ZonedRelativeTo: zonedRelativeTo };
}

/** https://tc39.es/proposal-temporal/#sec-largeroftwotemporalunits */
export function LargerOfTwoTemporalUnits(xUnit: TemporalUnit, yUnit: TemporalUnit): TemporalUnit {
  if (xUnit === 'year' || yUnit === 'year') return 'year';
  if (xUnit === 'month' || yUnit === 'month') return 'month';
  if (xUnit === 'week' || yUnit === 'week') return 'week';
  if (xUnit === 'day' || yUnit === 'day') return 'day';
  if (xUnit === 'hour' || yUnit === 'hour') return 'hour';
  if (xUnit === 'minute' || yUnit === 'minute') return 'minute';
  if (xUnit === 'second' || yUnit === 'second') return 'second';
  if (xUnit === 'millisecond' || yUnit === 'millisecond') return 'millisecond';
  if (xUnit === 'microsecond' || yUnit === 'microsecond') return 'microsecond';
  return 'nanosecond';
}

export function isCalendarUnit(unit: TemporalUnit): unit is 'year' | 'month' | 'week' {
  return unit === 'year' || unit === 'month' || unit === 'week';
}

/** https://tc39.es/proposal-temporal/#sec-maximumtemporaldurationroundingincrement */
export function MaximumTemporalDurationRoundingIncrement(unit: TemporalUnit): 24n | 60n | 1000n | 'no-maximum' {
  switch (unit) {
    case 'hour': return 24n;
    case 'minute':
    case 'second':
      return 60n;
    case 'millisecond':
    case 'microsecond':
    case 'nanosecond':
      return 1000n;
    default:
      return 'no-maximum';
  }
}

/** https://tc39.es/proposal-temporal/#sec-ispartialtemporalobject */
export function* IsPartialTemporalObject(value: Value): PlainEvaluator<boolean> {
  if (!(value instanceof ObjectValue)) {
    return false;
  }
  if (
    'InitializedTemporalDate' in value
    || 'InitializedTemporalDateTime' in value
    || 'InitializedTemporalMonthDay' in value
    || 'InitializedTemporalTime' in value
    || 'InitializedTemporalYearMonth' in value
    || 'InitializedTemporalZonedDateTime' in value
  ) {
    return false;
  }
  const calendarProperty = Q(yield* Get(value, 'calendar'));
  if (!(calendarProperty instanceof UndefinedValue)) {
    return false;
  }
  const timeZoneProperty = Q(yield* Get(value, 'timeZone'));
  if (!(timeZoneProperty instanceof UndefinedValue)) {
    return false;
  }
  return true;
}

/** https://tc39.es/proposal-temporal/#sec-formatfractionalseconds */
export function FormatFractionalSeconds(subSecondNanoseconds: Integer, precision: Integer | 'auto'): string {
  if (precision === 'auto') {
    if (subSecondNanoseconds === 0n) {
      return '';
    }
    let fractionString = ToZeroPaddedDecimalString(subSecondNanoseconds, 9n);
    // Set fractionString to the longest prefix of fractionString ending with a code unit other than 0x0030 (DIGIT ZERO).
    fractionString = fractionString.replace(/0+$/, '');
    return `.${fractionString}`;
  } else {
    if (precision === 0n) {
      return '';
    }
    let fractionString = ToZeroPaddedDecimalString(subSecondNanoseconds, 9n);
    fractionString = fractionString.slice(0, Number(precision));
    return `.${fractionString}`;
  }
}

/** https://tc39.es/proposal-temporal/#sec-formattimestring */
export function FormatTimeString(
  hour: Integer,
  minute: Integer,
  second: Integer,
  subSecondNanoseconds: Integer,
  precision: Integer | 'minute' | 'auto',
  style?: 'separated' | 'unseparated',
): string {
  const separator = style === 'unseparated' ? '' : ':';
  const hh = ToZeroPaddedDecimalString(hour, 2n);
  const mm = ToZeroPaddedDecimalString(minute, 2n);
  if (precision === 'minute') {
    return hh + separator + mm;
  }
  const ss = ToZeroPaddedDecimalString(second, 2n);
  const subSecondsPart = FormatFractionalSeconds(subSecondNanoseconds, precision);
  return hh + separator + mm + separator + ss + subSecondsPart;
}

/** https://tc39.es/proposal-temporal/#sec-getunsignedroundingmode */
export function GetUnsignedRoundingMode(
  roundingMode: RoundingMode,
  sign: 'negative' | 'positive',
): UnsignedRoundingMode {
  if (roundingMode === 'ceil') {
    if (sign === 'positive') return 'infinity';
    return 'zero';
  }
  if (roundingMode === 'floor') {
    if (sign === 'positive') return 'zero';
    return 'infinity';
  }
  if (roundingMode === 'expand') return 'infinity';
  if (roundingMode === 'trunc') return 'zero';
  if (roundingMode === 'halfCeil') {
    if (sign === 'positive') return 'half-infinity';
    return 'half-zero';
  }
  if (roundingMode === 'halfFloor') {
    if (sign === 'positive') return 'half-zero';
    return 'half-infinity';
  }
  if (roundingMode === 'halfExpand') return 'half-infinity';
  if (roundingMode === 'halfTrunc') return 'half-zero';
  Assert(roundingMode === 'halfEven');
  return 'half-even';
}

/** https://tc39.es/proposal-temporal/#sec-applyunsignedroundingmode */
export function ApplyUnsignedRoundingMode(
  quantity: MathematicalValue,
  lowerBound: MathematicalValue,
  upperBound: MathematicalValue,
  unsignedRoundingMode: UnsignedRoundingMode,
): MathematicalValue {
  if (quantity.equals(lowerBound)) return lowerBound;
  Assert(lowerBound.lessThan(quantity) && quantity.lessThan(upperBound));
  if (unsignedRoundingMode === 'zero') return lowerBound;
  if (unsignedRoundingMode === 'infinity') return upperBound;
  const distanceToLower = quantity.subtract(lowerBound);
  const distanceToUpper = upperBound.subtract(quantity);
  if (distanceToLower.lessThan(distanceToUpper)) return lowerBound;
  if (distanceToUpper.lessThan(distanceToLower)) return upperBound;
  Assert(distanceToLower.equals(distanceToUpper));
  if (unsignedRoundingMode === 'half-zero') return lowerBound;
  if (unsignedRoundingMode === 'half-infinity') return upperBound;
  Assert(unsignedRoundingMode === 'half-even');
  const cardinality = lowerBound.divide(upperBound.subtract(lowerBound)).modulo(2);
  if (cardinality.equals(0)) return lowerBound;
  return upperBound;
}

/** https://tc39.es/proposal-temporal/#sec-roundnumbertoincrement */
export function RoundNumberToIncrement(
  quantity: MathematicalValue,
  increment: Integer,
  roundingMode: RoundingMode,
): Integer {
  let quotient = quantity.divide(increment);
  let sign: 'negative' | 'positive' = 'positive';
  if (quotient.lessThan(0)) {
    sign = 'negative';
    quotient = quotient.negate();
  }
  const unsignedRoundingMode = GetUnsignedRoundingMode(roundingMode, sign);
  const lowerBound = quotient.floor();
  const upperBound = quotient.ceil();
  let rounded = ApplyUnsignedRoundingMode(quotient, lowerBound, upperBound, unsignedRoundingMode);
  if (sign === 'negative') rounded = rounded.negate();
  return rounded.multiply(increment).toBigInt();
}

/** https://tc39.es/proposal-temporal/#sec-roundnumbertoincrementasifpositive */
export function RoundNumberToIncrementAsIfPositive(
  quantity: MathematicalValue,
  increment: Integer,
  roundingMode: RoundingMode,
): Integer {
  const quotient = quantity.divide(increment);
  const unsignedRoundingMode = GetUnsignedRoundingMode(roundingMode, 'positive');
  const lowerBound = quotient.floor();
  const upperBound = quotient.ceil();
  const rounded = ApplyUnsignedRoundingMode(quotient, lowerBound, upperBound, unsignedRoundingMode);
  return rounded.multiply(increment).toBigInt();
}

/** https://tc39.es/proposal-temporal/#sec-temporal-tooffsetstring */
export function* ToOffsetString(argument: Value): PlainEvaluator<string> {
  const offset = Q(yield* ToPrimitive(argument, 'string'));
  if (!(offset instanceof JSStringValue)) {
    return Throw.TypeError('$1 is not a string', offset);
  }
  Q(ParseDateTimeUTCOffset(offset.stringValue()));
  return offset.stringValue();
}

/** https://tc39.es/proposal-temporal/#sec-temporal-isodatetofields */
export function ISODateToFields(
  calendar: KnownCalendarType,
  isoDate: ISODateRecord,
  type: 'date' | 'year-month' | 'month-day',
): CalendarFieldsRecord {
  const fields: CalendarFieldsRecord = {
    Day: undefined,
    Era: undefined,
    EraYear: undefined,
    Hour: undefined,
    Microsecond: undefined,
    Millisecond: undefined,
    Minute: undefined,
    Month: undefined,
    MonthCode: undefined,
    Nanosecond: undefined,
    OffsetString: undefined,
    Second: undefined,
    TimeZone: undefined,
    Year: undefined,
  };
  const calendarDate = CalendarISOToDate(calendar, isoDate);
  fields.MonthCode = calendarDate.MonthCode;
  if (type === 'month-day' || type === 'date') {
    fields.Day = calendarDate.Day;
  }
  if (type === 'year-month' || type === 'date') {
    fields.Year = calendarDate.Year;
  }
  return fields;
}

/** https://tc39.es/proposal-temporal/#sec-temporal-getdifferencesettings */
export function* GetDifferenceSettings(
  operation: 'since' | 'until',
  options: ObjectValue,
  unitGroup: 'date' | 'time' | 'datetime',
  disallowedUnits: readonly TemporalUnit[],
  fallbackSmallestUnit: TemporalUnit,
  smallestLargestDefaultUnit: TemporalUnit,
): PlainEvaluator<{
  SmallestUnit: TemporalUnit,
  LargestUnit: TemporalUnit,
  RoundingMode: RoundingMode,
  RoundingIncrement: bigint,
}> {
  let largestUnit = Q(yield* GetTemporalUnitValuedOption(options, 'largestUnit', 'optional'));
  const roundingIncrement = Q(yield* GetRoundingIncrementOption(options));
  let roundingMode = Q(yield* GetRoundingModeOption(options, 'trunc'));
  let smallestUnit = Q(yield* GetTemporalUnitValuedOption(options, 'smallestUnit', 'optional'));
  Q(ValidateTemporalUnitValue(largestUnit, unitGroup, ['auto']));
  if (largestUnit === 'no-unit') {
    largestUnit = 'auto';
  }
  if (disallowedUnits.includes(largestUnit as TemporalUnit)) {
    return Throw.RangeError('$1 is out of range', largestUnit);
  }
  Q(ValidateTemporalUnitValue(smallestUnit, unitGroup));
  if (smallestUnit === 'no-unit') {
    smallestUnit = fallbackSmallestUnit;
  }
  if (disallowedUnits.includes(smallestUnit as TemporalUnit)) {
    return Throw.RangeError('$1 is out of range', smallestUnit);
  }
  const defaultLargestUnit = LargerOfTwoTemporalUnits(smallestLargestDefaultUnit, smallestUnit as TemporalUnit);
  if (largestUnit === 'auto') {
    largestUnit = defaultLargestUnit;
  }
  if (LargerOfTwoTemporalUnits(largestUnit, smallestUnit as TemporalUnit) !== largestUnit) {
    return Throw.RangeError('$1 is out of range', largestUnit);
  }
  const maximum = MaximumTemporalDurationRoundingIncrement(smallestUnit as TemporalUnit);
  if (maximum !== 'no-maximum') {
    Q(ValidateTemporalRoundingIncrement(roundingIncrement, maximum, false));
  }
  if (operation === 'since') {
    roundingMode = NegateRoundingMode(roundingMode);
  }
  return {
    SmallestUnit: smallestUnit as TemporalUnit,
    LargestUnit: largestUnit,
    RoundingMode: roundingMode,
    RoundingIncrement: roundingIncrement,
  };
}
