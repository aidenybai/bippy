import {
  Completion,
  EnsureCompletion,
  IfAbruptRejectPromise,
  NormalCompletion,
  Q,
  ThrowCompletion,
  X,
  Await,
  type ValueEvaluator,
} from '../completion.mts';
import type { Evaluator, PlainEvaluator } from '../evaluator.mts';
import {
  ObjectValue,
  UndefinedValue,
  Value,
  wellKnownSymbols,
  type FunctionCallContext,
} from '../value.mts';
import {
  Assert,
  Call,
  Construct,
  CreateBuiltinFunction,
  CreateNonEnumerableDataPropertyOrThrow,
  GetMethod,
  intrinsics,
  NewPromiseCapability,
  Throw,
  type Arguments,
  type FunctionObject,
} from '#self';

export type DisposableResourceKind = 'sync-dispose' | 'async-dispose';

export interface DisposableResourceRecord {
  readonly ResourceValue: ObjectValue | UndefinedValue;
  readonly Kind: DisposableResourceKind;
  readonly DisposeMethod: FunctionObject | UndefinedValue;
}


/** https://tc39.es/ecma262/#sec-adddisposableresource */
export function* AddDisposableResource(
  disposableResourceStack: DisposableResourceRecord[],
  value: Value,
  kind: DisposableResourceKind,
  method?: FunctionObject,
): PlainEvaluator<void> {
  let resource: DisposableResourceRecord;
  if (method !== undefined) {
    Assert(value === Value.undefined);
    resource = Q(yield* CreateDisposableResource(Value.undefined, kind, method));
  } else {
    if ((value === Value.null || value === Value.undefined) && kind === 'sync-dispose') {
      return;
    }
    resource = Q(yield* CreateDisposableResource(value, kind));
  }
  disposableResourceStack.push(resource);
  return undefined;
}

/** https://tc39.es/ecma262/#sec-createdisposableresource */
export function* CreateDisposableResource(
  _value: Value,
  kind: DisposableResourceKind,
  _method?: FunctionObject,
): PlainEvaluator<DisposableResourceRecord> {
  let value: ObjectValue | UndefinedValue;
  let method: FunctionObject | UndefinedValue;
  if (_method === undefined) {
    if (_value === Value.null || _value === Value.undefined) {
      value = Value.undefined;
      method = Value.undefined;
    } else {
      method = Q(yield* GetDisposeMethod(_value, kind));
      if (method === Value.undefined) {
        return Throw.TypeError('$1 is not a function', method);
      }
      value = _value as ObjectValue;
    }
  } else {
    Assert(_value === Value.undefined);
    value = Value.undefined;
    method = _method;
  }
  return { ResourceValue: value!, Kind: kind, DisposeMethod: method! };
}

/** https://tc39.es/ecma262/#sec-getdisposemethod */
export function* GetDisposeMethod(value: Value, kind: DisposableResourceKind): ValueEvaluator<FunctionObject | UndefinedValue> {
  if (!(value instanceof ObjectValue)) {
    return Throw.TypeError('$1 is not an object', value);
  }
  if (kind === 'sync-dispose') {
    return Q(yield* GetMethod(value, wellKnownSymbols.dispose));
  }
  Assert(kind === 'async-dispose');
  const asyncMethod = Q(yield* GetMethod(value, wellKnownSymbols.asyncDispose));
  if (asyncMethod !== Value.undefined) {
    return asyncMethod;
  }
  const syncMethod = Q(yield* GetMethod(value, wellKnownSymbols.dispose));
  if (syncMethod === Value.undefined) {
    return Value.undefined;
  }
  const closure = function* closure(_args: Arguments, { thisValue }: FunctionCallContext) {
    const obj = thisValue;
    const promiseCapability = X(NewPromiseCapability(intrinsics()['%Promise%']));
    const result = yield* Call(syncMethod, obj);
    IfAbruptRejectPromise(result, promiseCapability);
    X(Call(promiseCapability.Resolve, Value.undefined, [Value.undefined]));
    return promiseCapability.Promise;
  };
  return CreateBuiltinFunction(closure, 0, Value(''), []);
}

/** https://tc39.es/ecma262/#sec-disposeresources */
export function* DisposeResources<C extends Completion<unknown>>(
  disposableResourceStack: DisposableResourceRecord[],
  completion: C,
): Evaluator<C | ThrowCompletion> {
  let needsAwait = false;
  let hasAwaited = false;
  let outputCompletion: C | ThrowCompletion = completion;
  for (const resource of disposableResourceStack.toReversed()) {
    const value = resource.ResourceValue;
    const kind = resource.Kind;
    const method = resource.DisposeMethod;
    if (kind === 'sync-dispose' && needsAwait && !hasAwaited) {
      // note: do not remove yield* here, because X will skip async control flow
      X(yield* Await(Value.undefined));
      needsAwait = false;
    }
    if (method !== Value.undefined) {
      let result = EnsureCompletion(yield* Call(method, value));
      if (result instanceof NormalCompletion && kind === 'async-dispose') {
        result = EnsureCompletion(yield* Await(result.Value));
        hasAwaited = true;
      }
      if (result instanceof ThrowCompletion) {
        if (outputCompletion instanceof ThrowCompletion) {
          const result_ = result.Value;
          const suppressed = outputCompletion.Value;
          const error = X(Construct(intrinsics()['%SuppressedError%'], []));
          CreateNonEnumerableDataPropertyOrThrow(error, 'error', result_);
          CreateNonEnumerableDataPropertyOrThrow(error, 'suppressed', suppressed);
          outputCompletion = ThrowCompletion(error);
        } else {
          outputCompletion = result;
        }
      }
    } else {
      Assert(kind === 'async-dispose');
      needsAwait = true;
    }
  }
  if (needsAwait && !hasAwaited) {
    // note: do not remove yield* here, because X will skip async control flow
    X(yield* Await(Value.undefined));
  }
  // Note: NOTE: At this point disposableResourceStack will never be used again. The contents of disposableResourceStack can be discarded in implementations, such as by garbage collection.
  disposableResourceStack.length = 0;
  return outputCompletion;
}
