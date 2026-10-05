import {
  ObjectValue,
  BooleanValue,
  Value,
  type Arguments,
  type FunctionCallContext,
} from '../value.mts';
import { Q, type ValueCompletion } from '../completion.mts';
import type { Mutable } from '../utils/language.mts';
import { bootstrapPrototype } from './bootstrap.mts';
import type { BooleanObject } from './Boolean.mts';
import { Assert, Throw } from '#self';
import type { Realm } from '#self';


export function ThisBooleanValue(value: Value) {
  if (value instanceof BooleanValue) {
    return value;
  }

  if (value instanceof ObjectValue && 'BooleanData' in value) {
    const b = value.BooleanData;
    Assert(typeof b === 'boolean');
    return Value(b);
  }

  return Throw.TypeError('$1 is not a $2 object', value, 'Boolean');
}

/** https://tc39.es/ecma262/#sec-boolean.prototype.tostring */
function BooleanProto_toString(_argList: Arguments, { thisValue }: FunctionCallContext): ValueCompletion {
  // 1. Let b be ? thisBooleanValue(this value).
  const b = Q(ThisBooleanValue(thisValue));
  // 2. If b is true, return "true"; else return "false".
  if (b === Value.true) {
    return Value('true');
  }
  return Value('false');
}

/** https://tc39.es/ecma262/#sec-boolean.prototype.valueof */
function BooleanProto_valueOf(_argList: Arguments, { thisValue }: FunctionCallContext): ValueCompletion {
  // 1. Return ? thisBooleanValue(this value).
  return Q(ThisBooleanValue(thisValue));
}

export function bootstrapBooleanPrototype(realmRec: Realm) {
  const proto = bootstrapPrototype(realmRec, [
    ['toString', BooleanProto_toString, 0],
    ['valueOf', BooleanProto_valueOf, 0],
  ], realmRec.Intrinsics['%Object.prototype%']);

  (proto as Mutable<BooleanObject>).BooleanData = false;

  realmRec.Intrinsics['%Boolean.prototype%'] = proto;
}
