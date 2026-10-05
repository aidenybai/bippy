import {
  NullValue, ObjectValue, Value,
} from '../value.mts';
import { Q } from '../completion.mts';
import type { PlainEvaluator } from '../evaluator.mts';
import { Assert, SameValue, type ExoticObject } from './all.mts';

export type ImmutablePrototypeObject = ExoticObject;
/** https://tc39.es/ecma262/#sec-set-immutable-prototype */
export function* SetImmutablePrototype(O: ObjectValue, V: Value): PlainEvaluator<boolean> {
  // 1. Assert: Either Type(V) is Object or Type(V) is Null.
  Assert(V instanceof ObjectValue || V instanceof NullValue);
  // 2. Let current be ? O.[[GetPrototypeOf]]().
  const current = Q(yield* O.GetPrototypeOf());
  // 3. If SameValue(V, current) is true, return true.
  if (SameValue(V, current)) {
    return true;
  }
  // 4. Return false.
  return false;
}
