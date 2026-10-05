import decimal from 'jsbd';
import type { RoundOption } from 'jsbd/dist/type.js';
import { callable } from '../utils/language.mts';

const {
  BigDecimal,
  add: d_add, subtract: d_subtract, remainder: d_remainder, divide: d_divide, multiply: d_multiply,
  equal: d_equal, notEqual: d_notEqual,
  lessThan: d_lessThan, lessThanOrEqual: d_lessThanOrEqual, greaterThan: d_greaterThan, greaterThanOrEqual: d_greaterThanOrEqual,
} = (decimal.default || decimal);


export type DecimalInit = string | number | bigint | decimal.Decimal | Decimal;
// @ts-expect-error
export declare function Decimal(value: DecimalInit): Decimal;
@callable((_, _t, args) => new Decimal(args[0] as DecimalInit))
// @ts-expect-error
export class Decimal {
  private value: decimal.Decimal;

  private constructor(value: DecimalInit) {
    if (value instanceof Decimal) {
      this.value = value.value;
    } else {
      this.value = BigDecimal(value);
    }
  }

  add(other: DecimalInit, option?: RoundOption): Decimal {
    return new Decimal(d_add(this.value, new Decimal(other).value, option));
  }

  subtract(other: DecimalInit, option?: RoundOption): Decimal {
    return new Decimal(d_subtract(this.value, new Decimal(other).value, option));
  }

  multiply(other: DecimalInit, option?: RoundOption): Decimal {
    return new Decimal(d_multiply(this.value, new Decimal(other).value, option));
  }

  divide(other: DecimalInit, option?: RoundOption): Decimal {
    return new Decimal(d_divide(this.value, new Decimal(other).value, option));
  }

  remainder(other: DecimalInit, option?: RoundOption): Decimal {
    return new Decimal(d_remainder(this.value, new Decimal(other).value, option));
  }

  equals(other: DecimalInit): boolean {
    return d_equal(this.value, new Decimal(other).value);
  }

  notEqual(other: DecimalInit): boolean {
    return d_notEqual(this.value, new Decimal(other).value);
  }

  lessThan(other: DecimalInit): boolean {
    return d_lessThan(this.value, new Decimal(other).value);
  }

  lessThanOrEqual(other: DecimalInit): boolean {
    return d_lessThanOrEqual(this.value, new Decimal(other).value);
  }

  greaterThan(other: DecimalInit): boolean {
    return d_greaterThan(this.value, new Decimal(other).value);
  }

  greaterThanOrEqual(other: DecimalInit): boolean {
    return d_greaterThanOrEqual(this.value, new Decimal(other).value);
  }

  abs(): Decimal {
    if (this.lessThan(0)) {
      return new Decimal(this.multiply(-1));
    }
    return this;
  }

  negate(): Decimal {
    return new Decimal(this.multiply(-1));
  }

  toBigInt(): bigint {
    return BigInt(this.value.toString());
  }

  toNumber(): number {
    return Number(this.value.toString());
  }

  modulo(y: DecimalInit): Decimal {
    // (x % y + y) % y
    const yDecimal = new Decimal(y).value;
    return new Decimal(d_remainder(d_add(d_remainder(this.value, yDecimal), yDecimal), yDecimal));
  }

  truncate() {
    return new Decimal(this.value.toString().split('.')[0]);
  }

  floor() {
    const [integerPart, fractionalPart] = this.value.toString().split('.');
    if (fractionalPart && this.lessThan(0)) {
      return new Decimal(integerPart).subtract(1);
    }
    return new Decimal(integerPart);
  }

  ceil() {
    const [integerPart, fractionalPart] = this.value.toString().split('.');
    if (fractionalPart && this.greaterThan(0)) {
      return new Decimal(integerPart).add(1);
    }
    return new Decimal(integerPart);
  }
}
