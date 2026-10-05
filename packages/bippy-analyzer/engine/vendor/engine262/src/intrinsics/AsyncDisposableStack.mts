import { UndefinedValue, type Arguments, type FunctionCallContext } from '../value.mts';
import { Q } from '../completion.mts';
import type { Mutable } from '../utils/language.mts';
import type { DisposableResourceRecord } from '../abstract-ops/disposable-operations.mts';
import { bootstrapConstructor } from './bootstrap.mts';
import { OrdinaryCreateFromConstructor, Realm, Throw, type OrdinaryObject } from '#self';

export interface AsyncDisposableStackObject extends OrdinaryObject {
  AsyncDisposableState: 'pending' | 'disposed';
  DisposableResourceStack: DisposableResourceRecord[];
}

/** https://tc39.es/ecma262/#sec-asyncdisposablestack */
function* AsyncDisposableStackConstructor(_args: Arguments, { NewTarget }: FunctionCallContext) {
  if (NewTarget instanceof UndefinedValue) {
    return Throw.TypeError('AsyncDisposableStack cannot be invoked without new');
  }
  const asyncDisposableStack = Q(yield* OrdinaryCreateFromConstructor(
    NewTarget,
    '%AsyncDisposableStack.prototype%',
    ['AsyncDisposableState', 'DisposableResourceStack'],
  )) as Mutable<AsyncDisposableStackObject>;
  asyncDisposableStack.AsyncDisposableState = 'pending';
  asyncDisposableStack.DisposableResourceStack = [];
  return asyncDisposableStack;
}

export function bootstrapAsyncDisposableStack(realmRec: Realm) {
  realmRec.Intrinsics['%AsyncDisposableStack%'] = bootstrapConstructor(
    realmRec,
    AsyncDisposableStackConstructor,
    'AsyncDisposableStack',
    0,
    realmRec.Intrinsics['%AsyncDisposableStack.prototype%'],
  );
}
