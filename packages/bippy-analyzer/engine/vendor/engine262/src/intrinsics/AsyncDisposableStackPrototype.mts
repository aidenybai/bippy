import { Descriptor, Value, wellKnownSymbols, type Arguments, type FunctionCallContext } from '../value.mts';
import { NormalCompletion, Q, X, type ValueCompletion } from '../completion.mts';
import type { Mutable } from '../utils/language.mts';
import { AddDisposableResource, DisposeResources } from '../abstract-ops/disposable-operations.mts';
import { bootstrapPrototype } from './bootstrap.mts';
import type { AsyncDisposableStackObject } from './AsyncDisposableStack.mts';
import {
  Call,
  CreateBuiltinFunction,
  IsCallable,
  OrdinaryCreateFromConstructor,
  Realm,
  RequireInternalSlot,
  surroundingAgent,
  Throw,
  type ValueEvaluator,
} from '#self';

/** https://tc39.es/ecma262/#sec-asyncdisposablestack.prototype.adopt */
function* AsyncDisposableStackProto_adopt(
  [value = Value.undefined, onDisposeAsync = Value.undefined]: Arguments,
  { thisValue }: FunctionCallContext,
) {
  Q(RequireInternalSlot(thisValue, 'AsyncDisposableState'));
  const asyncDisposableStack = thisValue as AsyncDisposableStackObject;
  if (asyncDisposableStack.AsyncDisposableState === 'disposed') return Throw.ReferenceError('Object is disposed');
  if (!IsCallable(onDisposeAsync)) return Throw.TypeError('$1 is not a function', onDisposeAsync);
  const closure = function* closure(): ValueEvaluator {
    return Q(yield* Call(onDisposeAsync, Value.undefined, [value]));
  };
  const func = CreateBuiltinFunction(closure, 0, Value(''), []);
  Q(yield* AddDisposableResource(asyncDisposableStack.DisposableResourceStack, Value.undefined, 'async-dispose', func));
  return value;
}

/** https://tc39.es/ecma262/#sec-asyncdisposablestack.prototype.defer */
function* AsyncDisposableStackProto_defer(
  [onDisposeAsync = Value.undefined]: Arguments,
  { thisValue }: FunctionCallContext,
) {
  Q(RequireInternalSlot(thisValue, 'AsyncDisposableState'));
  const asyncDisposableStack = thisValue as AsyncDisposableStackObject;
  if (asyncDisposableStack.AsyncDisposableState === 'disposed') return Throw.ReferenceError('Object is disposed');
  if (!IsCallable(onDisposeAsync)) return Throw.TypeError('$1 is not a function', onDisposeAsync);
  Q(yield* AddDisposableResource(asyncDisposableStack.DisposableResourceStack, Value.undefined, 'async-dispose', onDisposeAsync));
  return Value.undefined;
}

/** https://tc39.es/ecma262/#sec-asyncdisposablestack.prototype.disposeAsync */
function* AsyncDisposableStackProto_disposeAsync(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  Q(RequireInternalSlot(thisValue, 'AsyncDisposableState'));
  const asyncDisposableStack = thisValue as AsyncDisposableStackObject;
  if (asyncDisposableStack.AsyncDisposableState === 'disposed') return Value.undefined;
  asyncDisposableStack.AsyncDisposableState = 'disposed';
  return Q(yield* DisposeResources(asyncDisposableStack.DisposableResourceStack, NormalCompletion(Value.undefined)));
}

/** https://tc39.es/ecma262/#sec-get-asyncdisposablestack.prototype.disposed */
function AsyncDisposableStackProto_disposed(_args: Arguments, { thisValue }: FunctionCallContext): ValueCompletion {
  Q(RequireInternalSlot(thisValue, 'AsyncDisposableState'));
  const asyncDisposableStack = thisValue as AsyncDisposableStackObject;
  if (asyncDisposableStack.AsyncDisposableState === 'disposed') return Value.true;
  return Value.false;
}

/** https://tc39.es/ecma262/#sec-asyncdisposablestack.prototype.move */
function* AsyncDisposableStackProto_move(_args: Arguments, { thisValue }: FunctionCallContext) {
  Q(RequireInternalSlot(thisValue, 'AsyncDisposableState'));
  const asyncDisposableStack = thisValue as AsyncDisposableStackObject;
  if (asyncDisposableStack.AsyncDisposableState === 'disposed') return Throw.ReferenceError('Object is disposed');
  const newStack = Q(yield* OrdinaryCreateFromConstructor(
    surroundingAgent.intrinsic('%AsyncDisposableStack%'),
    '%AsyncDisposableStack.prototype%',
    ['AsyncDisposableState', 'DisposableResourceStack'],
  )) as Mutable<AsyncDisposableStackObject>;
  newStack.AsyncDisposableState = 'pending';
  newStack.DisposableResourceStack = asyncDisposableStack.DisposableResourceStack;
  asyncDisposableStack.DisposableResourceStack = [];
  asyncDisposableStack.AsyncDisposableState = 'disposed';
  return newStack;
}

/** https://tc39.es/ecma262/#sec-asyncdisposablestack.prototype.use */
function* AsyncDisposableStackProto_use([value = Value.undefined]: Arguments, { thisValue }: FunctionCallContext) {
  Q(RequireInternalSlot(thisValue, 'AsyncDisposableState'));
  const asyncDisposableStack = thisValue as AsyncDisposableStackObject;
  if (asyncDisposableStack.AsyncDisposableState === 'disposed') return Throw.ReferenceError('Object is disposed');
  Q(yield* AddDisposableResource(asyncDisposableStack.DisposableResourceStack, value, 'async-dispose'));
  return value;
}

export function bootstrapAsyncDisposableStackPrototype(realmRec: Realm) {
  const prototype = bootstrapPrototype(realmRec, [
    ['adopt', AsyncDisposableStackProto_adopt, 2],
    ['defer', AsyncDisposableStackProto_defer, 1],
    ['disposeAsync', AsyncDisposableStackProto_disposeAsync, 0, undefined, true],
    ['disposed', [AsyncDisposableStackProto_disposed]],
    ['move', AsyncDisposableStackProto_move, 0],
    ['use', AsyncDisposableStackProto_use, 1],
  ], realmRec.Intrinsics['%Object.prototype%'], 'AsyncDisposableStack');
  X(prototype.DefineOwnProperty(wellKnownSymbols.asyncDispose, X(prototype.GetOwnProperty(Value('disposeAsync'))) as Descriptor));
  realmRec.Intrinsics['%AsyncDisposableStack.prototype%'] = prototype;
}
