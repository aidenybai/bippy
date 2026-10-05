import {
  Descriptor,
  UndefinedValue,
  Value,
  type Arguments,
  type FunctionCallContext,
} from '../value.mts';
import { Q, X, type ValueEvaluator } from '../completion.mts';
import { captureStack } from '../utils/stack.mts';
import { setErrorHostInternalSlot } from './Error.mts';
import { bootstrapConstructor, bootstrapPrototype } from './bootstrap.mts';
import { ErrorHostInternalSlots, type ErrorObject } from './Error.mts';
import {
  surroundingAgent,
} from '#self';
import {
  DefinePropertyOrThrow,
  OrdinaryCreateFromConstructor,
  InstallErrorCause,
  ToString,
  Realm,
  type FunctionObject,
} from '#self';

const nativeErrorNames = [
  'EvalError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'TypeError',
  'URIError',
] as const;
export type NativeErrorNames = typeof nativeErrorNames[number];
export function bootstrapNativeError(realmRec: Realm) {
  for (const name of nativeErrorNames) {
    const proto = bootstrapPrototype(realmRec, [
      ['name', Value(name)],
      ['message', Value('')],
    ], realmRec.Intrinsics['%Error.prototype%']);

    /** https://tc39.es/ecma262/#sec-nativeerror */
    const Constructor = function* Constructor([message = Value.undefined, options = Value.undefined]: Arguments, { NewTarget }: FunctionCallContext): ValueEvaluator {
      // 1. If NewTarget is undefined, let newTarget be the active function object; else let newTarget be NewTarget.
      let newTarget;
      if (NewTarget instanceof UndefinedValue) {
        newTarget = surroundingAgent.activeFunctionObject;
      } else {
        newTarget = NewTarget;
      }
      // 2. Let O be ? OrdinaryCreateFromConstructor(newTarget, "%NativeError.prototype%", « [[ErrorData]] »).
      const O = Q(yield* OrdinaryCreateFromConstructor(newTarget as FunctionObject, `%${name}.prototype%`, [
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
      // NON-SPEC
      Q(yield* setErrorHostInternalSlot(O, captureStack()));
      return O;
    };
    Object.defineProperty(Constructor, 'name', {
      value: `${name}Constructor`,
      configurable: true,
    });

    const cons = bootstrapConstructor(realmRec, Constructor, name, 1, proto, []);
    cons.Prototype = realmRec.Intrinsics['%Error%'];

    realmRec.Intrinsics[`%${name}.prototype%`] = proto;
    realmRec.Intrinsics[`%${name}%`] = cons;
  }
}
