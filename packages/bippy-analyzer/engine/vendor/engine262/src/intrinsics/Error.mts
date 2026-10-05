import {
  Descriptor,
  Value,
  type Arguments,
  type FunctionCallContext,
  type ObjectValue,
} from '../value.mts';
import { Q, X, type ValueEvaluator } from '../completion.mts';
import {
  captureStack,
  callSiteToErrorStack,
} from '../utils/stack.mts';
import { type CallSite, CallFrame } from '../utils/stack.mts';
import { bootstrapConstructor } from './bootstrap.mts';
import { surroundingAgent } from '#self';
import {
  DefinePropertyOrThrow,
  OrdinaryCreateFromConstructor,
  InstallErrorCause,
  ToString,
  type FunctionObject,
  IsError,
  Realm,
  Call,
  JSStringValue,
  type PlainEvaluator,
} from '#self';

export interface ErrorObject extends ObjectValue {
  ErrorData: never;
  /** Show a clickable stack in the devtools */
  HostDefinedStack: readonly (CallSite | CallFrame)[] | undefined;
  /** Show an error message that allows ECMAScript values to be interleaved with host error messages in the devtools */
  HostDefinedMessage: readonly (string | Value)[] | undefined;
  HostDefinedFormattedStack: string | undefined;
  HostDefinedMessageString: string | undefined;
}

export const ErrorHostInternalSlots = Object.freeze([
  'HostDefinedStack',
  'HostDefinedMessage',
  'HostDefinedFormattedStack',
  'HostDefinedMessageString',
] as const);

export function* setErrorHostInternalSlot(O: ErrorObject, { nativeStack, stack }: ReturnType<typeof captureStack>, errorStringPredefined?: string): PlainEvaluator {
  const errorString = errorStringPredefined ?? (Q(yield* Call(surroundingAgent.intrinsic('%Error.prototype.toString%'), O)) as JSStringValue).stringValue();
  const errorStack = callSiteToErrorStack(stack, nativeStack);
  O.HostDefinedStack = stack;
  O.HostDefinedFormattedStack = errorStack;
  O.HostDefinedMessageString = errorString;
}

export { IsError as isErrorObject } from '../abstract-ops/error-objects.mts';

/** https://tc39.es/ecma262/#sec-error-constructor */
function* ErrorConstructor([message = Value.undefined, options = Value.undefined]: Arguments, { NewTarget }: FunctionCallContext): ValueEvaluator {
  // 1. If NewTarget is undefined, let newTarget be the active function object; else let newTarget be NewTarget.
  let newTarget;
  if (NewTarget === Value.undefined) {
    newTarget = surroundingAgent.activeFunctionObject;
  } else {
    newTarget = NewTarget;
  }
  // 2. Let O be ? OrdinaryCreateFromConstructor(newTarget, "%Error.prototype%", « [[ErrorData]] »).
  const O = Q(yield* OrdinaryCreateFromConstructor(newTarget as FunctionObject, '%Error.prototype%', [
    'ErrorData',
    ...ErrorHostInternalSlots,
  ])) as ErrorObject;
  // 3. If message is not undefined, then
  if (message !== Value.undefined) {
    // a. Let msg be ? ToString(message).
    const msg = Q(yield* ToString(message));
    // b. Let msgDesc be the PropertyDescriptor { [[Value]]: msg, [[Writable]]: true, [[Enumerable]]: false, [[Configurable]]: true }.
    const msgDesc = Descriptor({
      Value: Value(msg),
      Writable: true,
      Enumerable: false,
      Configurable: true,
    });
    // c. Perform ! DefinePropertyOrThrow(O, "message", msgDesc).
    X(DefinePropertyOrThrow(O, 'message', msgDesc));
  }

  // 4. Perform ? InstallErrorCause(O, options).
  Q(yield* InstallErrorCause(O, options));

  Q(yield* setErrorHostInternalSlot(O, captureStack()));

  // 5. Return O.
  return O;
}

/** https://tc39.es/proposal-is-error/#sec-error.iserror */
function Error_isError([value = Value.undefined]: Arguments) {
  return Value(IsError(value));
}

export function bootstrapError(realmRec: Realm) {
  const error = bootstrapConstructor(realmRec, ErrorConstructor, 'Error', 1, realmRec.Intrinsics['%Error.prototype%'], [
    ['isError', Error_isError, 1],
  ]);

  realmRec.Intrinsics['%Error%'] = error;
}
