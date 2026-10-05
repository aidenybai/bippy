import { bootstrapConstructor } from '../bootstrap.mts';
import { SnapToInteger } from '../../abstract-ops/type-conversion.mts';
import { bootstrapTemporalInstantPrototype } from './InstantPrototype.mts';
import {
  Q,
  Throw,
  X,
  type OrdinaryObject,
  type Realm,
  type Arguments,
  type FunctionCallContext,
  F,
  UndefinedValue,
  ToBigInt,
  R,
  Value,
  type ValueEvaluator,
  CompareEpochNanoseconds,
  CreateTemporalInstant,
  IsWithinEpochNanosecondsInterval,
  MinEpochNanoseconds,
  MaxEpochNanoseconds,
  NanosecondsPerMillisecond,
  ToTemporalInstant,
} from '#self';

/** https://tc39.es/proposal-temporal/#sec-properties-of-temporal-instant-instances */
export interface TemporalInstantObject extends OrdinaryObject {
  readonly InitializedTemporalInstant: never;
  readonly EpochNanoseconds: bigint;
}

export function isTemporalInstantObject(o: Value): o is TemporalInstantObject {
  return 'InitializedTemporalInstant' in o;
}

/** https://tc39.es/proposal-temporal/#sec-temporal.instant */
function* InstantConstructor([_epochNanoseconds = Value.undefined]: Arguments, { NewTarget }: FunctionCallContext): ValueEvaluator {
  if (NewTarget instanceof UndefinedValue) {
    return Throw.TypeError('Temporal.Instant cannot be called without new');
  }
  const epochNanosecondsMV = R(Q(yield* ToBigInt(_epochNanoseconds)));
  if (!IsWithinEpochNanosecondsInterval(epochNanosecondsMV)) {
    return Throw.RangeError('$1 is not a valid epoch nanoseconds', epochNanosecondsMV);
  }
  return Q(yield* CreateTemporalInstant(epochNanosecondsMV, NewTarget));
}

/** https://tc39.es/proposal-temporal/#sec-temporal.instant.from */
function* Instant_from([item = Value.undefined]: Arguments): ValueEvaluator {
  return Q(yield* ToTemporalInstant(item));
}

/** https://tc39.es/proposal-temporal/#sec-temporal.instant.fromepochmilliseconds */
function* Instant_fromEpochMilliseconds([epochMilliseconds = Value.undefined]: Arguments): ValueEvaluator {
  const epochMillisecondsMV = Q(yield* SnapToInteger(
    epochMilliseconds,
    'reject',
    MinEpochNanoseconds / NanosecondsPerMillisecond,
    MaxEpochNanoseconds / NanosecondsPerMillisecond,
  ));
  return X(CreateTemporalInstant(epochMillisecondsMV * NanosecondsPerMillisecond));
}

/** https://tc39.es/proposal-temporal/#sec-temporal.instant.fromepochnanoseconds */
function* Instant_fromEpochNanoseconds([_epochNanoseconds = Value.undefined]: Arguments): ValueEvaluator {
  const epochNanoseconds = R(Q(yield* ToBigInt(_epochNanoseconds)));
  if (!IsWithinEpochNanosecondsInterval(epochNanoseconds)) {
    return Throw.RangeError('$1 is not a valid epoch nanoseconds', epochNanoseconds);
  }
  return X(CreateTemporalInstant(epochNanoseconds));
}

/** https://tc39.es/proposal-temporal/#sec-temporal.instant.compare */
function* Instant_compare([_xInstant = Value.undefined, _yInstant = Value.undefined]: Arguments): ValueEvaluator {
  const xInstant_ = Q(yield* ToTemporalInstant(_xInstant));
  const yInstant_ = Q(yield* ToTemporalInstant(_yInstant));
  return F(CompareEpochNanoseconds(xInstant_.EpochNanoseconds, yInstant_.EpochNanoseconds));
}

export function bootstrapTemporalInstant(realmRec: Realm) {
  const prototype = bootstrapTemporalInstantPrototype(realmRec);

  const constructor = bootstrapConstructor(realmRec, InstantConstructor, 'Instant', 1, prototype, [
    ['from', Instant_from, 1],
    ['fromEpochMilliseconds', Instant_fromEpochMilliseconds, 1],
    ['fromEpochNanoseconds', Instant_fromEpochNanoseconds, 1],
    ['compare', Instant_compare, 2],
  ]);
  realmRec.Intrinsics['%Temporal.Instant%'] = constructor;
  return constructor;
}
