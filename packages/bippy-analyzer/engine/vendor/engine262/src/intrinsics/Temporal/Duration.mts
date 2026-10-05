import { bootstrapConstructor } from '../bootstrap.mts';
import { __ts_cast__ } from '../../utils/language.mts';
import { SnapToInteger } from '../../abstract-ops/type-conversion.mts';
import { bootstrapTemporalDurationPrototype } from './DurationPrototype.mts';
import {
  ObjectValue, Q, Value, type OrdinaryObject, type ValueEvaluator,
  type Realm,
  type Arguments,
  type FunctionCallContext,
  F,
  UndefinedValue,
  Throw,
  Add24HourDaysToTimeDuration,
  CompareTimeDuration,
  CreateTemporalDuration,
  DateDurationDays,
  DefaultTemporalLargestUnit,
  ToInternalDurationRecord,
  ToTemporalDuration,
  GetTemporalRelativeToOption,
  isCalendarUnit,
  AddZonedDateTime,
  isDateUnit,
  GetOptionsObject,
} from '#self';

/** https://tc39.es/proposal-temporal/#sec-properties-of-temporal-duration-instances */
export interface TemporalDurationObject extends OrdinaryObject {
  readonly InitializedTemporalDuration: never;
  readonly Years: bigint;
  readonly Months: bigint;
  readonly Weeks: bigint;
  readonly Days: bigint;
  readonly Hours: bigint;
  readonly Minutes: bigint;
  readonly Seconds: bigint;
  readonly Milliseconds: bigint;
  readonly Microseconds: bigint;
  readonly Nanoseconds: bigint;
}

export function isTemporalDurationObject(item: Value): item is TemporalDurationObject {
  return item instanceof ObjectValue && 'InitializedTemporalDuration' in item;
}

/** https://tc39.es/proposal-temporal/#sec-temporal.duration */
function* DurationConstructor([
  yearsValue = Value.undefined,
  monthsValue = Value.undefined,
  weeksValue = Value.undefined,
  daysValue = Value.undefined,
  hoursValue = Value.undefined,
  minutesValue = Value.undefined,
  secondsValue = Value.undefined,
  millisecondsValue = Value.undefined,
  microsecondsValue = Value.undefined,
  nanosecondsValue = Value.undefined,
]: Arguments, { NewTarget }: FunctionCallContext): ValueEvaluator {
  if (NewTarget instanceof UndefinedValue) {
    return Throw.TypeError('Temporal.Duration constructor cannot be called without new');
  }
  const years = yearsValue instanceof UndefinedValue ? 0 : Q(yield* SnapToInteger(yearsValue, 'reject'));
  const months = monthsValue instanceof UndefinedValue ? 0 : Q(yield* SnapToInteger(monthsValue, 'reject'));
  const weeks = weeksValue instanceof UndefinedValue ? 0 : Q(yield* SnapToInteger(weeksValue, 'reject'));
  const days = daysValue instanceof UndefinedValue ? 0 : Q(yield* SnapToInteger(daysValue, 'reject'));
  const hours = hoursValue instanceof UndefinedValue ? 0 : Q(yield* SnapToInteger(hoursValue, 'reject'));
  const minutes = minutesValue instanceof UndefinedValue ? 0 : Q(yield* SnapToInteger(minutesValue, 'reject'));
  const seconds = secondsValue instanceof UndefinedValue ? 0 : Q(yield* SnapToInteger(secondsValue, 'reject'));
  const milliseconds = millisecondsValue instanceof UndefinedValue ? 0 : Q(yield* SnapToInteger(millisecondsValue, 'reject'));
  const microseconds = microsecondsValue instanceof UndefinedValue ? 0 : Q(yield* SnapToInteger(microsecondsValue, 'reject'));
  const nanoseconds = nanosecondsValue instanceof UndefinedValue ? 0 : Q(yield* SnapToInteger(nanosecondsValue, 'reject'));
  return Q(yield* CreateTemporalDuration(BigInt(years), BigInt(months), BigInt(weeks), BigInt(days), BigInt(hours), BigInt(minutes), BigInt(seconds), BigInt(milliseconds), BigInt(microseconds), BigInt(nanoseconds), NewTarget));
}

/** https://tc39.es/proposal-temporal/#sec-temporal.duration.from */
function* Duration_From([item = Value.undefined]: Arguments): ValueEvaluator {
  return Q(yield* ToTemporalDuration(item));
}

/** https://tc39.es/proposal-temporal/#sec-temporal.duration.compare */
function* Duration_Compare([_xDurationLike = Value.undefined, _yDurationLike = Value.undefined, options = Value.undefined]: Arguments): ValueEvaluator {
  const xDurationLike = Q(yield* ToTemporalDuration(_xDurationLike));
  const yDurationLike = Q(yield* ToTemporalDuration(_yDurationLike));
  const resolvedOptions = Q(GetOptionsObject(options));
  const relativeToRecord = Q(yield* GetTemporalRelativeToOption(resolvedOptions));
  if (xDurationLike.Years === yDurationLike.Years
    && xDurationLike.Months === yDurationLike.Months
    && xDurationLike.Weeks === yDurationLike.Weeks
    && xDurationLike.Days === yDurationLike.Days
    && xDurationLike.Hours === yDurationLike.Hours
    && xDurationLike.Minutes === yDurationLike.Minutes
    && xDurationLike.Seconds === yDurationLike.Seconds
    && xDurationLike.Milliseconds === yDurationLike.Milliseconds
    && xDurationLike.Microseconds === yDurationLike.Microseconds
    && xDurationLike.Nanoseconds === yDurationLike.Nanoseconds) {
    return F(0);
  }
  const zonedRelativeTo = relativeToRecord.ZonedRelativeTo;
  const plainRelativeTo = relativeToRecord.PlainRelativeTo;
  const xLargestUnit = DefaultTemporalLargestUnit(xDurationLike);
  const yLargestUnit = DefaultTemporalLargestUnit(yDurationLike);
  const xDuration = ToInternalDurationRecord(xDurationLike);
  const yDuration = ToInternalDurationRecord(yDurationLike);
  if (zonedRelativeTo !== undefined
    && (isDateUnit(xLargestUnit) || isDateUnit(yLargestUnit))) {
    const timeZone = zonedRelativeTo.TimeZone;
    const calendar = zonedRelativeTo.Calendar;
    const xAfter = Q(AddZonedDateTime(zonedRelativeTo.EpochNanoseconds, timeZone, calendar, xDuration, 'constrain'));
    const yAfter = Q(AddZonedDateTime(zonedRelativeTo.EpochNanoseconds, timeZone, calendar, yDuration, 'constrain'));
    if (xAfter > yAfter) return F(1);
    if (xAfter < yAfter) return F(-1);
    return F(0);
  }
  let xDays: bigint;
  let yDays: bigint;
  if (isCalendarUnit(xLargestUnit) || isCalendarUnit(yLargestUnit)) {
    if (plainRelativeTo === undefined) {
      return Throw.RangeError('relativeTo option is required when comparing durations with calendar units');
    }
    xDays = Q(DateDurationDays(xDuration.Date, plainRelativeTo));
    yDays = Q(DateDurationDays(yDuration.Date, plainRelativeTo));
  } else {
    xDays = xDurationLike.Days;
    yDays = yDurationLike.Days;
  }
  const xTimeDuration = Q(Add24HourDaysToTimeDuration(xDuration.Time, xDays));
  const yTimeDuration = Q(Add24HourDaysToTimeDuration(yDuration.Time, yDays));
  return F(CompareTimeDuration(xTimeDuration, yTimeDuration));
}

export function bootstrapTemporalDuration(realmRec: Realm) {
  const prototype = bootstrapTemporalDurationPrototype(realmRec);

  const constructor = bootstrapConstructor(realmRec, DurationConstructor, 'Duration', 0, prototype, [
    ['from', Duration_From, 1],
    ['compare', Duration_Compare, 2],
  ]);
  realmRec.Intrinsics['%Temporal.Duration%'] = constructor;
  return constructor;
}
