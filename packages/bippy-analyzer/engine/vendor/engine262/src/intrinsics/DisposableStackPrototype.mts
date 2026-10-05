import { Descriptor, Value, wellKnownSymbols, type Arguments, type FunctionCallContext } from '../value.mts';
import { NormalCompletion, Q, X, type ValueCompletion } from '../completion.mts';
import type { Mutable } from '../utils/language.mts';
import { AddDisposableResource, DisposeResources } from '../abstract-ops/disposable-operations.mts';
import { bootstrapPrototype } from './bootstrap.mts';
import type { DisposableStackObject } from './DisposableStack.mts';
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

/** https://tc39.es/ecma262/#sec-disposablestack.prototype.adopt */
function* DisposableStackProto_adopt(
  [value = Value.undefined, onDispose = Value.undefined]: Arguments,
  { thisValue }: FunctionCallContext,
) {
  Q(RequireInternalSlot(thisValue, 'DisposableState'));
  const disposableStack = thisValue as DisposableStackObject;
  if (disposableStack.DisposableState === 'disposed') return Throw.ReferenceError('Object is disposed');
  if (!IsCallable(onDispose)) return Throw.TypeError('$1 is not a function', onDispose);
  const closure = function* closure(): ValueEvaluator {
    return Q(yield* Call(onDispose, Value.undefined, [value]));
  };
  const func = CreateBuiltinFunction(closure, 0, Value(''), []);
  Q(yield* AddDisposableResource(disposableStack.DisposableResourceStack, Value.undefined, 'sync-dispose', func));
  return value;
}

/** https://tc39.es/ecma262/#sec-disposablestack.prototype.defer */
function* DisposableStackProto_defer(
  [onDispose = Value.undefined]: Arguments,
  { thisValue }: FunctionCallContext,
) {
  Q(RequireInternalSlot(thisValue, 'DisposableState'));
  const disposableStack = thisValue as DisposableStackObject;
  if (disposableStack.DisposableState === 'disposed') return Throw.ReferenceError('Object is disposed');
  if (!IsCallable(onDispose)) return Throw.TypeError('$1 is not a function', onDispose);
  Q(yield* AddDisposableResource(disposableStack.DisposableResourceStack, Value.undefined, 'sync-dispose', onDispose));
  return Value.undefined;
}

/** https://tc39.es/ecma262/#sec-disposablestack.prototype.dispose */
function* DisposableStackProto_dispose(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  Q(RequireInternalSlot(thisValue, 'DisposableState'));
  const disposableStack = thisValue as DisposableStackObject;
  if (disposableStack.DisposableState === 'disposed') return Value.undefined;
  disposableStack.DisposableState = 'disposed';
  return Q(yield* DisposeResources(disposableStack.DisposableResourceStack, NormalCompletion(Value.undefined)));
}

/** https://tc39.es/ecma262/#sec-get-disposablestack.prototype.disposed */
function DisposableStackProto_disposed(_args: Arguments, { thisValue }: FunctionCallContext): ValueCompletion {
  Q(RequireInternalSlot(thisValue, 'DisposableState'));
  const disposableStack = thisValue as DisposableStackObject;
  if (disposableStack.DisposableState === 'disposed') return Value.true;
  return Value.false;
}

/** https://tc39.es/ecma262/#sec-disposablestack.prototype.move */
function* DisposableStackProto_move(_args: Arguments, { thisValue }: FunctionCallContext) {
  Q(RequireInternalSlot(thisValue, 'DisposableState'));
  const disposableStack = thisValue as DisposableStackObject;
  if (disposableStack.DisposableState === 'disposed') return Throw.ReferenceError('Object is disposed');
  const newDisposableStack = Q(yield* OrdinaryCreateFromConstructor(
    surroundingAgent.intrinsic('%DisposableStack%'),
    '%DisposableStack.prototype%',
    ['DisposableState', 'DisposableResourceStack'],
  )) as Mutable<DisposableStackObject>;
  newDisposableStack.DisposableState = 'pending';
  newDisposableStack.DisposableResourceStack = disposableStack.DisposableResourceStack;
  disposableStack.DisposableResourceStack = [];
  disposableStack.DisposableState = 'disposed';
  return newDisposableStack;
}

/** https://tc39.es/ecma262/#sec-disposablestack.prototype.use */
function* DisposableStackProto_use([value = Value.undefined]: Arguments, { thisValue }: FunctionCallContext) {
  Q(RequireInternalSlot(thisValue, 'DisposableState'));
  const disposableStack = thisValue as DisposableStackObject;
  if (disposableStack.DisposableState === 'disposed') return Throw.ReferenceError('Object is disposed');
  Q(yield* AddDisposableResource(disposableStack.DisposableResourceStack, value, 'sync-dispose'));
  return value;
}

export function bootstrapDisposableStackPrototype(realmRec: Realm) {
  const prototype = bootstrapPrototype(realmRec, [
    ['adopt', DisposableStackProto_adopt, 2],
    ['defer', DisposableStackProto_defer, 1],
    ['dispose', DisposableStackProto_dispose, 0],
    ['disposed', [DisposableStackProto_disposed]],
    ['move', DisposableStackProto_move, 0],
    ['use', DisposableStackProto_use, 1],
  ], realmRec.Intrinsics['%Object.prototype%'], 'DisposableStack');
  X(prototype.DefineOwnProperty(wellKnownSymbols.dispose, X(prototype.GetOwnProperty(Value('dispose'))) as Descriptor));
  realmRec.Intrinsics['%DisposableStack.prototype%'] = prototype;
}
