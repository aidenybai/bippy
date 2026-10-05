import {
  ObjectValue,
  SymbolValue,
  UndefinedValue, Value, type Arguments, type FunctionCallContext,
} from '../value.mts';
import { Q } from '../completion.mts';
import type { Mutable } from '../utils/language.mts';
import { bootstrapConstructor } from './bootstrap.mts';
import {
  AddToKeptObjects, CanBeHeldWeakly, OrdinaryCreateFromConstructor, Realm, Throw, type FunctionObject, type OrdinaryObject,
} from '#self';

export interface WeakRefObject extends OrdinaryObject {
  WeakRefTarget: ObjectValue | SymbolValue | undefined;
}
export function isWeakRef(object: object): object is WeakRefObject {
  return 'WeakRefTarget' in object && !('HeldValue' in object);
}
/** https://tc39.es/ecma262/#sec-weak-ref-target */
function* WeakRefConstructor(this: FunctionObject, [target = Value.undefined]: Arguments, { NewTarget }: FunctionCallContext) {
  // 1. If NewTarget is undefined, throw a TypeError exception.
  if (NewTarget instanceof UndefinedValue) {
    return Throw.TypeError('WeakRef cannot be invoked without new');
  }
  // 2. If CanBeHeldWeakly(target) is false, throw a TypeError exception.
  if (!CanBeHeldWeakly(target)) {
    return Throw.TypeError('$1 cannot be weakly referenced', target);
  }
  // 3. Let weakRef be ? OrdinaryCreateFromConstructor(NewTarget, "%WeakRefPrototype%", « [[WeakRefTarget]] »).
  const weakRef = Q(yield* OrdinaryCreateFromConstructor(NewTarget, '%WeakRef.prototype%', ['WeakRefTarget'])) as Mutable<WeakRefObject>;
  // 4. Perform ! AddToKeptObjects(target).
  AddToKeptObjects(target);
  // 5. Set weakRef.[[WeakRefTarget]] to target.
  weakRef.WeakRefTarget = target;
  // 6. Return weakRef
  return weakRef;
}

export function bootstrapWeakRef(realmRec: Realm) {
  const weakRefConstructor = bootstrapConstructor(realmRec, WeakRefConstructor, 'WeakRef', 1, realmRec.Intrinsics['%WeakRef.prototype%'], []);

  realmRec.Intrinsics['%WeakRef%'] = weakRefConstructor;
}
