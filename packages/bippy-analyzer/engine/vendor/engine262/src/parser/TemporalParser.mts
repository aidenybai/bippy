// https://tc39.es/proposal-temporal/#sec-temporal-iso8601grammar

import type { TemporalDurationObject } from '../intrinsics/Temporal/Duration.mts';
import { OutOfRange } from '../utils/language.mts';
import { Decimal } from '../host-defined/decimal.mts';
import { SnapToInteger } from '../abstract-ops/type-conversion.mts';
import {
  Assert,
  CreateTemporalDuration,
  CreateTimeRecord,
  EnsureCompletion,
  InLeapYear,
  IsValidISODate,
  JSStringValue,
  TimeFromYear,
  NormalCompletion,
  ObjectValue,
  Q,
  Throw,
  ThrowCompletion,
  ToPrimitive,
  Value,
  X,
  type Formattable,
  type Integer,
  type FiniteTimeValue,
  type MathematicalValue,
  type Mutable,
  type PlainCompletion, type PlainEvaluator, type TimeRecord,
  type ValueEvaluator,
  ParseDateTimeUTCOffset,
} from '#self';

/** https://tc39.es/proposal-temporal/#sec-temporal-iso-string-time-zone-parse-records */
export interface ISOStringTimeZoneParseRecord {
  readonly Z: boolean;
  readonly OffsetString: string | undefined;
  readonly TimeZoneAnnotation: string | undefined;
}

/** https://tc39.es/proposal-temporal/#sec-temporal-iso-date-time-parse-records */
export interface ISODateTimeParseRecord {
  readonly Year: bigint | undefined;
  readonly Month: bigint;
  readonly Day: bigint;
  readonly Time: TimeRecord | 'start-of-day';
  readonly TimeZone: ISOStringTimeZoneParseRecord;
  readonly Calendar: string | undefined;
}

/** https://tc39.es/proposal-temporal/#sec-temporal-parseisodatetime */
type ISODateTimeParseGoal = 'TemporalInstantString' | 'TemporalDateTimeString[~Zoned]' | 'TemporalTimeString' | 'TemporalMonthDayString' | 'TemporalYearMonthString' | 'TemporalDateTimeString[+Zoned]' | 'DateTimeString';
export type ISODateTimeParseFormat = 'all' | 'any-date-time' | 'zoned-date-time' | 'plain-date-time' | 'instant' | 'time' | 'year-month' | 'month-day' | 'non-spec-date';

export function ParseISODateTime(isoString: string, allowedFormats: ISODateTimeParseFormat): PlainCompletion<ISODateTimeParseRecord> {
  let parseResult: undefined | RFC9557ParseNode.AnnotatedDateTime | RFC9557ParseNode.TemporalTimeString | RFC9557ParseNode.TemporalInstantString | RFC9557ParseNode.TemporalMonthDayString | RFC9557ParseNode.TemporalYearMonthString | RFC9557ParseNode.DateTime;
  let calendar: string | undefined;
  let yearAbsent = false;

  let year = 0n;
  let month: bigint | undefined;
  let day: bigint | undefined;
  let hour: bigint | undefined;
  let minute: bigint | undefined;
  let second: bigint | undefined;
  let fSeconds: RFC9557ParseNode.TemporalDecimalFraction | undefined;
  let timeZoneIdentifier: RFC9557ParseNode.TimeZoneIdentifier | undefined;
  let UTCDesignator: RFC9557ParseNode.DateTimeUTCOffset['UTCDesignator'] | undefined;
  let UTCOffset: RFC9557ParseNode.UTCOffset | undefined;
  const assignTimeSpec = (timeSpec: RFC9557ParseNode.TimeSpec) => {
    hour = timeSpec.Hour;
    minute = timeSpec.Minute ? timeSpec.Minute : undefined;
    second = timeSpec.Second ? timeSpec.Second : undefined;
    fSeconds = timeSpec.TemporalDecimalFraction;
  };
  const assignDateSpec = (dateSpec: RFC9557ParseNode.DateSpec) => {
    year = dateSpec.Year;
    month = dateSpec.Month;
    day = dateSpec.Day;
  };
  const assignTimeZone = (TimeZoneAnnotation?: RFC9557ParseNode.TimeZoneAnnotation, DateTimeUTCOffset?: RFC9557ParseNode.DateTimeUTCOffset) => {
    timeZoneIdentifier = TimeZoneAnnotation?.TimeZoneIdentifier;
    UTCDesignator = DateTimeUTCOffset?.UTCDesignator;
    UTCOffset = DateTimeUTCOffset?.UTCOffset;
  };
  let lastError: ObjectValue | undefined;
  let goalSymbols: readonly ISODateTimeParseGoal[];
  switch (allowedFormats) {
    case 'all':
      goalSymbols = ['TemporalDateTimeString[+Zoned]', 'TemporalDateTimeString[~Zoned]', 'TemporalInstantString', 'TemporalTimeString', 'TemporalMonthDayString', 'TemporalYearMonthString'];
      break;
    case 'any-date-time':
      goalSymbols = ['TemporalDateTimeString[+Zoned]', 'TemporalDateTimeString[~Zoned]'];
      break;
    case 'zoned-date-time':
      goalSymbols = ['TemporalDateTimeString[+Zoned]'];
      break;
    case 'plain-date-time':
      goalSymbols = ['TemporalDateTimeString[~Zoned]'];
      break;
    case 'instant':
      goalSymbols = ['TemporalInstantString'];
      break;
    case 'time':
      goalSymbols = ['TemporalTimeString'];
      break;
    case 'year-month':
      goalSymbols = ['TemporalYearMonthString'];
      break;
    case 'month-day':
      goalSymbols = ['TemporalMonthDayString'];
      break;
    case 'non-spec-date':
      goalSymbols = ['DateTimeString', 'TemporalInstantString', 'TemporalDateTimeString[~Zoned]', 'TemporalDateTimeString[+Zoned]'];
      break;
    default:
      throw OutOfRange.exhaustive(allowedFormats);
  }
  for (const goal of goalSymbols) {
    if (!parseResult) {
      const result = DateParser.parse(
        isoString,
        (parser) => {
          switch (goal) {
            case 'TemporalDateTimeString[+Zoned]':
            case 'TemporalDateTimeString[~Zoned]': {
              const node = parser.with({ Zoned: goal === 'TemporalDateTimeString[+Zoned]' }, () => parser.parseTemporalDateTimeString());
              assignTimeZone(node.TimeZoneAnnotation, node.DateTime.DateTimeUTCOffset);
              assignDateSpec(node.DateTime.Date);
              if (node.DateTime.Time) assignTimeSpec(node.DateTime.Time);
              return node;
            }
            case 'TemporalTimeString': {
              const node = parser.parseTemporalTimeString();
              if (node.AnnotatedDateTime) {
                assignTimeZone(node.AnnotatedDateTime.TimeZoneAnnotation, node.AnnotatedDateTime.DateTime.DateTimeUTCOffset);
                assignDateSpec(node.AnnotatedDateTime.DateTime.Date);
                if (node.AnnotatedDateTime.DateTime.Time) assignTimeSpec(node.AnnotatedDateTime.DateTime.Time);
              } else {
                Assert(!!node.AnnotatedTime);
                assignTimeZone(node.AnnotatedTime.TimeZoneAnnotation, node.AnnotatedTime.DateTimeUTCOffset);
                assignTimeSpec(node.AnnotatedTime.Time);
              }
              return node;
            }
            case 'TemporalInstantString': {
              const node = parser.parseTemporalInstantString();
              assignTimeZone(node.TimeZoneAnnotation, node.DateTimeUTCOffset);
              assignDateSpec(node.Date);
              assignTimeSpec(node.Time);
              return node;
            }
            case 'TemporalMonthDayString': {
              const node = parser.parseTemporalMonthDayString();
              if (node.AnnotatedDateTime) {
                assignTimeZone(node.AnnotatedDateTime.TimeZoneAnnotation, node.AnnotatedDateTime.DateTime.DateTimeUTCOffset);
                assignDateSpec(node.AnnotatedDateTime.DateTime.Date);
                if (node.AnnotatedDateTime.DateTime.Time) assignTimeSpec(node.AnnotatedDateTime.DateTime.Time);
              } else {
                Assert(!!node.AnnotatedMonthDay);
                assignTimeZone(node.AnnotatedMonthDay.TimeZoneAnnotation);
                month = node.AnnotatedMonthDay.DateSpecMonthDay.Month;
                day = node.AnnotatedMonthDay.DateSpecMonthDay.Day;
              }
              return node;
            }
            case 'TemporalYearMonthString': {
              const node = parser.parseTemporalYearMonthString();
              if (node.AnnotatedDateTime) {
                assignTimeZone(node.AnnotatedDateTime.TimeZoneAnnotation, node.AnnotatedDateTime.DateTime.DateTimeUTCOffset);
                assignDateSpec(node.AnnotatedDateTime.DateTime.Date);
                if (node.AnnotatedDateTime.DateTime.Time) assignTimeSpec(node.AnnotatedDateTime.DateTime.Time);
              } else {
                Assert(!!node.AnnotatedYearMonth);
                assignTimeZone(node.AnnotatedYearMonth.TimeZoneAnnotation, undefined);
                month = node.AnnotatedYearMonth.DateSpecYearMonth.Month;
                year = node.AnnotatedYearMonth.DateSpecYearMonth.Year;
              }
              return node;
            }
            case 'DateTimeString': {
              const node = parser.with({ DateCompatibility: true }, () => parser.parseDateTime());
              assignDateSpec(node.Date);
              if (node.Time) assignTimeSpec(node.Time);
              if (node.DateTimeUTCOffset) assignTimeZone(undefined, node.DateTimeUTCOffset);
              return node;
            }
            default:
              throw OutOfRange.exhaustive(goal);
          }
        },
        { RangeError: true },
      );
      if (!result) continue;
      if (Array.isArray(result)) {
        lastError = result[0];
        continue;
      }
      parseResult = result;
      let calendarWasCritical = false;

      // 2. For each Annotation Parse Node annotation contained within parseResult, do
      let annotations: readonly RFC9557ParseNode.Annotation[] = [];
      if ('Annotations' in parseResult && parseResult.Annotations) {
        annotations = annotations.concat(parseResult.Annotations);
      }
      if ('AnnotatedDateTime' in parseResult && parseResult.AnnotatedDateTime?.Annotations) {
        annotations = annotations.concat(parseResult.AnnotatedDateTime.Annotations);
      }
      if ('AnnotatedTime' in parseResult && parseResult.AnnotatedTime?.Annotations) {
        annotations = annotations.concat(parseResult.AnnotatedTime.Annotations);
      }
      if ('AnnotatedMonthDay' in parseResult && parseResult.AnnotatedMonthDay?.Annotations) {
        annotations = annotations.concat(parseResult.AnnotatedMonthDay.Annotations);
      }
      if ('AnnotatedYearMonth' in parseResult && parseResult.AnnotatedYearMonth?.Annotations) {
        annotations = annotations.concat(parseResult.AnnotatedYearMonth.Annotations);
      }

      for (const Annotation of annotations) {
        const key = Annotation.AnnotationKey;
        const value = Annotation.AnnotationValue;
        if (key === 'u-ca') {
          if (!calendar) {
            calendar = value;
            if (Annotation.CriticalFlag) calendarWasCritical = true;
          } else {
            if (Annotation.CriticalFlag || calendarWasCritical) return Throw.RangeError('Critical calendar annotation failed.');
          }
        } else {
          if (Annotation.CriticalFlag) return Throw.RangeError('Critical annotation "$1" failed.', key);
        }
      }

      // https://github.com/tc39/ecma262/pull/3759/changes#r2851037938
      if (goal === 'TemporalYearMonthString' && (parseResult as RFC9557ParseNode.TemporalYearMonthString).AnnotatedDateTime?.DateTime.Date.Day === undefined) {
        if (calendar !== undefined && calendar.toLowerCase() !== 'iso8601') return Throw.RangeError('Calendar annotation is not allowed when day is absent');
      }

      if (goal === 'TemporalMonthDayString' && (parseResult as RFC9557ParseNode.TemporalMonthDayString).AnnotatedDateTime?.DateTime.Date.Year === undefined) {
        if (calendar !== undefined && calendar.toLowerCase() !== 'iso8601') return Throw.RangeError('Calendar annotation is not allowed when year is absent');
        yearAbsent = true;
      }
      break;
    }
  }
  if (!parseResult) {
    if (lastError) return ThrowCompletion(lastError);
    return Throw.RangeError('$1 does not match any of productions ($2)', Value(isoString), allowedFormats);
  }

  month ??= 1n;
  day ??= 1n;
  hour ??= 0n;
  minute ??= 0n;
  second ??= 0n;
  if (second === 60n) second = 59n;
  let millisecondMV: bigint;
  let microsecondMV: bigint;
  let nanosecondMV: bigint;
  if (fSeconds) {
    const fSecondsDigits = fSeconds.digits;
    const fSecondsDigitsExtended = `${fSecondsDigits}000000000`;
    const millisecond = fSecondsDigitsExtended.substring(0, 3);
    const microsecond = fSecondsDigitsExtended.substring(3, 6);
    const nanosecond = fSecondsDigitsExtended.substring(6, 9);
    millisecondMV = BigInt(millisecond);
    microsecondMV = BigInt(microsecond);
    nanosecondMV = BigInt(nanosecond);
  } else {
    millisecondMV = 0n;
    microsecondMV = 0n;
    nanosecondMV = 0n;
  }
  Assert(IsValidISODate(year, month, day));
  let time: ISODateTimeParseRecord['Time'];
  if (hour === undefined) {
    time = 'start-of-day';
  } else {
    time = X(CreateTimeRecord(hour, minute, second, millisecondMV, microsecondMV, nanosecondMV));
  }
  const timeZoneResult: Mutable<ISOStringTimeZoneParseRecord> = { Z: false, OffsetString: undefined, TimeZoneAnnotation: undefined };
  if (timeZoneIdentifier) timeZoneResult.TimeZoneAnnotation = timeZoneIdentifier.sourceText;
  if (UTCDesignator) timeZoneResult.Z = true;
  else if (UTCOffset) timeZoneResult.OffsetString = UTCOffset.sourceText;
  const yearReturn = yearAbsent ? undefined : year;
  return {
    Year: yearReturn,
    Month: month,
    Day: day,
    Time: time,
    TimeZone: timeZoneResult,
    Calendar: calendar,
  };
}

/** https://tc39.es/proposal-temporal/#sec-temporal-parsetemporalcalendarstring */
export function ParseTemporalCalendarString(isoString: string): PlainCompletion<string> {
  const parseResult = EnsureCompletion(ParseISODateTime(isoString, 'all'));
  if (parseResult instanceof NormalCompletion) {
    const calendar = parseResult.Value.Calendar;
    if (calendar === undefined) return 'iso8601';
    return calendar;
  }
  const parseResult2 = DateParser.parse(
    isoString,
    (parser) => parser.parseAnnotationValue(),
    { RangeError: true },
  );
  if (Array.isArray(parseResult2)) return ThrowCompletion(parseResult2[0]);
  return parseResult2;
}

/** https://tc39.es/proposal-temporal/#sec-temporal-parsetemporaldurationstring */
export function* ParseTemporalDurationString(isoString: string): ValueEvaluator<TemporalDurationObject> {
  const duration = DateParser.parse(
    isoString,
    (parser) => parser.parseTemporalDurationString(),
    { RangeError: true },
  );
  if (Array.isArray(duration)) return ThrowCompletion(duration[0]);
  const {
    AsciiSign: sign, Years: years = '', Months: months = '', Weeks: weeks = '', Days: days = '', Hours: hoursNode = '', Minutes: minutesNode = '', Seconds: secondsNode = '',
  } = duration;
  const _seperator = /(?=[.,])/;
  const [hours, fHours = ''] = hoursNode.split(_seperator);
  const [minutes, fMinutes = ''] = minutesNode.split(_seperator);
  const [seconds, fSeconds = ''] = secondsNode.split(_seperator);
  let yearsMV = Q(yield* SnapToInteger(Value(years), 'truncate'));
  let monthsMV = Q(yield* SnapToInteger(Value(months), 'truncate'));
  let weeksMV = Q(yield* SnapToInteger(Value(weeks), 'truncate'));
  let daysMV = Q(yield* SnapToInteger(Value(days), 'truncate'));
  let hoursMV = Q(yield* SnapToInteger(Value(hours), 'truncate'));
  let minutesMV: MathematicalValue;
  if (fHours) {
    Assert(!minutes && !fMinutes && !seconds && !fSeconds);
    const fHoursDigits = fHours.substring(1);
    const fHoursScale = fHoursDigits.length;
    minutesMV = Decimal(Q(yield* SnapToInteger(Value(fHoursDigits), 'truncate'))).divide(10 ** fHoursScale).multiply(60);
  } else {
    minutesMV = Decimal(Q(yield* SnapToInteger(Value(minutes), 'truncate')));
  }
  let secondsMV: MathematicalValue;
  if (fMinutes) {
    Assert(!seconds && !fSeconds);
    const fMinutesDigits = fMinutes.substring(1);
    const fMinutesScale = fMinutesDigits.length;
    secondsMV = Decimal(Q(yield* SnapToInteger(Value(fMinutesDigits), 'truncate'))).divide(10 ** fMinutesScale).multiply(60);
  } else if (seconds) {
    secondsMV = Decimal(Q(yield* SnapToInteger(Value(seconds), 'truncate')));
  } else {
    secondsMV = minutesMV.remainder(1).multiply(60);
  }
  let millisecondsMV: MathematicalValue;
  if (fSeconds) {
    const fSecondDigits = fSeconds.substring(1);
    const fSecondsScale = fSecondDigits.length;
    millisecondsMV = Decimal(Q(yield* SnapToInteger(Value(fSecondDigits), 'truncate'))).divide(10 ** fSecondsScale).multiply(1000);
  } else {
    millisecondsMV = secondsMV.remainder(1).multiply(1000);
  }
  let microsecondsMV = millisecondsMV.remainder(1).multiply(1000);
  let nanosecondsMV = microsecondsMV.remainder(1).multiply(1000);
  const factor = sign === '-' ? -1n : 1n;
  yearsMV *= factor;
  monthsMV *= factor;
  weeksMV *= factor;
  daysMV *= factor;
  hoursMV *= factor;
  minutesMV = minutesMV.floor().multiply(factor);
  secondsMV = secondsMV.floor().multiply(factor);
  millisecondsMV = millisecondsMV.floor().multiply(factor);
  microsecondsMV = microsecondsMV.floor().multiply(factor);
  nanosecondsMV = nanosecondsMV.floor().multiply(factor);
  return Q(yield* CreateTemporalDuration(yearsMV, monthsMV, weeksMV, daysMV, hoursMV, minutesMV.toBigInt(), secondsMV.toBigInt(), millisecondsMV.toBigInt(), microsecondsMV.toBigInt(), nanosecondsMV.toBigInt()));
}

/** https://tc39.es/proposal-temporal/#sec-temporal-parsetemporaltimezonestring */
export function ParseTemporalTimeZoneString(timeZoneString: string): PlainCompletion<TimeZoneIdentifierParseRecord> {
  const parseResult = DateParser.parse(
    timeZoneString,
    (parser) => parser.parseTimeZoneIdentifier(),
    { RangeError: true },
  );
  if (!Array.isArray(parseResult)) {
    return X(ParseTimeZoneIdentifier(timeZoneString));
  }
  const result = Q(ParseISODateTime(timeZoneString, 'all'));
  const timeZoneResult = result.TimeZone;
  if (timeZoneResult.TimeZoneAnnotation !== undefined) {
    return X(ParseTimeZoneIdentifier(timeZoneResult.TimeZoneAnnotation));
  }
  if (timeZoneResult.Z) return X(ParseTimeZoneIdentifier('UTC'));
  if (timeZoneResult.OffsetString !== undefined) {
    return Q(ParseTimeZoneIdentifier(timeZoneResult.OffsetString));
  }
  return ThrowCompletion(parseResult[0]);
}

/** https://tc39.es/proposal-temporal/#sec-temporal-time-zone-identifier-parse-records */
export interface TimeZoneIdentifierParseRecord {
  Name: string | undefined;
  OffsetMinutes: bigint | undefined;
}

/** https://tc39.es/proposal-temporal/#sec-temporal-parsemonthcode */
export function* ParseMonthCode(argument: Value | string): PlainEvaluator<{ MonthNumber: Integer; IsLeapMonth: boolean }> {
  const monthCode = typeof argument === 'string' ? Value(argument) : Q(yield* ToPrimitive(argument, 'string'));
  if (!(monthCode instanceof JSStringValue)) {
    return Throw.TypeError('monthCode ($1) is not a string', typeof argument === 'string' ? Value(argument) : argument);
  }

  // If ParseText(StringToCodePoints(monthCode), MonthCode) is a List of errors, throw a RangeError exception.

  //  MonthCode :::
  //    M00L
  //    M0 NonZeroDigit L?
  //    M NonZeroDigit DecimalDigit L?

  if (!monthCode.stringValue().match(/^(M00L|M0[1-9]L?|M[1-9][0-9]L?)$/)) {
    return Throw.RangeError('$1 is not a valid month code', monthCode);
  }

  let isLeapMonth = false;
  if (monthCode.stringValue().length === 4) {
    // Assert: The fourth code unit of monthCode is 0x004C (LATIN CAPITAL LETTER L).
    Assert(monthCode.stringValue().charCodeAt(3) === 0x004C);
    isLeapMonth = true;
  }
  const monthCodeDigits = monthCode.stringValue().substring(1, 3);
  const monthNumber = BigInt(monthCodeDigits);
  if (monthNumber === 0n && !isLeapMonth) {
    return Throw.RangeError('$1 is not a valid month code', monthCode);
  }
  return { MonthNumber: monthNumber, IsLeapMonth: isLeapMonth };
}

// https://tc39.es/proposal-temporal/#sec-temporal-parsetimezoneidentifier
export function ParseTimeZoneIdentifier(identifier: string): PlainCompletion<TimeZoneIdentifierParseRecord> {
  const parseResult = DateParser.parse(
    identifier,
    (parser) => parser.parseTimeZoneIdentifier(),
    { RangeError: true },
  );
  if (Array.isArray(parseResult)) return ThrowCompletion(parseResult[0]);
  if (parseResult.TimeZoneIANAName) {
    const name = parseResult.TimeZoneIANAName;
    return { Name: name, OffsetMinutes: undefined };
  }
  Assert(!!parseResult.UTCOffset);
  // 5. Let offset be the source text matched by the UTCOffset[~SubMinutePrecision] Parse Node contained within parseResult.
  // the whole string is UTCOffset
  const offset = identifier;
  const offsetNanoseconds = X(ParseDateTimeUTCOffset(offset));
  const offsetMinutes = offsetNanoseconds / BigInt(60e9);
  return { Name: undefined, OffsetMinutes: offsetMinutes };
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export declare namespace RFC9557ParseNode {
  export interface Annotation {
    readonly CriticalFlag: boolean;
    readonly AnnotationKey: string;
    readonly AnnotationValue: string;
  }

  export interface UTCOffset {
    readonly Sign: '+' | '-';
    readonly Hour: bigint;
    readonly Minute?: bigint;
    readonly Second?: bigint;
    readonly TemporalDecimalFraction?: { readonly separator: '.' | ','; readonly digits: string };
    readonly Extended?: boolean;
    readonly sourceText: string;
  }

  export interface TimeZoneIdentifier {
    readonly UTCOffset?: UTCOffset;
    readonly TimeZoneIANAName?: string;
    readonly sourceText: string;
  }

  export interface TimeZoneAnnotation {
    readonly CriticalFlag: boolean;
    readonly TimeZoneIdentifier: TimeZoneIdentifier;
  }

  export interface DateSpecYearMonth {
    readonly Year: bigint;
    readonly Month: bigint;
  }

  export interface DateSpecMonthDay {
    readonly Month: bigint;
    readonly Day: bigint;
  }

  export interface DateSpec {
    readonly Year: bigint;
    readonly Month: bigint;
    readonly Day: bigint;
  }

  export interface DateTimeUTCOffset {
    readonly UTCDesignator?: 'Z' | 'z';
    readonly UTCOffset?: UTCOffset;
  }

  export interface TemporalDecimalFraction {
    readonly separator: '.' | ',';
    readonly digits: string;
  }

  export interface TimeSpec {
    readonly Hour: bigint;
    readonly Minute?: bigint;
    readonly Second?: bigint;
    readonly TemporalDecimalFraction?: TemporalDecimalFraction;
  }

  export interface DateTime {
    readonly Date: DateSpec;
    readonly DateTimeSeparator?: ' ' | 'T' | 't';
    readonly Time?: TimeSpec;
    readonly DateTimeUTCOffset?: DateTimeUTCOffset;
  }

  export interface AnnotatedDateTime {
    readonly DateTime: DateTime;
    readonly TimeZoneAnnotation?: TimeZoneAnnotation;
    readonly Annotations?: readonly Annotation[];
  }

  export interface TemporalMonthDayString {
    readonly AnnotatedMonthDay?: AnnotatedMonthDay;
    readonly AnnotatedDateTime?: AnnotatedDateTime;
  }

  export interface AnnotatedMonthDay {
    readonly DateSpecMonthDay: DateSpecMonthDay;
    readonly TimeZoneAnnotation?: TimeZoneAnnotation;
    readonly Annotations?: readonly Annotation[];
  }

  export interface AnnotatedTime {
    readonly TimeDesignator?: 'T' | 't';
    readonly Time: TimeSpec;
    readonly DateTimeUTCOffset?: DateTimeUTCOffset;
    readonly TimeZoneAnnotation?: TimeZoneAnnotation;
    readonly Annotations?: readonly Annotation[];
  }

  export interface TemporalTimeString {
    readonly AnnotatedDateTime?: AnnotatedDateTime;
    readonly AnnotatedTime?: AnnotatedTime;
  }

  export interface TemporalYearMonthString {
    readonly AnnotatedYearMonth?: AnnotatedYearMonth;
    readonly AnnotatedDateTime?: AnnotatedDateTime;
  }

  export interface AnnotatedYearMonth {
    readonly DateSpecYearMonth: DateSpecYearMonth;
    readonly TimeZoneAnnotation?: TimeZoneAnnotation;
    readonly Annotations?: readonly Annotation[];
  }

  export interface TemporalInstantString {
    readonly Date: DateSpec;
    readonly DateTimeSeparator: ' ' | 'T' | 't';
    readonly Time: TimeSpec;
    readonly DateTimeUTCOffset: DateTimeUTCOffset;
    readonly TimeZoneAnnotation?: TimeZoneAnnotation;
    readonly Annotations?: readonly Annotation[];
  }

  export interface Duration {
    readonly AsciiSign?: '+' | '-';
    readonly Years?: string;
    readonly Months?: string;
    readonly Weeks?: string;
    readonly Days?: string;

    readonly Hours?: string;
    readonly Minutes?: string;
    readonly Seconds?: string;
  }
}

export class DateParser {
  static parse<T>(
    source: string,
    f: (parser: DateParser) => T,
    parameters: Partial<DateParser['grammarParameters']> = {},
  ): T | ObjectValue[] {
    const parser = new DateParser(source, parameters);
    try {
      const parse = f(parser);
      parser.consumeAll();
      if (parser.earlyErrors.length > 0) {
        return parser.earlyErrors;
      }
      return parse;
    } catch (error) {
      Assert(error instanceof ThrowCompletion && error.Value instanceof ObjectValue);
      return [error.Value];
    }
  }

  public input: string;

  public pos = 0;

  constructor(input: string, parameters: Partial<DateParser['grammarParameters']> = {}) {
    this.input = input;
    this.grammarParameters = { ...this.grammarParameters, ...parameters };
  }

  private grammarParameters = {
    Extended: false as boolean,
    SubMinutePrecision: false as boolean,
    Z: false as boolean,
    TimeRequired: false as boolean,
    Zoned: false as boolean,
    Sep: false as boolean,
    // Throw RangeError over SyntaxError
    RangeError: false as boolean,
    DateCompatibility: false as boolean,
  } as const;

  private earlyErrors: ObjectValue[] = [];

  private raise: Throw = (message: string, ...args: Formattable[]) => {
    throw Reflect.apply(Throw[this.grammarParameters.RangeError ? 'RangeError' : 'SyntaxError'], null, [message, ...args]);
  };

  peek(length = 1): string | undefined {
    return this.input.slice(this.pos, this.pos + length);
  }

  private lookahead(text: string): boolean {
    return this.input.slice(this.pos, this.pos + text.length) === text;
  }

  private lookaheads(...str: string[]): boolean {
    return str.some((text) => this.input.slice(this.pos, this.pos + text.length) === text);
  }

  private eat<T extends string>(...str: T[]): T | undefined {
    for (const text of str) {
      if (this.lookahead(text)) {
        this.pos += text.length;
        return text;
      }
    }
    return undefined;
  }

  private eatRegExp(regExp: RegExp): undefined | string {
    const match = regExp.exec(this.input.slice(this.pos));
    if (!match || match.index !== 0) {
      return undefined;
    }
    this.pos += match[0].length;
    return match[0];
  }

  //  DateSeparator[Extended] :::
  //    [+Extended] -
  //    [~Extended] [empty]
  //  in case of +Extended ~Extended, this is equal to "-"?
  private parseDateSeparator(Extended: boolean) {
    if (Extended) {
      this.expect('-', () => this.raise('Expected date separator'));
      return '-';
    }
    return undefined;
  }

  private parseDateSeparatorExtendedOrNot() {
    return this.eat('-');
  }

  //  DateYear :::\d{4} or [+-]\d{6}
  private parseDateYear(): bigint {
    const year = this.eatRegExp(/\d{4}|[+-]\d{6}/);
    if (!year) {
      throw this.raise('Expected DateYear');
    }
    if (year === '-000000') {
      throw this.raise('-000000 is not a valid year');
    }
    return BigInt(year);
  }

  //  DateMonth ::: 01 to 12
  private parseDateMonth(): bigint {
    const month = this.eatRegExp(/0[1-9]|1[0-2]/);
    if (!month) {
      if (this.grammarParameters.DateCompatibility) {
        const month = this.eatRegExp(/[1-9]/);
        if (month) return BigInt(month);
      }
      throw this.raise('Invalid DateMonth');
    }
    return BigInt(month);
  }

  //  DateDay ::: 01 to 31
  private parseDateDay(): bigint {
    const day = this.eatRegExp(/0[1-9]|[12][0-9]|3[01]/);
    if (!day) {
      if (this.grammarParameters.DateCompatibility) {
        const day = this.eatRegExp(/[1-9]/);
        if (day) return BigInt(day);
      }
      throw this.raise('Invalid DateDay');
    }
    return BigInt(day);
  }

  //  Date :::
  //    DateSpec[+Extended]
  //    DateSpec[~Extended]
  //
  //  DateSpec[Extended] ::: DateYear DateSeparator[?Extended] DateMonth DateSeparator[?Extended] DateDay
  //
  //  combines to
  //
  //  DateSpec[Extended] :::
  //      DateYear DateSeparator[+Extended] DateMonth DateSeparator[+Extended] DateDay
  //      DateYear DateSeparator[~Extended] DateMonth DateSeparator[~Extended] DateDay
  private parseDate(): RFC9557ParseNode.DateSpec {
    const Year = this.parseDateYear();
    const Extended = this.parseDateSeparatorExtendedOrNot();
    const Month = this.parseDateMonth();
    this.parseDateSeparator(!!Extended);
    const Day = this.parseDateDay();
    const result: RFC9557ParseNode.DateSpec = { Year, Month, Day };
    this.IsValidDate(result);
    return result;
  }

  with<T>(parameters: Partial<DateParser['grammarParameters']>, f: () => T): T {
    const oldParameters = this.grammarParameters;
    this.grammarParameters = { ...this.grammarParameters, ...parameters };
    try {
      return f();
    } finally {
      this.grammarParameters = oldParameters;
    }
  }

  // DateTimeSeparator ::: <SP> T t
  private parseDateTimeSeparator(): ' ' | 'T' | 't' {
    return this.parse(/[ Tt]/, () => this.raise('Expected DateTimeSeparator')) as ' ' | 'T' | 't';
  }

  // TimeSecond ::: Second | 60
  private parseTimeSecond(): bigint {
    if (this.eat('60')) {
      return 60n;
    }
    return this.parseSecond();
  }

  //  TimeSeparator :::
  //    [+Extended] :
  //    [~Extended] [empty]
  //  in case of +Extended ~Extended, this is equal to ":"?
  private parseTimeSeparator(Extended: boolean) {
    if (Extended) {
      this.expect(':', () => this.raise('Expected time separator'));
    }
  }

  private parseTimeSeparatorExtendedOrNot() {
    return this.eat(':');
  }

  //  Time :::
  //    TimeSpec[+Extended]
  //    TimeSpec[~Extended]
  //
  //  TimeSpec[Extended] :::
  //    Hour
  //    Hour TimeSeparator[?Extended] Minute
  //    Hour TimeSeparator[?Extended] Minute TimeSeparator[?Extended] Second TemporalDecimalFraction?
  //
  //  expanded to
  //
  //  TimeSpec :::
  //    Hour
  //    Hour TimeSeparator[+Extended] Minute
  //    Hour TimeSeparator[+Extended] Minute TimeSeparator[+Extended] Second TemporalDecimalFraction?
  //    Hour TimeSeparator[~Extended] Minute
  //    Hour TimeSeparator[~Extended] Minute TimeSeparator[~Extended] Second TemporalDecimalFraction?
  private parseTime(): RFC9557ParseNode.TimeSpec {
    const canContinue = (regExp: RegExp) => {
      const next = this.peek();
      return next && regExp.test(next);
    };

    const Hour = this.parseHour();
    if (!canContinue(/[:0-5]/)) return { Hour };
    const Extended = this.parseTimeSeparatorExtendedOrNot();
    const Minute = this.parseMinute();

    if (!canContinue(Extended ? /[:0-6]/ : /[0-6]/)) return { Hour, Minute };
    this.parseTimeSeparator(!!Extended);
    const Second = this.parseTimeSecond();
    const TemporalDecimalFraction = this.tryParseTemporalDecimalFraction();
    return {
      Hour, Minute, Second, TemporalDecimalFraction,
    };
  }

  //  DateTimeUTCOffset[Z] :::
  //    [+Z] UTCDesignator
  //    UTCOffset[+SubMinutePrecision]
  private parseDateTimeUTCOffset(): RFC9557ParseNode.DateTimeUTCOffset {
    if (this.grammarParameters.Z) {
      const char = this.eat('Z', 'z');
      if (char) return { UTCDesignator: char };
    }
    return { UTCOffset: this.with({ SubMinutePrecision: true }, () => this.parseUTCOffset()) };
  }

  //  DateTime[Z, TimeRequired] :::
  //    [~TimeRequired] Date
  //                    Date DateTimeSeparator Time DateTimeUTCOffset[?Z]?
  parseDateTime(): RFC9557ParseNode.DateTime {
    const Date = this.parseDate();
    if (!this.grammarParameters.TimeRequired) {
      if (!this.lookaheads(' ', 't', 'T')) {
        return { Date };
      }
    }
    const DateTimeSeparator = this.parseDateTimeSeparator();
    const Time = this.parseTime();
    if (!this.lookaheads('z', 'Z', '+', '-')) {
      return { Date, DateTimeSeparator, Time };
    }
    const DateTimeUTCOffset = this.parseDateTimeUTCOffset();
    return {
      Date, DateTimeSeparator, Time, DateTimeUTCOffset,
    };
  }

  //  AnnotatedDateTime[Zoned, TimeRequired] :::
  //    [~Zoned] DateTime[~Z, ?TimeRequired] TimeZoneAnnotation? Annotations?
  //    [+Zoned] DateTime[+Z, ?TimeRequired] TimeZoneAnnotation Annotations?
  private parseAnnotatedDateTime(): RFC9557ParseNode.AnnotatedDateTime {
    const DateTime = this.with({ Z: this.grammarParameters.Zoned }, () => this.parseDateTime());
    const TimeZoneAnnotation = this.grammarParameters.Zoned ? this.parseTimeZoneAnnotation() : this.try(() => this.parseTimeZoneAnnotation(), false);
    if (!this.lookahead('[')) {
      return { DateTime, TimeZoneAnnotation };
    }
    const Annotations = this.parseAnnotations();
    return {
      DateTime,
      TimeZoneAnnotation,
      Annotations,
    };
  }

  //  AnnotatedTime :::
  //    TimeDesignator Time DateTimeUTCOffset[~Z]? TimeZoneAnnotation? Annotations?
  //                   Time DateTimeUTCOffset[~Z]? TimeZoneAnnotation? Annotations?
  private parseAnnotatedTime(): RFC9557ParseNode.AnnotatedTime {
    const startPos = this.pos;

    const TimeDesignator = this.eat('T', 't');
    const Time = this.parseTime();
    const result: Mutable<RFC9557ParseNode.AnnotatedTime> = { TimeDesignator, Time };
    if (this.lookaheads('+', '-')) {
      result.DateTimeUTCOffset = this.with({ Z: false }, () => this.parseDateTimeUTCOffset());
    }

    //  It is a Syntax Error if ParseText(Time DateTimeUTCOffset[~Z], DateSpecMonthDay) is a Parse Node.
    //  It is a Syntax Error if ParseText(Time DateTimeUTCOffset[~Z], DateSpecYearMonth) is a Parse Node.
    const text = this.input.slice(startPos, this.pos);
    const ambiguous = DateParser.parse(text, (parser) => parser.try(() => parser.parseDateSpecMonthDay(), true) || parser.try(() => parser.parseDateSpecYearMonth(), true));
    if (!Array.isArray(ambiguous)) {
      try {
        this.raise('Date $1 is ambiguous', text);
      } catch (error) {
        this.earlyErrors.push((error as ThrowCompletion).Value as ObjectValue);
      }
    }

    if (this.lookahead('[')) {
      result.TimeZoneAnnotation = this.try(() => this.parseTimeZoneAnnotation(), false);
    }
    if (this.lookahead('[')) {
      result.Annotations = this.parseAnnotations();
    }
    return result;
  }

  expect(char: string, message?: () => ThrowCompletion): void {
    if (this.input[this.pos] !== char) {
      throw message ? message() : this.raise('Expected \'$1\' at position $2', char, this.pos);
    }
    this.pos += 1;
  }

  private parse(regExp: RegExp, message: () => ThrowCompletion): string {
    const match = regExp.exec(this.input.slice(this.pos));
    if (!match || match.index !== 0) {
      throw message();
    }
    this.pos += match[0].length;
    return match[0];
  }

  try<T>(f: () => T, consumeAll: boolean): T | undefined {
    const startPos = this.pos;
    const oldParameter = this.grammarParameters;
    const oldEarlyErrors = [...this.earlyErrors];
    try {
      const result = f();
      if (consumeAll) {
        this.consumeAll();
      }
      return result;
    } catch {
      this.pos = startPos;
      this.earlyErrors = oldEarlyErrors;
      return undefined;
    } finally {
      this.grammarParameters = oldParameter;
    }
  }

  consumeAll() {
    if (this.peek()) {
      throw this.raise('Date parser found more content after parsing finished when parsing $1', this.input);
    }
  }

  // #region Top Goals (used as a parameter of ParseText)

  //  AnnotationValue ::: one or more [a-zA-Z0-9]+ connected with "-"
  parseAnnotationValue(): string {
    const parseComponent = () => {
      const value = this.eatRegExp(/[a-zA-Z0-9]+/);
      if (!value) {
        throw this.raise('Expected AnnotationValueComponent');
      }
      return value;
    };

    let value = parseComponent();
    while (this.eat('-')) {
      value += `-${parseComponent()}`;
    }
    return value;
  }

  // TemporalDurationString
  //    ASCIISign? DurationDesignator DurationDate
  //    ASCIISign? DurationDesignator DurationTime
  parseTemporalDurationString(): RFC9557ParseNode.Duration {
    const durationRegExp = /(?<AsciiSign>[+-])?P(?<Year>\d+Y)?(?<Month>\d+M)?(?<Week>\d+W)?(?<Day>\d+D)?(?<HasTimePart>T(?<Hour>\d+(?<HourDot>[.,]\d{1,9})?H)?(?<Minute>\d+(?<MinuteDot>[.,]\d{1,9})?M)?(?<Second>\d+([.,]\d{1,9})?S)?)?/i;
    const match = this.eatRegExp(durationRegExp);
    if (!match) {
      throw this.raise('Invalid TemporalDurationString');
    }
    const {
      AsciiSign, Year, Month, Week, Day, HasTimePart, Hour, Minute, Second, HourDot, MinuteDot,
    } = (durationRegExp.exec(match) as RegExpExecArray).groups!;
    if (HasTimePart && !Hour && !Minute && !Second) {
      throw this.raise('Invalid TemporalDurationString: Time part is present but empty');
    }
    if ((Minute || Second) && HourDot) throw this.raise('Invalid TemporalDurationString: Hour has decimal part but Minute or Second is present');
    if (Second && MinuteDot) throw this.raise('Invalid TemporalDurationString: Minute has decimal part but Second is present');
    if (!Year && !Month && !Week && !Day && !Hour && !Minute && !Second) {
      throw this.raise('Invalid TemporalDurationString: Bare P/-P/+P is not valid');
    }
    return {
      AsciiSign: AsciiSign as '+' | '-' | undefined,
      Years: Year ? Year.slice(0, -1) : undefined,
      Months: Month ? Month.slice(0, -1) : undefined,
      Weeks: Week ? Week.slice(0, -1) : undefined,
      Days: Day ? Day.slice(0, -1) : undefined,
      Hours: Hour ? Hour.slice(0, -1) : undefined,
      Minutes: Minute ? Minute.slice(0, -1) : undefined,
      Seconds: Second ? Second.slice(0, -1) : undefined,
    };
  }

  // TemporalDateTimeString :::
  //    AnnotatedDateTime[?Zoned, ~TimeRequired]
  parseTemporalDateTimeString(): RFC9557ParseNode.AnnotatedDateTime {
    return this.with({ TimeRequired: false }, () => this.parseAnnotatedDateTime());
  }

  // TemporalInstantString :::
  //    Date DateTimeSeparator Time DateTimeUTCOffset[+Z] TimeZoneAnnotation? Annotations?
  parseTemporalInstantString(): RFC9557ParseNode.TemporalInstantString {
    const Date = this.parseDate();
    const DateTimeSeparator = this.parseDateTimeSeparator();
    const Time = this.parseTime();
    const DateTimeUTCOffset = this.with({ Z: true }, () => this.parseDateTimeUTCOffset());
    const TimeZoneAnnotation = this.lookahead('[') ? this.try(() => this.parseTimeZoneAnnotation(), false) : undefined;
    const Annotations = this.lookahead('[') ? this.try(() => this.parseAnnotations(), false) : undefined;
    return {
      Date,
      DateTimeSeparator,
      Time,
      DateTimeUTCOffset,
      TimeZoneAnnotation,
      Annotations,
    };
  }

  // TemporalYearMonthString :::
  //    AnnotatedYearMonth
  //    AnnotatedDateTime[~Zoned, ~TimeRequired]
  parseTemporalYearMonthString(): RFC9557ParseNode.TemporalYearMonthString {
    const AnnotatedYearMonth = this.try(() => this.parseAnnotatedYearMonth(), true);
    if (AnnotatedYearMonth) return { AnnotatedYearMonth };
    const AnnotatedDateTime = this.with({ Zoned: false, TimeRequired: false }, () => this.parseAnnotatedDateTime());
    return { AnnotatedDateTime };
  }

  //  AnnotatedYearMonth :::
  //    DateSpecYearMonth TimeZoneAnnotation? Annotations?
  parseAnnotatedYearMonth(): RFC9557ParseNode.AnnotatedYearMonth {
    const DateSpecYearMonth = this.parseDateSpecYearMonth();
    const TimeZoneAnnotation = this.lookahead('[') ? this.try(() => this.parseTimeZoneAnnotation(), false) : undefined;
    const Annotations = this.lookahead('[') ? this.parseAnnotations() : undefined;
    return { DateSpecYearMonth, TimeZoneAnnotation, Annotations };
  }

  //  TemporalMonthDayString :::
  //    AnnotatedMonthDay
  //    AnnotatedDateTime[~Zoned, ~TimeRequired]
  parseTemporalMonthDayString(): RFC9557ParseNode.TemporalMonthDayString {
    const AnnotatedMonthDay = this.try(() => this.parseAnnotatedMonthDay(), true);
    if (AnnotatedMonthDay) return { AnnotatedMonthDay };
    const AnnotatedDateTime = this.with({ Zoned: false, TimeRequired: false }, () => this.parseAnnotatedDateTime());
    return { AnnotatedDateTime };
  }

  //  AnnotatedMonthDay :::
  //    DateSpecMonthDay TimeZoneAnnotation? Annotations?
  parseAnnotatedMonthDay(): RFC9557ParseNode.AnnotatedMonthDay {
    const DateSpecMonthDay = this.parseDateSpecMonthDay();
    const TimeZoneAnnotation = this.lookahead('[') ? this.try(() => this.parseTimeZoneAnnotation(), false) : undefined;
    const Annotations = this.lookahead('[') ? this.parseAnnotations() : undefined;
    return { DateSpecMonthDay, TimeZoneAnnotation, Annotations };
  }

  // TemporalTimeString :::
  //   AnnotatedTime
  //   AnnotatedDateTime[~Zoned, +TimeRequired]
  parseTemporalTimeString(): RFC9557ParseNode.TemporalTimeString {
    const AnnotatedTime = this.try(() => this.parseAnnotatedTime(), true);
    if (AnnotatedTime) return { AnnotatedTime };
    const AnnotatedDateTime = this.with({ Zoned: false, TimeRequired: true }, () => this.parseAnnotatedDateTime());
    return { AnnotatedDateTime };
  }

  // TimeZoneIdentifier :::
  //   UTCOffset[~SubMinutePrecision]
  //   TimeZoneIANAName
  parseTimeZoneIdentifier(): RFC9557ParseNode.TimeZoneIdentifier {
    const pos = this.pos;
    if (this.lookaheads('+', '-')) {
      const UTCOffset = this.with({ SubMinutePrecision: false }, () => this.parseUTCOffset());
      return { UTCOffset, sourceText: this.input.slice(pos, this.pos) };
    }
    const TimeZoneIANAName = this.parseTimeZoneIANAName();
    return { TimeZoneIANAName, sourceText: this.input.slice(pos, this.pos) };
  }

  // UTCOffset[SubMinutePrecision] :::
  //                         ASCIISign Hour
  //                         ASCIISign Hour TimeSeparator[+Extended] Minute
  //                         ASCIISign Hour TimeSeparator[~Extended] Minute
  //   [+SubMinutePrecision] ASCIISign Hour TimeSeparator[+Extended] Minute TimeSeparator[+Extended] Second TemporalDecimalFraction?
  //   [+SubMinutePrecision] ASCIISign Hour TimeSeparator[~Extended] Minute TimeSeparator[~Extended] Second TemporalDecimalFraction?
  parseUTCOffset(): RFC9557ParseNode.UTCOffset {
    const pos = this.pos;
    const Sign = this.parseAsciiSign();
    const Hour = this.parseHour();
    if (!/[0-6:]/.test(this.peek() || '')) {
      return { Sign, Hour, sourceText: this.input.slice(pos, this.pos) };
    }
    const Extended = !!this.parseTimeSeparatorExtendedOrNot();
    const Minute = this.parseMinute();
    if (!this.grammarParameters.SubMinutePrecision || !/[0-6:]/.test(this.peek() || '')) {
      return {
        Sign, Hour, Minute, sourceText: this.input.slice(pos, this.pos),
      };
    }
    this.parseTimeSeparator(Extended);
    const Second = this.parseSecond();
    const TemporalDecimalFraction = this.tryParseTemporalDecimalFraction();
    return {
      Sign, Hour, Minute, Second, TemporalDecimalFraction, sourceText: this.input.slice(pos, this.pos),
    };
  }
  // #endregion

  // #region Sub goals
  //  ASCIISign ::: one of + -
  parseAsciiSign(): '+' | '-' {
    return this.parse(/[+-]/, () => this.raise('Expected ASCIISign')) as '+' | '-';
  }

  // TimeZoneIANAName ::: TimeZoneIANANameComponent separated by "/"
  // TimeZoneIANANameComponent ::: [._a-zA-Z] followed by zero or more [._a-zA-Z\d\-+]
  parseTimeZoneIANAName(): string {
    const parseComponent = (): string => {
      const name = this.parse(/[._a-zA-Z][._a-zA-Z\d\-+]*/, () => this.raise('Expected TimeZoneIANANameComponent'));
      return name;
    };

    let name = parseComponent();
    while (this.eat('/')) {
      name += `/${parseComponent()}`;
    }
    return name;
  }

  //  Hour :: number 00 to 23
  parseHour(): bigint {
    const result = this.eatRegExp(/([01]\d)|(2[0123])/);
    if (!result) {
      if (this.grammarParameters.DateCompatibility) {
        const hour = this.eatRegExp(/\d/);
        if (hour) return BigInt(hour);
      }
      throw this.raise('Invalid hour');
    }
    return BigInt(result);
  }

  //  Minute :: number 00 to 59
  parseMinute(): bigint {
    const result = this.eatRegExp(/[0-5]\d/);
    if (!result) {
      if (this.grammarParameters.DateCompatibility) {
        const minute = this.eatRegExp(/\d/);
        if (minute) return BigInt(minute);
      }
      throw this.raise('Invalid minute');
    }
    return BigInt(result);
  }

  //  Second :: number 00 to 59
  parseSecond(): bigint {
    const result = this.eatRegExp(/[0-5]\d/);
    if (!result) {
      if (this.grammarParameters.DateCompatibility) {
        const second = this.eatRegExp(/\d/);
        if (second) return BigInt(second);
      }
      throw this.raise('Invalid second');
    }
    return BigInt(result);
  }

  //  TemporalDecimalFraction ::: [.,][0-9]{1,9}
  tryParseTemporalDecimalFraction(): RFC9557ParseNode.TemporalDecimalFraction | undefined {
    const separator = this.peek();
    if (separator !== '.' && separator !== ',') {
      return undefined;
    }
    this.pos += 1;
    const digits = this.parse(/[0-9]{1,9}/, () => this.raise('Expected 1 to 9 decimal digits in TemporalDecimalFraction'));
    return {
      separator,
      digits,
    };
  }

  //  DateSpecMonthDay ::: --? DateMonth DateSeparator[+Extended][~Extended] DateDay
  parseDateSpecMonthDay(): RFC9557ParseNode.DateSpecMonthDay {
    this.eat('--');
    const Month = this.parseDateMonth();
    this.parseDateSeparatorExtendedOrNot();
    const Day = this.parseDateDay();
    const result: RFC9557ParseNode.DateSpecMonthDay = { Month, Day };
    this.IsValidMonthDay(result);
    return result;
  }

  // DateSpecYearMonth ::: DateYear DateSeparator[+Extended][~Extended] DateMonth
  parseDateSpecYearMonth(): RFC9557ParseNode.DateSpecYearMonth {
    const Year = this.parseDateYear();
    this.parseDateSeparatorExtendedOrNot();
    const Month = this.parseDateMonth();
    return { Year, Month };
  }

  //  TimeZoneAnnotation ::: [ AnnotationCriticalFlag? TimeZoneIdentifier ]
  //  AnnotationCriticalFlag ::: !
  parseTimeZoneAnnotation(): RFC9557ParseNode.TimeZoneAnnotation {
    this.expect('[');
    const CriticalFlag = !!this.eat('!');
    const TimeZoneIdentifier = this.parseTimeZoneIdentifier();
    this.expect(']');
    return {
      CriticalFlag,
      TimeZoneIdentifier,
    };
  }

  //  Annotations ::: Annotation Annotations?
  //  Annotation :::
  //    [ AnnotationCriticalFlag? AnnotationKey = AnnotationValue ]
  //  AnnotationCriticalFlag ::: !

  parseAnnotations(): Array<RFC9557ParseNode.Annotation> {
    const annotations: Array<RFC9557ParseNode.Annotation> = [];

    while (this.lookahead('[')) {
      this.expect('[');
      const CriticalFlag = !!this.eat('!');
      const AnnotationKey = this.parseAnnotationKey();
      this.expect('=');
      const AnnotationValue = this.parseAnnotationValue();
      this.expect(']');
      annotations.push({ CriticalFlag, AnnotationKey, AnnotationValue });
    }

    if (annotations.length === 0) {
      throw this.raise('Expected at least one Annotation');
    }
    return annotations;
  }

  //  AnnotationKey ::: [a-z_][a-z_0-9-]*
  parseAnnotationKey(): string {
    return this.parse(/[a-z_][a-z_0-9-]*/, () => this.raise('Expected AnnotationKey'));
  }
  // #endregion

  /** https://tc39.es/ecma262/pr/3759/#sec-rfc9557grammar-static-semantics-isvalidmonthday */
  IsValidMonthDay(node: RFC9557ParseNode.DateSpec | RFC9557ParseNode.DateSpecMonthDay) {
    if (
      (node.Day === 31n && [2n, 4n, 6n, 9n, 11n].includes(node.Month))
      || (node.Month === 2n && node.Day === 30n)
    ) {
      this.raise('Invalid month-day combination: $1-$2', node.Month.toString().padStart(2, '0'), node.Day.toString().padStart(2, '0'));
    }
  }

  /** https://tc39.es/ecma262/pr/3759/#sec-rfc9557grammar-static-semantics-isvaliddate */
  IsValidDate(node: RFC9557ParseNode.DateSpec) {
    this.IsValidMonthDay(node);
    const year = node.Year;
    if (node.Month === 2n && node.Day === 29n && InLeapYear(TimeFromYear(year) as FiniteTimeValue) === 0n) {
      this.raise('Invalid date: $1 is not a leap year, so February does not have 29 days', year);
    }
  }
}
