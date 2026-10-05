import {
  Value,
  UndefinedValue,
  type Arguments,
  type FunctionCallContext,
} from '../value.mts';
import { Q, X, type ValueEvaluator } from '../completion.mts';
import { captureStack } from '../utils/stack.mts';
import { setErrorHostInternalSlot } from './Error.mts';
import { ErrorHostInternalSlots, type ErrorObject } from './Error.mts';
import { bootstrapConstructor } from './bootstrap.mts';
import {
  CreateNonEnumerableDataPropertyOrThrow,
  OrdinaryCreateFromConstructor,
  Realm,
  surroundingAgent,
  ToString,
  type FunctionObject,
} from '#self';

/** https://tc39.es/ecma262/#sec-suppressederror */
function* SuppressedErrorConstructor(
  [error = Value.undefined, suppressed = Value.undefined, message = Value.undefined]: Arguments,
  { NewTarget }: FunctionCallContext,
): ValueEvaluator {
  const newTarget = NewTarget instanceof UndefinedValue
    ? surroundingAgent.activeFunctionObject as FunctionObject
    : NewTarget;
  const obj = Q(yield* OrdinaryCreateFromConstructor(newTarget, '%SuppressedError.prototype%', [
    'ErrorData',
    ...ErrorHostInternalSlots,
  ])) as ErrorObject;
  if (message !== Value.undefined) {
    const messageString = Value(Q(yield* ToString(message)));
    X(CreateNonEnumerableDataPropertyOrThrow(obj, 'message', messageString));
  }
  X(CreateNonEnumerableDataPropertyOrThrow(obj, 'error', error));
  X(CreateNonEnumerableDataPropertyOrThrow(obj, 'suppressed', suppressed));
  Q(yield* setErrorHostInternalSlot(obj, captureStack()));
  return obj;
}

export function bootstrapSuppressedError(realmRec: Realm) {
  const constructor = bootstrapConstructor(
    realmRec,
    SuppressedErrorConstructor,
    'SuppressedError',
    3,
    realmRec.Intrinsics['%SuppressedError.prototype%'],
  );
  constructor.Prototype = realmRec.Intrinsics['%Error%'];
  realmRec.Intrinsics['%SuppressedError%'] = constructor;
}
