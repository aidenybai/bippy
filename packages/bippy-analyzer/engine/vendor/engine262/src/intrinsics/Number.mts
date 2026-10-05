import {
  Descriptor,
  NumberValue,
  BigIntValue,
  Value,
  type Arguments,
  type FunctionCallContext,
  UndefinedValue,
} from '../value.mts';
import { Q, X, type ValueEvaluator } from '../completion.mts';
import type { Mutable } from '../utils/language.mts';
import { bootstrapConstructor } from './bootstrap.mts';
import {
  IsIntegralNumber,
  OrdinaryCreateFromConstructor,
  ToNumeric,
  F, R,
  Realm,
  type OrdinaryObject,
} from '#self';

export interface NumberObject extends OrdinaryObject {
  readonly NumberData: NumberValue;
}
export function isNumberObject(o: Value): o is NumberObject {
  return 'NumberData' in o;
}

/** https://tc39.es/ecma262/#sec-number-constructor-number-value */
function* NumberConstructor([value]: Arguments, { NewTarget }: FunctionCallContext): ValueEvaluator {
  let n;
  if (value !== undefined) {
    const prim = Q(yield* ToNumeric(value));
    if (prim instanceof BigIntValue) {
      n = F(Number(R(prim)));
    } else {
      n = prim;
    }
  } else {
    n = F(+0);
  }
  if (NewTarget instanceof UndefinedValue) {
    return n;
  }
  const O = (yield* OrdinaryCreateFromConstructor(NewTarget, '%Number.prototype%', ['NumberData'])) as Mutable<NumberObject>;
  O.NumberData = n;
  return O;
}

/** https://tc39.es/ecma262/#sec-number.isfinite */
function Number_isFinite([number = Value.undefined]: Arguments) {
  if (!(number instanceof NumberValue)) {
    return Value.false;
  }

  if (number.isNaN() || number.isInfinity()) {
    return Value.false;
  }
  return Value.true;
}

/** https://tc39.es/ecma262/#sec-number.isinteger */
function Number_isInteger([number = Value.undefined]: Arguments) {
  return Value(IsIntegralNumber(number));
}

/** https://tc39.es/ecma262/#sec-number.isnan */
function Number_isNaN([number = Value.undefined]: Arguments) {
  if (!(number instanceof NumberValue)) {
    return Value.false;
  }

  if (number.isNaN()) {
    return Value.true;
  }
  return Value.false;
}

/** https://tc39.es/ecma262/#sec-number.issafeinteger */
function Number_isSafeInteger([number = Value.undefined]: Arguments) {
  if (!(number instanceof NumberValue)) {
    return Value.false;
  }

  if (IsIntegralNumber(number)) {
    if (Math.abs(R(number)) <= (2 ** 53) - 1) {
      return Value.true;
    }
  }

  return Value.false;
}

export function bootstrapNumber(realmRec: Realm) {
  const override = {
    Writable: false,
    Enumerable: false,
    Configurable: false,
  };
  const numberConstructor = bootstrapConstructor(realmRec, NumberConstructor, 'Number', 1, realmRec.Intrinsics['%Number.prototype%'], [
    ['EPSILON', F(Number.EPSILON), undefined, override],
    ['MAX_SAFE_INTEGER', F(Number.MAX_SAFE_INTEGER), undefined, override],
    ['MAX_VALUE', F(Number.MAX_VALUE), undefined, override],
    ['MIN_SAFE_INTEGER', F(Number.MIN_SAFE_INTEGER), undefined, override],
    ['MIN_VALUE', F(Number.MIN_VALUE), undefined, override],
    ['NaN', F(NaN), undefined, override],
    ['NEGATIVE_INFINITY', F(-Infinity), undefined, override],
    ['POSITIVE_INFINITY', F(+Infinity), undefined, override],

    ['isFinite', Number_isFinite, 1],
    ['isInteger', Number_isInteger, 1],
    ['isNaN', Number_isNaN, 1],
    ['isSafeInteger', Number_isSafeInteger, 1],
  ]);

  /** https://tc39.es/ecma262/#sec-number.parsefloat */
  // The value of the Number.parseFloat data property is the same built-in function object that is the value of the parseFloat property of the global object defined in 18.2.4.
  X(numberConstructor.DefineOwnProperty(Value('parseFloat'), Descriptor({
    Value: realmRec.Intrinsics['%parseFloat%'],
    Writable: true,
    Enumerable: false,
    Configurable: true,
  })));

  /** https://tc39.es/ecma262/#sec-number.parseint */
  // The value of the Number.parseInt data property is the same built-in function object that is the value of the parseInt property of the global object defined in 18.2.5.
  X(numberConstructor.DefineOwnProperty(Value('parseInt'), Descriptor({
    Value: realmRec.Intrinsics['%parseInt%'],
    Writable: true,
    Enumerable: false,
    Configurable: true,
  })));

  realmRec.Intrinsics['%Number%'] = numberConstructor;
}
