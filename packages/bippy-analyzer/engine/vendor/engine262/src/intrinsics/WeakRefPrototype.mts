import { Q, X } from '../completion.mts';
import { bootstrapPrototype } from './bootstrap.mts';
import type { WeakRefObject } from './WeakRef.mts';
import { Realm, RequireInternalSlot, WeakRefDeref } from '#self';
import type { Arguments, ValueCompletion, FunctionCallContext } from '#self';

/** https://tc39.es/ecma262/#sec-weak-ref.prototype.deref */
function WeakRefProto_deref(_args: Arguments, { thisValue }: FunctionCallContext): ValueCompletion {
  // 1. Let weakRef be the this value.
  const weakRef = thisValue as WeakRefObject;
  // 2. Perform ? RequireInternalSlot(weakRef, [[WeakRefTarget]]).
  Q(RequireInternalSlot(weakRef, 'WeakRefTarget'));
  // 3. Return ! WeakRefDeref(weakRef).
  return X(WeakRefDeref(weakRef));
}

export function bootstrapWeakRefPrototype(realmRec: Realm) {
  const proto = bootstrapPrototype(realmRec, [
    ['deref', WeakRefProto_deref, 0],
  ], realmRec.Intrinsics['%Object.prototype%'], 'WeakRef');

  realmRec.Intrinsics['%WeakRef.prototype%'] = proto;
}
