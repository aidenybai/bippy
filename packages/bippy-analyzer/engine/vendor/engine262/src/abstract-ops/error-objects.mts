import { ObjectValue, Value, Descriptor } from '../value.mts';
import {
  Q, X, NormalCompletion, type ValueEvaluator,
} from '../completion.mts';
import type { ErrorObject } from '../intrinsics/Error.mts';
import { HasProperty, Get, DefinePropertyOrThrow } from './all.mts';

/** https://tc39.es/ecma262/#sec-errorobjects-install-error-cause */
export function* InstallErrorCause(O: ObjectValue, options: Value): ValueEvaluator {
  // 1. If Type(options) is Object and ? HasProperty(options, "cause") is true, then
  if (options instanceof ObjectValue) {
    // nested if statement due to macro expansion
    if (Q(yield* HasProperty(options, 'cause'))) {
      // a. Let cause be ? Get(options, "cause").
      const cause = Q(yield* Get(options, 'cause'));
      // b. Perform ! CreateNonEnumerableDataPropertyOrThrow(O, "cause", cause).
      X(DefinePropertyOrThrow(O, 'cause', Descriptor({
        Value: cause,
        Writable: true,
        Enumerable: false,
        Configurable: true,
      })));
    }
  }
  // 2. Return NormalCompletion(undefined).
  return NormalCompletion(Value.undefined);
}

/** https://tc39.es/proposal-is-error/#sec-iserror */
export function IsError(argument: Value): argument is ErrorObject {
  if (!(argument instanceof ObjectValue)) {
    return false;
  }
  if ('ErrorData' in argument) {
    return true;
  }
  return false;
}
