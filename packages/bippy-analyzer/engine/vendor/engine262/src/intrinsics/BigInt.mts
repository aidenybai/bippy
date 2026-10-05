import {
  NumberValue, Value, type Arguments, type FunctionCallContext,
} from '../value.mts';
import { NumberToBigInt } from '../runtime-semantics/all.mts';
import { Q, type ValueEvaluator } from '../completion.mts';
import { bootstrapConstructor } from './bootstrap.mts';
import {
  ToBigInt,
  ToIndex,
  ToPrimitive,
  Throw,
  Z, R,
  type OrdinaryObject,
  Realm,
} from '#self';

export interface BigIntObject extends OrdinaryObject {
  readonly BigIntData: bigint;
}
export function isBigIntObject(o: Value): o is BigIntObject {
  return 'BigIntData' in o;
}
/** https://tc39.es/ecma262/#sec-bigint-constructor */
function* BigIntConstructor([value = Value.undefined]: Arguments, { NewTarget }: FunctionCallContext): ValueEvaluator {
  // 1. If NewTarget is not undefined, throw a TypeError exception.
  if (NewTarget !== Value.undefined) {
    return Throw.TypeError('BigInt is not a constructor');
  }
  // 2. Let prim be ? ToPrimitive(value, number).
  const prim = Q(yield* ToPrimitive(value, 'number'));
  // 3. If Type(prim) is Number, return ? NumberToBigInt(prim).
  // 4. Otherwise, return ? ToBigInt(prim).
  if (prim instanceof NumberValue) {
    return Q(NumberToBigInt(prim));
  } else {
    return Q(yield* ToBigInt(prim));
  }
}

/** https://tc39.es/ecma262/#sec-bigint.asintn */
function* BigInt_asIntN([_bits = Value.undefined, _bigint = Value.undefined]: Arguments): ValueEvaluator {
  // 1. Set bits to ? ToIndex(bits).
  const bits = Q(yield* ToIndex(_bits));
  // 2. Set bigint to ? ToBigInt(bigint).
  const bigint = Q(yield* ToBigInt(_bigint));
  // 3. Let mod be the BigInt value that represents bigint modulo 2bits.
  // 4. If mod ≥ 2^bits - 1, return mod - 2^bits; otherwise, return mod.
  return Z(BigInt.asIntN(bits, R(bigint)));
}

/** https://tc39.es/ecma262/#sec-bigint.asuintn */
function* BigInt_asUintN([_bits = Value.undefined, _bigint = Value.undefined]: Arguments): ValueEvaluator {
  // 1. Set bits to ? ToIndex(bits).
  const bits = Q(yield* ToIndex(_bits));
  // 2. Set bigint to ? ToBigInt(bigint).
  const bigint = Q(yield* ToBigInt(_bigint));
  // 3. Let mod be ℝ(bigint) modulo 2 ** bits.
  // 4. If mod ≥ 2 ** (bits - 1), return Z(mod - 2 ** bits); otherwise, return Z(mod).
  return Z(BigInt.asUintN(bits, R(bigint)));
}

export function bootstrapBigInt(realmRec: Realm) {
  const bigintConstructor = bootstrapConstructor(realmRec, BigIntConstructor, 'BigInt', 1, realmRec.Intrinsics['%BigInt.prototype%'], [
    ['asIntN', BigInt_asIntN, 2],
    ['asUintN', BigInt_asUintN, 2],
  ]);

  realmRec.Intrinsics['%BigInt%'] = bigintConstructor;
}
