import { bootstrapConstructor } from '../bootstrap.mts';
import {
  type TimeZoneIdentifier,
} from '../../abstract-ops/temporal/addition.mts';
import {
  FormatOffsetTimeZoneIdentifier,
  GetAvailableNamedTimeZoneIdentifier,
} from '../../abstract-ops/temporal/time-zone.mts';
import {
  CanonicalizeCalendar,
  type KnownCalendarType,
} from '../../abstract-ops/temporal/calendar.mts';
import { CreateTemporalZonedDateTime, ToTemporalZonedDateTime } from '../../abstract-ops/temporal/zoned-datetime.mts';
import { ParseTimeZoneIdentifier } from '../../parser/TemporalParser.mts';
import { bootstrapTemporalZonedDateTimePrototype } from './ZonedDateTimePrototype.mts';
import {
  JSStringValue,
  Value,
  Q,
  type OrdinaryObject,
  type ValueEvaluator,
  Throw,
  type Realm,
  type Arguments,
  type FunctionCallContext,
  UndefinedValue,
  F,
  ToBigInt,
  Assert,
  R,
  CompareEpochNanoseconds,
  IsWithinEpochNanosecondsInterval,
} from '#self';

/** https://tc39.es/proposal-temporal/#sec-properties-of-temporal-zoneddatetime-instances */
export interface TemporalZonedDateTimeObject extends OrdinaryObject {
  readonly InitializedTemporalZonedDateTime: never;
  readonly EpochNanoseconds: bigint;
  readonly TimeZone: TimeZoneIdentifier;
  readonly Calendar: KnownCalendarType;
}
export function isTemporalZonedDateTimeObject(o: Value): o is TemporalZonedDateTimeObject {
  return 'InitializedTemporalZonedDateTime' in o;
}

/** https://tc39.es/proposal-temporal/#sec-temporal.zoneddatetime */
function* ZonedDateTimeConstructor([
  _epochNanoseconds = Value.undefined,
  _timeZone = Value.undefined,
  _calendar = Value.undefined,
]: Arguments, { NewTarget }: FunctionCallContext): ValueEvaluator {
  if (NewTarget instanceof UndefinedValue) {
    return Throw.TypeError('Temporal.ZonedDateTime cannot be called without new');
  }
  const epochNanoseconds = R(Q(yield* ToBigInt(_epochNanoseconds)));
  if (!IsWithinEpochNanosecondsInterval(epochNanoseconds)) {
    return Throw.RangeError('$1 is not a valid epoch nanoseconds', epochNanoseconds);
  }
  if (!(_timeZone instanceof JSStringValue)) {
    return Throw.TypeError('timeZone is not a string');
  }
  const timeZoneParse = Q(ParseTimeZoneIdentifier(_timeZone.stringValue()));
  let timeZone;
  if (timeZoneParse.OffsetMinutes === undefined) {
    Assert(timeZoneParse.Name !== undefined);
    const identifierRecord = GetAvailableNamedTimeZoneIdentifier(timeZoneParse.Name as TimeZoneIdentifier);
    if (identifierRecord === undefined) {
      return Throw.RangeError('invalid time zone identifier: $1', timeZoneParse.Name as string);
    }
    timeZone = identifierRecord.Identifier;
  } else {
    timeZone = FormatOffsetTimeZoneIdentifier(timeZoneParse.OffsetMinutes);
  }
  if (_calendar instanceof UndefinedValue) {
    _calendar = Value('iso8601');
  }
  if (!(_calendar instanceof JSStringValue)) {
    return Throw.TypeError('calendar is not a string');
  }
  const calendar = Q(CanonicalizeCalendar(_calendar.stringValue()));
  return Q(yield* CreateTemporalZonedDateTime(epochNanoseconds, timeZone, calendar, NewTarget));
}

/** https://tc39.es/proposal-temporal/#sec-temporal.zoneddatetime.from */
function* ZonedDateTime_from([item = Value.undefined, options = Value.undefined]: Arguments): ValueEvaluator {
  return Q(yield* ToTemporalZonedDateTime(item, options));
}

/** https://tc39.es/proposal-temporal/#sec-temporal.zoneddatetime.compare */
function* ZonedDateTime_compare([_xZonedDateTime = Value.undefined, _yZonedDateTime = Value.undefined]: Arguments): ValueEvaluator {
  const xZonedDateTime = Q(yield* ToTemporalZonedDateTime(_xZonedDateTime));
  const yZonedDateTime = Q(yield* ToTemporalZonedDateTime(_yZonedDateTime));
  return F(CompareEpochNanoseconds(xZonedDateTime.EpochNanoseconds, yZonedDateTime.EpochNanoseconds));
}

export function bootstrapTemporalZonedDateTime(realmRec: Realm) {
  const prototype = bootstrapTemporalZonedDateTimePrototype(realmRec);

  const constructor = bootstrapConstructor(realmRec, ZonedDateTimeConstructor, 'ZonedDateTime', 2, prototype, [
    ['from', ZonedDateTime_from, 1],
    ['compare', ZonedDateTime_compare, 2],
  ]);
  realmRec.Intrinsics['%Temporal.ZonedDateTime%'] = constructor;
  return constructor;
}
