import {
  F,
} from './all.mts';
import {
  NumberValue, Value,
} from '#self';

// This file covers abstract operations defined in
// https://tc39.es/ecma262/#sec-abstract-operations-for-keyed-collections

/** https://tc39.es/ecma262/#sec-canonicalizekeyedcollectionkey */
export function CanonicalizeKeyedCollectionKey(key: Value): Value {
  if (key instanceof NumberValue && Object.is(key.value, -0)) return F(+0);
  return key;
}
