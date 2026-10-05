import { NumberValue } from '../value.mts';
import {
  Assert, IsIntegralNumber, Z, R, Throw,
} from '#self';

/** https://tc39.es/ecma262/#sec-numbertobigint */
export function NumberToBigInt(number: NumberValue) {
  // 1. Assert: Type(number) is Number.
  Assert(number instanceof NumberValue);
  // 2. If IsIntegralNumber(number) is false, throw a RangeError exception.
  if (!IsIntegralNumber(number)) {
    return Throw.RangeError('Cannot convert $1 to a BigInt', number);
  }
  // 3. Return the BigInt value that represents the mathematical value of number.
  return Z(BigInt(R(number)));
}
