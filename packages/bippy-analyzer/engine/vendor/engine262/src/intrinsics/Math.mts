import {
  Value,
  NumberValue,
  type Arguments,
} from '../value.mts';
import { Q, X, type ValueEvaluator } from '../completion.mts';
import { Decimal } from '../host-defined/decimal.mts';
import { decodeFloat16, encodeFloat16 } from '../host-defined/ieee754.mts';
import { bootstrapPrototype } from './bootstrap.mts';
import {
  surroundingAgent,
  ToNumber,
  F, R,
  Realm,
  RequireObjectCoercible,
  GetIterator,
  IteratorStepValue,
  IteratorClose,
  Throw,
  Assert,
  ToUint32,
} from '#self';

/** https://tc39.es/ecma262/#sec-math.abs */
function* Math_abs([x = Value.undefined]: Arguments): ValueEvaluator {
  const n = Q(yield* ToNumber(x));
  if (n.isNaN()) return n;
  if (Object.is(n.value, -0)) return F(+0);
  if (Object.is(n.value, -Infinity)) return F(Infinity);
  if (n.value < 0) return F(-n.value);
  return n;
}

/** https://tc39.es/ecma262/#sec-math.acos */
function* Math_acos([x = Value.undefined]: Arguments): ValueEvaluator {
  const n = Q(yield* ToNumber(x));
  if (n.isNaN() || n.value > 1 || n.value < -1) return F(NaN);
  if (n.value === 1) return F(+0);
  return F(Math.acos(R(n)));
}

/** https://tc39.es/ecma262/#sec-math.acosh */
function* Math_acosh([x = Value.undefined]: Arguments): ValueEvaluator {
  const n = Q(yield* ToNumber(x));
  if (n.isNaN() || n.value === Infinity) return n;
  if (n.value === 1) return F(+0);
  if (n.value < 1) return F(NaN);
  return F(Math.acosh(R(n)));
}

/** https://tc39.es/ecma262/#sec-math.asin */
function* Math_asin([x = Value.undefined]: Arguments): ValueEvaluator {
  const n = Q(yield* ToNumber(x));
  if (n.isNaN() || Object.is(n.value, 0) || Object.is(n.value, -0)) return n;
  if (n.value > 1 || n.value < -1) return F(NaN);
  return F(Math.asin(R(n)));
}

/** https://tc39.es/ecma262/#sec-math.asinh */
function* Math_asinh([x = Value.undefined]: Arguments): ValueEvaluator {
  const n = Q(yield* ToNumber(x));
  if (!n.isFinite() || Object.is(n.value, 0) || Object.is(n.value, -0)) return n;
  return F(Math.asinh(R(n)));
}

/** https://tc39.es/ecma262/#sec-math.atan */
function* Math_atan([x = Value.undefined]: Arguments): ValueEvaluator {
  const n = Q(yield* ToNumber(x));
  if (n.isNaN() || Object.is(n.value, 0) || Object.is(n.value, -0)) return n;
  if (n.value === Infinity) return F(Math.PI / 2);
  if (n.value === -Infinity) return F(-Math.PI / 2);
  return F(Math.atan(R(n)));
}

/** https://tc39.es/ecma262/#sec-math.atanh */
function* Math_atanh([x = Value.undefined]: Arguments): ValueEvaluator {
  const n = Q(yield* ToNumber(x));
  if (n.isNaN() || Object.is(n.value, 0) || Object.is(n.value, -0)) return n;
  if (n.value > 1 || n.value < -1) return F(NaN);
  if (n.value === 1) return F(Infinity);
  if (n.value === -1) return F(-Infinity);
  return F(Math.atanh(R(n)));
}

/** https://tc39.es/ecma262/#sec-math.atan2 */
function* Math_atan2([y = Value.undefined, x = Value.undefined]: Arguments): ValueEvaluator {
  const ny = Q(yield* ToNumber(y));
  const nx = Q(yield* ToNumber(x));
  if (ny.isNaN() || nx.isNaN()) return F(NaN);
  if (ny.value === Infinity) {
    if (nx.value === Infinity) return F(Math.PI / 4);
    if (nx.value === -Infinity) return F((3 * Math.PI) / 4);
    return F(Math.PI / 2);
  }
  if (ny.value === -Infinity) {
    if (nx.value === Infinity) return F(-Math.PI / 4);
    if (nx.value === -Infinity) return F((-3 * Math.PI) / 4);
    return F(-Math.PI / 2);
  }
  if (Object.is(ny.value, 0)) {
    if (nx.value > 0 || Object.is(nx.value, 0)) return F(+0);
    return F(Math.PI);
  }
  if (Object.is(ny.value, -0)) {
    if (nx.value > 0 || Object.is(nx.value, 0)) return F(-0);
    return F(-Math.PI);
  }
  Assert(ny.isFinite() && !Object.is(ny.value, 0) && !Object.is(ny.value, -0));
  if (ny.value > 0) {
    if (nx.value === Infinity) return F(0);
    if (nx.value === -Infinity) return F(Math.PI);
    if (Object.is(nx.value, 0) || Object.is(nx.value, -0)) return F(Math.PI / 2);
  }
  // eslint-disable-next-line no-compare-neg-zero
  if (ny.value < -0) {
    if (nx.value === Infinity) return F(-0);
    if (nx.value === -Infinity) return F(-Math.PI);
    if (Object.is(nx.value, 0) || Object.is(nx.value, -0)) return F(-Math.PI / 2);
  }
  Assert(ny.isFinite() && !Object.is(ny.value, 0) && !Object.is(ny.value, -0));
  // 12. Let r be the inverse tangent of abs(ℝ(ny) / ℝ(nx)).
  // 13. If nx < -0𝔽, then
  // a. If ny > +0𝔽, set r to π - r.
  // b. Else, set r to -π + r.
  // 14. Else,
  // a. If ny < -0𝔽, set r to -r.
  // 15. Return an implementation-approximated Number value representing r.
  return F(Math.atan2(ny.value, nx.value));
}

/** https://tc39.es/ecma262/#sec-math.cbrt */
function* Math_cbrt([x = Value.undefined]: Arguments): ValueEvaluator {
  const n = Q(yield* ToNumber(x));
  if (!n.isFinite() || Object.is(n.value, 0) || Object.is(n.value, -0)) return n;
  return F(Math.cbrt(R(n)));
}

/** https://tc39.es/ecma262/#sec-math.ceil */
function* Math_ceil([x = Value.undefined]: Arguments): ValueEvaluator {
  const n = Q(yield* ToNumber(x));
  if (!n.isFinite() || Object.is(n.value, 0) || Object.is(n.value, -0)) return n;
  // eslint-disable-next-line no-compare-neg-zero
  if (n.value < -0 && n.value > -1) return F(-0);
  if (n.isIntegralNumber()) return n;
  return F(Math.ceil(n.value));
}

/** https://tc39.es/ecma262/#sec-math.clz32 */
function* Math_clz32([x = Value.undefined]: Arguments): ValueEvaluator {
  const n = Q(yield* ToUint32(x));
  // 2. Let p be the number of leading zero bits in the unsigned 32-bit binary representation of n.
  // 3. Return 𝔽(p).
  return F(Math.clz32(n.value));
}

/** https://tc39.es/ecma262/#sec-math.cos */
function* Math_cos([x = Value.undefined]: Arguments): ValueEvaluator {
  const n = Q(yield* ToNumber(x));
  if (!n.isFinite()) return F(NaN);
  if (Object.is(n.value, 0) || Object.is(n.value, -0)) return F(1);
  return F(Math.cos(n.value));
}

/** https://tc39.es/ecma262/#sec-math.cosh */
function* Math_cosh([x = Value.undefined]: Arguments): ValueEvaluator {
  const n = Q(yield* ToNumber(x));
  if (n.isNaN()) return n;
  if (n.isInfinity()) return F(Infinity);
  if (Object.is(n.value, 0) || Object.is(n.value, -0)) return F(1);
  return F(Math.cosh(R(n)));
}

/** https://tc39.es/ecma262/#sec-math.exp */
function* Math_exp([x = Value.undefined]: Arguments): ValueEvaluator {
  const n = Q(yield* ToNumber(x));
  if (n.isNaN() || n.value === Infinity) return n;
  if (Object.is(n.value, 0) || Object.is(n.value, -0)) return F(1);
  if (n.value === -Infinity) return F(0);
  return F(Math.exp(R(n)));
}

/** https://tc39.es/ecma262/#sec-math.expm1 */
function* Math_expm1([x = Value.undefined]: Arguments): ValueEvaluator {
  const n = Q(yield* ToNumber(x));
  if (n.isNaN() || Object.is(n.value, 0) || Object.is(n.value, -0) || n.value === Infinity) return n;
  if (n.value === -Infinity) return F(-1);
  // 4. Let exp be the exponential function of ℝ(n).
  // 5. Return an implementation-approximated Number value representing exp - 1.
  return F(Math.expm1(R(n)));
}

/** https://tc39.es/ecma262/#sec-math.floor */
function* Math_floor([x = Value.undefined]: Arguments): ValueEvaluator {
  const n = Q(yield* ToNumber(x));
  if (!n.isFinite() || Object.is(n.value, 0) || Object.is(n.value, -0)) return n;
  if (n.value < 1 && n.value > 0) return F(0);
  if (n.isIntegralNumber()) return n;
  return F(Math.floor(n.value));
}

/** https://tc39.es/ecma262/#sec-math.fround */
function* Math_fround([x = Value.undefined]: Arguments): ValueEvaluator {
  const n = Q(yield* ToNumber(x));
  if (n.isNaN()) return n;
  if (Object.is(n.value, 0) || Object.is(n.value, -0) || n.isInfinity()) return n;
  // 4. Let n32 be the result of converting n to IEEE 754-2019 binary32 format using roundTiesToEven mode.
  // 5. Let n64 be the result of converting n32 to IEEE 754-2019 binary64 format.
  // 6. Return the ECMAScript Number value corresponding to n64.
  return F(Math.fround(n.value));
}

/** https://tc39.es/ecma262/#sec-math.f16round */
function* Math_f16round([x = Value.undefined]: Arguments): ValueEvaluator {
  const n = Q(yield* ToNumber(x));
  if (n.isNaN()) return n;
  if (Object.is(n.value, 0) || Object.is(n.value, -0) || n.isInfinity()) return n;
  if ('f16round' in Math) {
    return F(Math.f16round(n.value));
  }
  return F(decodeFloat16(encodeFloat16(n.value)));
}

/** https://tc39.es/ecma262/#sec-math.hypot */
function* Math_hypot(args: Arguments): ValueEvaluator {
  const coerced = [];
  for (const arg of args) {
    const n = Q(yield* ToNumber(arg ?? Value.undefined));
    coerced.push(n);
  }
  for (const number of coerced) {
    if (number.isInfinity()) return F(Infinity);
  }
  let onlyZero = true;
  for (const number of coerced) {
    if (number.isNaN()) return F(NaN);
    if (!Object.is(number.value, 0) && !Object.is(number.value, -0)) {
      onlyZero = false;
    }
  }
  if (onlyZero) return F(+0);
  return F(Math.hypot(...coerced.map((value) => value.value)));
}

/** https://tc39.es/ecma262/#sec-math.imul */
function* Math_imul([x = Value.undefined, y = Value.undefined]: Arguments): ValueEvaluator {
  const a = Decimal(R(Q(yield* ToUint32(x))));
  const b = Decimal(R(Q(yield* ToUint32(y))));
  const product = a.multiply(b).modulo(2 ** 32);
  if (product.greaterThanOrEqual(2 ** 31)) return F(product.subtract(2 ** 32).toNumber());
  return F(product.toNumber());
}

/** https://tc39.es/ecma262/#sec-math.log */
function* Math_log([x = Value.undefined]: Arguments): ValueEvaluator {
  const n = Q(yield* ToNumber(x));
  if (n.isNaN() || n.value === Infinity) return n;
  if (n.value === 1) return F(+0);
  if (Object.is(n.value, 0) || Object.is(n.value, -0)) return F(-Infinity);
  // eslint-disable-next-line no-compare-neg-zero
  if (n.value < -0) return F(NaN);
  return F(Math.log(R(n)));
}

/** https://tc39.es/ecma262/#sec-math.log1p */
function* Math_log1p([x = Value.undefined]: Arguments): ValueEvaluator {
  const n = Q(yield* ToNumber(x));
  if (n.isNaN() || Object.is(n.value, 0) || Object.is(n.value, -0) || n.value === Infinity) return n;
  if (n.value === -1) return F(-Infinity);
  if (n.value < -1) return F(NaN);
  return F(Math.log1p(R(n)));
}

/** https://tc39.es/ecma262/#sec-math.log10 */
function* Math_log10([x = Value.undefined]: Arguments): ValueEvaluator {
  const n = Q(yield* ToNumber(x));
  if (n.isNaN() || n.value === Infinity) return n;
  if (n.value === 1) return F(+0);
  if (Object.is(n.value, 0) || Object.is(n.value, -0)) return F(-Infinity);
  // eslint-disable-next-line no-compare-neg-zero
  if (n.value < -0) return F(NaN);
  return F(Math.log10(R(n)));
}

/** https://tc39.es/ecma262/#sec-math.log2 */
function* Math_log2([x = Value.undefined]: Arguments): ValueEvaluator {
  const n = Q(yield* ToNumber(x));
  if (n.isNaN() || n.value === Infinity) return n;
  if (n.value === 1) return F(+0);
  if (Object.is(n.value, 0) || Object.is(n.value, -0)) return F(-Infinity);
  // eslint-disable-next-line no-compare-neg-zero
  if (n.value < -0) return F(NaN);
  return F(Math.log2(R(n)));
}

/** https://tc39.es/ecma262/#sec-math.max */
function* Math_max(args: Arguments): ValueEvaluator {
  const coerced = [];
  for (const arg of args) {
    const n = Q(yield* ToNumber(arg ?? Value.undefined));
    coerced.push(n);
  }
  let highest = -Infinity;
  for (const number of coerced) {
    if (number.isNaN()) return number;
    if (Object.is(number.value, 0) && Object.is(highest, -0)) highest = 0;
    if (number.value > highest) highest = number.value;
  }
  return F(highest);
}

/** https://tc39.es/ecma262/#sec-math.min */
function* Math_min(args: Arguments): ValueEvaluator {
  const coerced = [];
  for (const arg of args) {
    const n = Q(yield* ToNumber(arg ?? Value.undefined));
    coerced.push(n);
  }
  let lowest = Infinity;
  for (const number of coerced) {
    if (number.isNaN()) return number;
    if (Object.is(number.value, -0) && Object.is(lowest, 0)) lowest = -0;
    if (number.value < lowest) lowest = number.value;
  }
  return F(lowest);
}

/** https://tc39.es/ecma262/#sec-math.pow */
function* Math_pow([base = Value.undefined, exponent = Value.undefined]: Arguments): ValueEvaluator {
  base = Q(yield* ToNumber(base));
  exponent = Q(yield* ToNumber(exponent));
  return NumberValue.exponentiate(base, exponent);
}

/** @param {bigint} h */
function fmix64(h: bigint) {
  h ^= h >> 33n;
  h *= 0xFF51AFD7ED558CCDn;
  h ^= h >> 33n;
  h *= 0xC4CEB9FE1A85EC53n;
  h ^= h >> 33n;
  return h;
}

const floatView = new Float64Array(1);
const big64View = new BigUint64Array(floatView.buffer);
/** https://tc39.es/ecma262/#sec-math.random */
function Math_random() {
  const realm = surroundingAgent.currentRealmRecord;
  if (realm.randomState === undefined) {
    const seed = realm.HostDefined.randomSeed
      ? BigInt(X(realm.HostDefined.randomSeed()))
      : BigInt(Math.round(Math.random() * (2 ** 32)));
    realm.randomState = new BigUint64Array([
      fmix64(BigInt.asUintN(64, seed)),
      fmix64(BigInt.asUintN(64, ~seed)),
    ]);
  }
  const s = realm.randomState;

  // XorShift128+
  let s1 = s[0];
  const s0 = s[1];
  s[0] = s0;
  s1 ^= s1 << 23n;
  s1 ^= s1 >> 17n;
  s1 ^= s0;
  s1 ^= s0 >> 26n;
  s[1] = s1;

  // Convert to double in [0, 1) range
  big64View[0] = (s0 >> 12n) | 0x3FF0000000000000n;
  const result = floatView[0] - 1;
  return F(result);
}

/** https://tc39.es/ecma262/#sec-math.round */
function* Math_round([x = Value.undefined]: Arguments): ValueEvaluator {
  const n = Q(yield* ToNumber(x));
  if (!n.isFinite() || n.isIntegralNumber()) return n;
  if (n.value < 0.5 && n.value > 0) return F(0);
  // eslint-disable-next-line no-compare-neg-zero
  if (n.value < -0 && n.value >= -0.5) return F(-0);
  return F(Math.round(n.value));
}

/** https://tc39.es/ecma262/#sec-math.sign */
function* Math_sign([x = Value.undefined]: Arguments): ValueEvaluator {
  const n = Q(yield* ToNumber(x));
  if (n.isNaN() || Object.is(n.value, 0) || Object.is(n.value, -0)) return n;
  if (n.value < 0) return F(-1);
  return F(1);
}

/** https://tc39.es/ecma262/#sec-math.sin */
function* Math_sin([x = Value.undefined]: Arguments): ValueEvaluator {
  const n = Q(yield* ToNumber(x));
  if (n.isNaN() || Object.is(n.value, 0) || Object.is(n.value, -0)) return n;
  if (n.isInfinity()) return F(NaN);
  return F(Math.sin(R(n)));
}

/** https://tc39.es/ecma262/#sec-math.sinh */
function* Math_sinh([x = Value.undefined]: Arguments): ValueEvaluator {
  const n = Q(yield* ToNumber(x));
  if (!n.isFinite() || Object.is(n.value, 0) || Object.is(n.value, -0)) return n;
  return F(Math.sinh(R(n)));
}

/** https://tc39.es/ecma262/#sec-math.sqrt */
function* Math_sqrt([x = Value.undefined]: Arguments): ValueEvaluator {
  const n = Q(yield* ToNumber(x));
  if (n.isNaN() || Object.is(n.value, 0) || Object.is(n.value, -0) || n.value === Infinity) return n;
  // eslint-disable-next-line no-compare-neg-zero
  if (n.value < -0) return F(NaN);
  return F(Math.sqrt(R(n)));
}

/** https://tc39.es/ecma262/#sec-math.sumprecise */
function* Math_sumPrecise([items = Value.undefined]: Arguments): ValueEvaluator {
  Q(RequireObjectCoercible(items));
  const iteratorRecord = Q(yield* GetIterator(items, 'sync'));
  let state: 'minus-zero' | 'not-a-number' | 'minus-infinity' | 'plus-infinity' | 'finite' = 'minus-zero';
  const sums: number[] = [];
  let count = 0;
  let next: 'not-started' | 'done' | Value = 'not-started';
  while (next !== 'done') {
    next = Q(yield* IteratorStepValue(iteratorRecord));
    if (next !== 'done') {
      if (count >= 2 ** 53 - 1) {
        const error = Throw.RangeError('$1 is out of range', '');
        return Q(yield* IteratorClose(iteratorRecord, error));
      }
      if (!(next instanceof NumberValue)) {
        const error = Throw.TypeError('$1 is not a number', next);
        return Q(yield* IteratorClose(iteratorRecord, error));
      }
      const n = next.value;
      if (state !== 'not-a-number') {
        if (Number.isNaN(n)) {
          state = 'not-a-number';
        } else if (n === Infinity) {
          if (state === 'minus-infinity') {
            state = 'not-a-number';
          } else {
            state = 'plus-infinity';
          }
        } else if (n === -Infinity) {
          if (state === 'plus-infinity') {
            state = 'not-a-number';
          } else {
            state = 'minus-infinity';
          }
        } else if (!Object.is(n, -0) && (state === 'minus-zero' || state === 'finite')) {
          state = 'finite';
          sums.push(n);
        }
      }
      count += 1;
    }
  }
  if (state === 'not-a-number') {
    return F(NaN);
  }
  if (state === 'plus-infinity') {
    return F(Infinity);
  }
  if (state === 'minus-infinity') {
    return F(-Infinity);
  }
  if (state === 'minus-zero') {
    return F(-0);
  }
  return F(sum(sums));

  function sum(items: number[]) {
    if ('sumPrecise' in Math) {
      // @ts-expect-error
      return Math.sumPrecise(items);
    }
    const fractional_parts: number[] = [];
    let whole_part_sum = 0n;
    items.forEach((n) => {
      const whole_num = Math.trunc(n);
      fractional_parts.push(n - whole_num);
      whole_part_sum += BigInt(whole_num);
    });
    const fractional_parts_as_hex = fractional_parts.map((n) => n.toString(32));

    const fractional: number[] = [];
    for (const fractional_str of fractional_parts_as_hex) {
      const neg = fractional_str[0] === '-';
      const prefix = neg ? 3 : 2; // -0.xxx or 0.xxx
      for (let index = prefix; index < fractional_str.length; index += 1) {
        fractional[index - prefix] ??= 0;
        if (neg) {
          fractional[index - prefix] -= parseInt(fractional_str[index], 32);
        } else {
          fractional[index - prefix] += parseInt(fractional_str[index], 32);
        }
      }
    }
    for (let index = fractional.length - 1; index >= 0; index -= 1) {
      const element = fractional[index];
      if (element >= 32) {
        fractional[index] = element % 32;
        fractional[index - 1] ??= 0;
        fractional[index - 1] += Math.floor(element / 32);
      }
      if (element < 0) {
        fractional[index] = 32 + element;
        fractional[index - 1] ??= 0;
        fractional[index - 1] -= 1;
      }
    }
    const fractional_part = fractional.reduceRight((acc, digit, index) => acc + digit * 32 ** -(index + 1), 0);
    if (fractional[-1]) {
      whole_part_sum += BigInt(fractional[-1]);
    }
    return Number(whole_part_sum) + fractional_part;
  }
}

/** https://tc39.es/ecma262/#sec-math.tan */
function* Math_tan([x = Value.undefined]: Arguments): ValueEvaluator {
  const n = Q(yield* ToNumber(x));
  if (n.isNaN() || Object.is(n.value, 0) || Object.is(n.value, -0)) return n;
  if (n.isInfinity()) return F(NaN);
  return F(Math.tan(R(n)));
}

/** https://tc39.es/ecma262/#sec-math.tanh */
function* Math_tanh([x = Value.undefined]: Arguments): ValueEvaluator {
  const n = Q(yield* ToNumber(x));
  if (n.isNaN() || Object.is(n.value, 0) || Object.is(n.value, -0)) return n;
  if (n.value === Infinity) return F(1);
  if (n.value === -Infinity) return F(-1);
  return F(Math.tanh(R(n)));
}

/** https://tc39.es/ecma262/#sec-math.trunc */
function* Math_trunc([x = Value.undefined]: Arguments): ValueEvaluator {
  const n = Q(yield* ToNumber(x));
  if (!n.isFinite() || Object.is(n.value, 0) || Object.is(n.value, -0)) return n;
  if (n.value < 1 && n.value > 0) return F(0);
  // eslint-disable-next-line no-compare-neg-zero
  if (n.value < -0 && n.value > -1) return F(-0);
  return F(Math.trunc(n.value));
}

/** https://tc39.es/ecma262/#sec-math-object */
export function bootstrapMath(realmRec: Realm) {
  /** https://tc39.es/ecma262/#sec-value-properties-of-the-math-object */
  const readonly = { Writable: false, Configurable: false };

  // @@toStringTag is handled in the bootstrapPrototype() call.
  const mathObj = bootstrapPrototype(realmRec, [
    ['E', F(2.718281828459045), undefined, readonly],
    ['LN10', F(2.302585092994046), undefined, readonly],
    ['LN2', F(0.6931471805599453), undefined, readonly],
    ['LOG10E', F(0.4342944819032518), undefined, readonly],
    ['LOG2E', F(1.4426950408889634), undefined, readonly],
    ['PI', F(3.141592653589793), undefined, readonly],
    ['SQRT1_2', F(0.7071067811865476), undefined, readonly],
    ['SQRT2', F(1.4142135623730951), undefined, readonly],
    ['abs', Math_abs, 1],
    ['acos', Math_acos, 1],
    ['acosh', Math_acosh, 1],
    ['asin', Math_asin, 1],
    ['asinh', Math_asinh, 1],
    ['atan', Math_atan, 1],
    ['atan2', Math_atan2, 2],
    ['atanh', Math_atanh, 1],
    ['cbrt', Math_cbrt, 1],
    ['ceil', Math_ceil, 1],
    ['clz32', Math_clz32, 1],
    ['cos', Math_cos, 1],
    ['cosh', Math_cosh, 1],
    ['exp', Math_exp, 1],
    ['expm1', Math_expm1, 1],
    ['f16round', Math_f16round, 1],
    ['floor', Math_floor, 1],
    ['fround', Math_fround, 1],
    ['hypot', Math_hypot, 2],
    ['imul', Math_imul, 2],
    ['log', Math_log, 1],
    ['log10', Math_log10, 1],
    ['log1p', Math_log1p, 1],
    ['log2', Math_log2, 1],
    ['max', Math_max, 2],
    ['min', Math_min, 2],
    ['pow', Math_pow, 2],
    ['random', Math_random, 0],
    ['round', Math_round, 1],
    ['sign', Math_sign, 1],
    ['sin', Math_sin, 1],
    ['sinh', Math_sinh, 1],
    ['sqrt', Math_sqrt, 1],
    ['sumPrecise', Math_sumPrecise, 1],
    ['tan', Math_tan, 1],
    ['tanh', Math_tanh, 1],
    ['trunc', Math_trunc, 1],
  ], realmRec.Intrinsics['%Object.prototype%'], 'Math');

  realmRec.Intrinsics['%Math%'] = mathObj;
}
