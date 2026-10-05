import { Value, UndefinedValue, type Arguments, type FunctionCallContext } from '../value.mts';
import { Q } from '../completion.mts';
import type { Mutable } from '../utils/language.mts';
import type { DisposableResourceRecord } from '../abstract-ops/disposable-operations.mts';
import { bootstrapConstructor } from './bootstrap.mts';
import {
  OrdinaryCreateFromConstructor,
  Realm,
  Throw,
  type OrdinaryObject,
} from '#self';

export interface DisposableStackObject extends OrdinaryObject {
  DisposableState: 'pending' | 'disposed';
  DisposableResourceStack: DisposableResourceRecord[];
}

/** https://tc39.es/ecma262/#sec-disposablestack */
function* DisposableStackConstructor(_args: Arguments, { NewTarget }: FunctionCallContext) {
  if (NewTarget instanceof UndefinedValue) {
    return Throw.TypeError('$1 cannot be invoked without new', Value('DisposableStack'));
  }
  const disposableStack = Q(yield* OrdinaryCreateFromConstructor(
    NewTarget,
    '%DisposableStack.prototype%',
    ['DisposableState', 'DisposableResourceStack'],
  )) as Mutable<DisposableStackObject>;
  disposableStack.DisposableState = 'pending';
  disposableStack.DisposableResourceStack = [];
  return disposableStack;
}

export function bootstrapDisposableStack(realmRec: Realm) {
  realmRec.Intrinsics['%DisposableStack%'] = bootstrapConstructor(
    realmRec,
    DisposableStackConstructor,
    'DisposableStack',
    0,
    realmRec.Intrinsics['%DisposableStack.prototype%'],
  );
}
