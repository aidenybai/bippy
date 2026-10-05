import { AddToKeptObjects } from '../execution-context/WeakReference.mts';
import {
  Value,
  type WeakRefObject,
} from '#self';

/** https://tc39.es/ecma262/#sec-weakrefderef */
export function WeakRefDeref(weakRef: WeakRefObject) {
  // 1. Let target be weakRef.[[WeakRefTarget]].
  const target = weakRef.WeakRefTarget;
  // 2. If target is not empty, then
  if (target !== undefined) {
    // a. Perform ! AddToKeptObjects(target).
    AddToKeptObjects(target);
    // b. Return target.
    return target;
  }
  // 3. Return undefined.
  return Value.undefined;
}
