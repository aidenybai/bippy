import { HostMakeJobCallback } from '../execution-context/Job.mts';
import { type JobCallbackRecord } from '../execution-context/Job.mts';
import {
  UndefinedValue, Value, type Arguments, type FunctionCallContext,
} from '../value.mts';
import { Q } from '../completion.mts';
import type { Mutable } from '../utils/language.mts';
import { bootstrapConstructor } from './bootstrap.mts';
import { surroundingAgent } from '#self';
import {
  IsCallable, OrdinaryCreateFromConstructor,
  type BuiltinFunctionObject, type FunctionObject, type OrdinaryObject,
  Realm,
  Throw,
} from '#self';

export interface FinalizationRegistryCell {
  WeakRefTarget: Value | undefined;
  readonly HeldValue: Value;
  readonly UnregisterToken: Value | undefined;
}
export interface FinalizationRegistryObject extends OrdinaryObject {
  readonly Realm: Realm;
  readonly CleanupCallback: JobCallbackRecord;
  Cells: FinalizationRegistryCell[];
}
export function isFinalizationRegistryObject(object: object): object is FinalizationRegistryObject {
  return 'Cells' in object;
}
/** https://tc39.es/ecma262/#sec-finalization-registry-cleanup-callback */
function* FinalizationRegistryConstructor(this: BuiltinFunctionObject, [cleanupCallback = Value.undefined]: Arguments, { NewTarget }: FunctionCallContext) {
  // 1. If NewTarget is undefined, throw a TypeError exception.
  if (NewTarget instanceof UndefinedValue) {
    return Throw.TypeError('FinalizationRegistry cannot be invoked without new');
  }
  // 2. If IsCallable(cleanupCallback) is false, throw a TypeError exception.
  if (!IsCallable(cleanupCallback)) {
    return Throw.TypeError('$1 is not a function', cleanupCallback);
  }
  // 3. Let finalizationGroup be ? OrdinaryCreateFromConstructor(NewTarget, "%FinalizationRegistryPrototype%", « [[Realm]], [[CleanupCallback]], [[Cells]] »).
  const finalizationGroup = Q(yield* OrdinaryCreateFromConstructor(NewTarget, '%FinalizationRegistry.prototype%', [
    'Realm',
    'CleanupCallback',
    'Cells',
  ])) as Mutable<FinalizationRegistryObject>;
  // 4. Let fn be the active function object.
  const fn = surroundingAgent.activeFunctionObject;
  // 5. Set finalizationGroup.[[Realm]] to fn.[[Realm]].
  finalizationGroup.Realm = (fn as FunctionObject).Realm;
  // 6. Set finalizationGroup.[[CleanupCallback]] to HostMakeJobCallback(cleanupCallback).
  finalizationGroup.CleanupCallback = HostMakeJobCallback(cleanupCallback);
  // 7. Set finalizationGroup.[[Cells]] to be an empty List.
  finalizationGroup.Cells = [];
  // 8. Return finalizationGroup.
  return finalizationGroup as FinalizationRegistryObject;
}

export function bootstrapFinalizationRegistry(realmRec: Realm) {
  const cons = bootstrapConstructor(
    realmRec,
    FinalizationRegistryConstructor,
    'FinalizationRegistry',
    1,
    realmRec.Intrinsics['%FinalizationRegistry.prototype%'],
    [],
  );

  realmRec.Intrinsics['%FinalizationRegistry%'] = cons;
}
