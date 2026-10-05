import { bootstrapConstructor } from '../bootstrap.mts';
import { SnapToInteger } from '../../abstract-ops/type-conversion.mts';
import { bootstrapTemporalPlainTimePrototype } from './PlainTimePrototype.mts';
import {
  Q, Throw, UndefinedValue, Value, type OrdinaryObject, type ValueEvaluator,
  type Realm,
  type Arguments,
  type FunctionCallContext,
  F,
  CompareTimeRecord,
  CreateTemporalTime,
  CreateTimeRecord,
  ToTemporalTime,
  type TimeRecord,
} from '#self';

/** https://tc39.es/proposal-temporal/#sec-properties-of-temporal-plaintime-instances */
export interface TemporalPlainTimeObject extends OrdinaryObject {
  readonly InitializedTemporalTime: never;
  readonly Time: TimeRecord;
}

export function isTemporalPlainTimeObject(value: Value): value is TemporalPlainTimeObject {
  return 'InitializedTemporalTime' in value;
}

/** https://tc39.es/proposal-temporal/#sec-temporal.plaintime */
function* PlainTimeConstructor([
  _hour = Value.undefined,
  _minute = Value.undefined,
  _second = Value.undefined,
  _millisecond = Value.undefined,
  _microsecond = Value.undefined,
  _nanosecond = Value.undefined,
]: Arguments, { NewTarget }: FunctionCallContext): ValueEvaluator {
  if (NewTarget instanceof UndefinedValue) {
    return Throw.TypeError('Temporal.PlainTime cannot be called without new');
  }
  let hour;
  if (_hour instanceof UndefinedValue) hour = 0n;
  else hour = Q(yield* SnapToInteger(_hour, 'truncate'));
  let minute;
  if (_minute instanceof UndefinedValue) minute = 0n;
  else minute = Q(yield* SnapToInteger(_minute, 'truncate'));
  let second;
  if (_second instanceof UndefinedValue) second = 0n;
  else second = Q(yield* SnapToInteger(_second, 'truncate'));
  let millisecond;
  if (_millisecond instanceof UndefinedValue) millisecond = 0n;
  else millisecond = Q(yield* SnapToInteger(_millisecond, 'truncate'));
  let microsecond;
  if (_microsecond instanceof UndefinedValue) microsecond = 0n;
  else microsecond = Q(yield* SnapToInteger(_microsecond, 'truncate'));
  let nanosecond;
  if (_nanosecond instanceof UndefinedValue) nanosecond = 0n;
  else nanosecond = Q(yield* SnapToInteger(_nanosecond, 'truncate'));
  const time = Q(CreateTimeRecord(hour, minute, second, millisecond, microsecond, nanosecond));
  return Q(yield* CreateTemporalTime(time, NewTarget));
}

/** https://tc39.es/proposal-temporal/#sec-temporal.plaintime.from */
function* PlainTime_from([item = Value.undefined, options = Value.undefined]: Arguments): ValueEvaluator {
  return Q(yield* ToTemporalTime(item, options));
}

/** https://tc39.es/proposal-temporal/#sec-temporal.plaintime.compare */
function* PlainTime_compare([_xPlainTime = Value.undefined, _yPlainTime = Value.undefined]: Arguments): ValueEvaluator {
  const xPlainTime = Q(yield* ToTemporalTime(_xPlainTime));
  const yPlainTime = Q(yield* ToTemporalTime(_yPlainTime));
  return F(Number(CompareTimeRecord(xPlainTime.Time, yPlainTime.Time)));
}

export function bootstrapTemporalPlainTime(realmRec: Realm) {
  const prototype = bootstrapTemporalPlainTimePrototype(realmRec);

  const constructor = bootstrapConstructor(realmRec, PlainTimeConstructor, 'PlainTime', 0, prototype, [
    ['from', PlainTime_from, 1],
    ['compare', PlainTime_compare, 2],
  ]);
  realmRec.Intrinsics['%Temporal.PlainTime%'] = constructor;
  return constructor;
}
