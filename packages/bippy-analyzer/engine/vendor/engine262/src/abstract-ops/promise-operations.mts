import {
  HostEnqueuePromiseJob,
  HostMakeJobCallback,
  HostCallJobCallback,
} from '../execution-context/Job.mts';
import {
  ObjectValue, Value, UndefinedValue, type Arguments,
} from '../value.mts';
import {
  AbruptCompletion,
  EnsureCompletion,
  NormalCompletion,
  Q,
  ThrowCompletion,
  X,
} from '../completion.mts';
import type { PlainEvaluator } from '../evaluator.mts';
import {
  Assert,
  Call,
  Construct,
  CreateBuiltinFunction,
  Get,
  IsCallable,
  IsConstructor,
  SameValue,
  GetFunctionRealm,
  isFunctionObject,
  type BuiltinFunctionObject,
} from './all.mts';
import {
  HostPromiseRejectionTracker,
  surroundingAgent,
} from '#self';
import {
  Throw,
  type Realm,
  type ValueEvaluator, type JobCallbackRecord, type PromiseObject,
  type ValueCompletion,
  type FunctionObject,
} from '#self';

// This file covers abstract operations defined in
/** https://tc39.es/ecma262/#sec-promise-objects */


/** https://tc39.es/ecma262/#sec-promise.all-resolve-element-functions */
export interface PromiseAllResolveElementFunctionObject extends BuiltinFunctionObject {
  readonly Index: number;
  readonly AlreadyCalled: { Value: boolean };
}

/** https://tc39.es/ecma262/#sec-promise.any-reject-element-functions */
export interface PromiseAllRejectElementFunctionObject extends BuiltinFunctionObject {
  readonly Index: number;
  readonly AlreadyCalled: { Value: boolean };
}

/** https://tc39.es/ecma262/#sec-promisecapability-records */
export class PromiseCapabilityRecord {
  constructor(value: PromiseCapabilityRecord) {
    this.Promise = value.Promise;
    this.Resolve = value.Resolve;
    this.Reject = value.Reject;
  }

  readonly Promise: PromiseObject;

  readonly Resolve: FunctionObject;

  readonly Reject: FunctionObject;
}

/** https://tc39.es/ecma262/#sec-promisereaction-records */
export class PromiseReactionRecord {
  readonly Capability: PromiseCapabilityRecord | undefined;

  readonly Type: 'Fulfill' | 'Reject';

  readonly Handler: JobCallbackRecord | undefined;

  constructor(O: PromiseReactionRecord) {
    Assert(O.Capability instanceof PromiseCapabilityRecord
        || O.Capability === undefined);
    Assert(O.Type === 'Fulfill' || O.Type === 'Reject');
    Assert(O.Handler === undefined
           || isFunctionObject(O.Handler.Callback));
    this.Capability = O.Capability;
    this.Type = O.Type;
    this.Handler = O.Handler;
  }
}

/** https://tc39.es/ecma262/#sec-createresolvingfunctions */
export function CreateResolvingFunctions(toResolve: PromiseObject) {
  const promiseOrEmpty: { Value: PromiseObject | undefined } = { Value: toResolve };
  // 2. Let resolveSteps be the algorithm steps defined in Promise Resolve Functions.
  const resolveSteps = function* PromiseResolveFunctions([resolution = Value.undefined]: Arguments): ValueEvaluator {
    if (!promiseOrEmpty.Value) {
      return Value.undefined;
    }
    const promise = promiseOrEmpty.Value;
    Q(surroundingAgent.debugger_tryTouchDuringPreview(promise));
    promiseOrEmpty.Value = undefined;
    // 7. If SameValue(resolution, promise) is true, then
    if (SameValue(resolution, promise)) {
      // a. Let selfResolutionError be a newly created TypeError object.
      const selfResolutionError = Throw.TypeError('Cannot resolve a promise $1 with itself', promise).Value;
      // b. Return RejectPromise(promise, selfResolutionError).
      RejectPromise(promise, selfResolutionError);
      return Value.undefined;
    }
    // 8. If Type(resolution) is not Object, then
    if (!(resolution instanceof ObjectValue)) {
      // a. Return FulfillPromise(promise, resolution).
      FulfillPromise(promise, resolution);
      return Value.undefined;
    }
    // 9. Let then be Get(resolution, "then").
    const then = EnsureCompletion(yield* Get(resolution, 'then'));
    // 10. If then is an abrupt completion, then
    if (then instanceof AbruptCompletion) {
      // a. Return RejectPromise(promise, then.[[Value]]).
      RejectPromise(promise, then.Value);
      return Value.undefined;
    }
    // 11. Let thenAction be then.[[Value]].
    const thenAction = then.Value;
    // 12. If IsCallable(thenAction) is false, then
    if (!IsCallable(thenAction)) {
      // a. Return FulfillPromise(promise, resolution).
      FulfillPromise(promise, resolution);
      return Value.undefined;
    }
    if (surroundingAgent.debugger_isPreviewing) {
      return Value.undefined;
    }
    // 13. Let thenJobCallback be HostMakeJobCallback(thenAction).
    const thenJobCallback = HostMakeJobCallback(thenAction);
    // 14. Let job be NewPromiseResolveThenableJob(promise, resolution, thenJobCallback).
    const job = NewPromiseResolveThenableJob(promise, resolution, thenJobCallback);
    // 15. Perform HostEnqueuePromiseJob(job.[[Job]], job.[[Realm]]).
    HostEnqueuePromiseJob(job.Job, job.Realm);
    // 16. Return undefined.
    return Value.undefined;
  };
  // 4. Let resolve be CreateBuiltinFunction(resolveSteps, 1, "", « »).
  const resolve = CreateBuiltinFunction(resolveSteps, 1, Value(''), []);
  // 7. Let rejectSteps be the algorithm steps defined in Promise Reject Functions.
  const rejectSteps = function PromiseRejectFunctions([reason = Value.undefined]: Arguments): ValueCompletion<UndefinedValue> {
    if (!promiseOrEmpty.Value) {
      return Value.undefined;
    }
    const promise = promiseOrEmpty.Value;
    Q(surroundingAgent.debugger_tryTouchDuringPreview(promise));
    promiseOrEmpty.Value = undefined;
    RejectPromise(promise, reason);
    return Value.undefined;
  };
  // 9. Let reject be CreateBuiltinFunction(rejectSteps, 1, "", « »).
  const reject = CreateBuiltinFunction(rejectSteps, 1, Value(''), []);
  // 12. Return the Record { [[Resolve]]: resolve, [[Reject]]: reject }.
  return {
    Resolve: resolve,
    Reject: reject,
  };
}

/** https://tc39.es/ecma262/#sec-newpromiseresolvethenablejob */
function NewPromiseResolveThenableJob(promiseToResolve: PromiseObject, thenable: Value, then: JobCallbackRecord) {
  // 1. Let job be a new Job abstract closure with no parameters that captures
  //    promiseToResolve, thenable, and then and performs the following steps when called:
  function* job(): PlainEvaluator {
    // a. Let resolvingFunctions be CreateResolvingFunctions(promiseToResolve).
    const resolvingFunctions = CreateResolvingFunctions(promiseToResolve);
    // b. Let thenCallResult be HostCallJobCallback(then, thenable, « resolvingFunctions.[[Resolve]], resolvingFunctions.[[Reject]] »).
    const thenCallResult = yield* HostCallJobCallback(then, thenable, [resolvingFunctions.Resolve, resolvingFunctions.Reject]);
    // c. If thenCallResult is an abrupt completion, then
    if (thenCallResult instanceof AbruptCompletion) {
      Q(yield* Call(resolvingFunctions.Reject, Value.undefined, [thenCallResult.Value]));
      return;
    }
    // d. Return ! thenCallResult.
    X(thenCallResult);
  }
  // 2. Let getThenRealmResult be GetFunctionRealm(then.[[Callback]]).
  const getThenRealmResult = EnsureCompletion(GetFunctionRealm(then.Callback));
  // 3. If getThenRealmResult is a normal completion, then let thenRealm be getThenRealmResult.[[Value]].
  let thenRealm;
  if (getThenRealmResult instanceof NormalCompletion) {
    thenRealm = getThenRealmResult.Value;
  } else {
    // 4. Else, let _thenRealm_ be the current Realm Record.
    thenRealm = surroundingAgent.currentRealmRecord;
  }
  // 5. NOTE: _thenRealm_ is never *null*. When _then_.[[Callback]] is a revoked Proxy and no code runs, _thenRealm_ is used to create error objects.
  // 6. Return { [[Job]]: job, [[Realm]]: thenRealm }.
  return { Job: job, Realm: thenRealm };
}

/** https://tc39.es/ecma262/#sec-fulfillpromise */
function FulfillPromise(promise: PromiseObject, value: Value) {
  Assert(promise.PromiseState === 'pending');
  const reactions = promise.PromiseFulfillReactions;
  promise.PromiseResult = value;
  promise.PromiseFulfillReactions = undefined;
  promise.PromiseRejectReactions = undefined;
  promise.PromiseState = 'fulfilled';
  return TriggerPromiseReactions(reactions!, value);
}

/** https://tc39.es/ecma262/#sec-newpromisecapability */
export function* NewPromiseCapability(constructor: Value): PlainEvaluator<PromiseCapabilityRecord> {
  if (!IsConstructor(constructor)) {
    return Throw.TypeError('$1 is not a Promise constructor', constructor);
  }
  const resolvingFunctions = { Resolve: Value.undefined as Value, Reject: Value.undefined as Value };
  const executorClosure = ([resolve = Value.undefined, reject = Value.undefined]: Arguments) => {
    if (resolvingFunctions.Resolve !== Value.undefined) {
      return Throw.TypeError('Promise resolve function already set');
    }
    if (resolvingFunctions.Reject !== Value.undefined) {
      return Throw.TypeError('Promise reject function already set');
    }
    resolvingFunctions.Resolve = resolve;
    resolvingFunctions.Reject = reject;
    return Value.undefined;
  };
  const executor = X(CreateBuiltinFunction(executorClosure, 2, Value(''), []));
  const promise = Q(yield* Construct(constructor, [executor])) as PromiseObject;
  if (!IsCallable(resolvingFunctions.Resolve)) {
    return Throw.TypeError('Promise resolve function $1 is not callable', resolvingFunctions.Resolve || Value.undefined);
  }
  if (!IsCallable(resolvingFunctions.Reject)) {
    return Throw.TypeError('Promise reject function $1 is not callable', resolvingFunctions.Reject || Value.undefined);
  }
  return new PromiseCapabilityRecord({
    Promise: promise,
    Resolve: resolvingFunctions.Resolve,
    Reject: resolvingFunctions.Reject,
  });
}

/** https://tc39.es/ecma262/#sec-ispromise */
export function IsPromise(x: Value): boolean {
  if (!(x instanceof ObjectValue)) {
    return false;
  }
  if (!('PromiseState' in x)) {
    return false;
  }
  return true;
}

/** https://tc39.es/ecma262/#sec-rejectpromise */
function RejectPromise(promise: PromiseObject, reason: Value) {
  Assert(promise.PromiseState === 'pending');
  const reactions = promise.PromiseRejectReactions;
  promise.PromiseResult = reason;
  promise.PromiseFulfillReactions = undefined;
  promise.PromiseRejectReactions = undefined;
  promise.PromiseState = 'rejected';
  if (!promise.PromiseIsHandled) {
    HostPromiseRejectionTracker(promise, 'reject');
  }
  return TriggerPromiseReactions(reactions!, reason);
}

/** https://tc39.es/ecma262/#sec-triggerpromisereactions */
function TriggerPromiseReactions(reactions: readonly PromiseReactionRecord[], argument: Value) {
  // 1. For each reaction in reactions, do
  reactions.forEach((reaction) => {
    // a. Let job be NewPromiseReactionJob(reaction, argument).
    const job = NewPromiseReactionJob(reaction, argument);
    // b. Perform HostEnqueuePromiseJob(job.[[Job]], job.[[Realm]]).
    HostEnqueuePromiseJob(job.Job, job.Realm);
  });
  // 2. Return undefined.
  return Value.undefined;
}

/** https://tc39.es/ecma262/#sec-promise-resolve */
export function* PromiseResolve(constructor: ObjectValue, resolution: Value): ValueEvaluator<PromiseObject> {
  Assert(constructor instanceof ObjectValue);
  if (IsPromise(resolution)) {
    const xConstructor = Q(yield* Get(resolution as PromiseObject, 'constructor'));
    if (SameValue(xConstructor, constructor)) {
      return resolution as PromiseObject;
    }
  }
  const promiseCapability = Q(yield* NewPromiseCapability(constructor));
  Q(yield* Call(promiseCapability.Resolve, Value.undefined, [resolution]));
  return promiseCapability.Promise;
}

/** https://tc39.es/ecma262/#sec-newpromisereactionjob */
function NewPromiseReactionJob(reaction: PromiseReactionRecord, argument: Value) {
  // 1. Let job be a new Job abstract closure with no parameters that captures
  //    reaction and argument and performs the following steps when called:
  function* job(): PlainEvaluator {
    // a. Assert: reaction is a PromiseReaction Record.
    Assert(reaction instanceof PromiseReactionRecord);
    // b. Let promiseCapability be reaction.[[Capability]].
    const promiseCapability = reaction.Capability;
    // c. Let type be reaction.[[Type]].
    const type = reaction.Type;
    // d. Let handler be reaction.[[Handler]].
    const handler = reaction.Handler;
    let handlerResult: ValueCompletion;
    // e. If handler is empty, then
    if (handler === undefined) {
      // i. If type is Fulfill, let handlerResult be NormalCompletion(argument).
      if (type === 'Fulfill') {
        handlerResult = NormalCompletion(argument);
      } else {
        // 1. Assert: type is Reject.
        Assert(type === 'Reject');
        // 2. Let handlerResult be ThrowCompletion(argument).
        handlerResult = ThrowCompletion(argument);
      }
    } else {
      // f. Else, let handlerResult be HostCallJobCallback(handler, undefined, « argument »).
      handlerResult = yield* HostCallJobCallback(handler, Value.undefined, [argument]);
    }
    // g. If promiseCapability is undefined, then
    if (!promiseCapability) {
      // i. Assert: handlerResult is not an abrupt completion.
      Assert(!(handlerResult instanceof AbruptCompletion));
      // ii. Return NormalCompletion(empty).
      return NormalCompletion(undefined);
    }
    let status;
    // h. If handlerResult is an abrupt completion, then
    if (handlerResult instanceof AbruptCompletion) {
      // i. Let status be Call(promiseCapability.[[Reject]], undefined, « handlerResult.[[Value]] »).
      status = Q(yield* Call(promiseCapability.Reject, Value.undefined, [handlerResult.Value]));
    } else {
      // ii. Let status be Call(promiseCapability.[[Resolve]], undefined, « handlerResult.[[Value]] »).
      status = Q(yield* Call(promiseCapability.Resolve, Value.undefined, [X(handlerResult)]));
    }
    // j. Return Completion(status).
    Q(status);
    return undefined;
  }
  // 2. Let handlerRealm be null.
  let handlerRealm: null | Realm = null;
  // 3. If reaction.[[Handler]] is not empty, then
  if (reaction.Handler !== undefined) {
    // a. Let getHandlerRealmResult be GetFunctionRealm(reaction.[[Handler]].[[Callback]]).
    const getHandlerRealmResult = EnsureCompletion(GetFunctionRealm(reaction.Handler.Callback));
    // b. If getHandlerRealmResult is a normal completion, then set handlerRealm to getHandlerRealmResult.[[Value]].
    if (getHandlerRealmResult instanceof NormalCompletion) {
      handlerRealm = getHandlerRealmResult.Value;
    } else {
      // c. Else, set _handlerRealm_ to the current Realm Record.
      handlerRealm = surroundingAgent.currentRealmRecord;
    }
    // d. NOTE: _handlerRealm_ is never *null* unless the handler is *undefined*. When the handler
    //    is a revoked Proxy and no ECMAScript code runs, _handlerRealm_ is used to create error objects.
  }
  // 4. Return { [[Job]]: job, [[Realm]]: handlerRealm }.
  return { Job: job, Realm: handlerRealm };
}

/** https://tc39.es/ecma262/#sec-performpromisethen */
export function PerformPromiseThen(promise: PromiseObject, onFulfilled: Value, onRejected: Value, resultCapability: PromiseCapabilityRecord): PromiseObject
export function PerformPromiseThen(promise: PromiseObject, onFulfilled: Value, onRejected: Value, resultCapability?: undefined): undefined
export function PerformPromiseThen(promise: PromiseObject, onFulfilled: Value, onRejected: Value, resultCapability?: PromiseCapabilityRecord | undefined): PromiseObject | undefined
export function PerformPromiseThen(promise: PromiseObject, onFulfilled: Value, onRejected: Value, resultCapability?: PromiseCapabilityRecord | undefined): PromiseObject | undefined {
  // 1. Assert: IsPromise(promise) is true.
  Assert(IsPromise(promise));
  // 2. If resultCapability is not present, then
  if (resultCapability === undefined) {
    // a. Set resultCapability to undefined.
    resultCapability = undefined;
  }
  let onFulfilledJobCallback;
  // 3. If IsCallable(onFulfilled) is false, then
  if (!IsCallable(onFulfilled)) {
    // a. Let onFulfilledJobCallback be empty.
    onFulfilledJobCallback = undefined;
  } else { // 4. Else,
    // a. Let onFulfilledJobCallback be HostMakeJobCallback(onFulfilled).
    onFulfilledJobCallback = HostMakeJobCallback(onFulfilled);
  }
  let onRejectedJobCallback;
  // 5. If IsCallable(onRejected) is false, then
  if (!IsCallable(onRejected)) {
    // a. Let onRejectedJobCallback be empty.
    onRejectedJobCallback = undefined;
  } else { // 6. Else,
    onRejectedJobCallback = HostMakeJobCallback(onRejected);
  }
  // 7. Let fulfillReaction be the PromiseReaction { [[Capability]]: resultCapability, [[Type]]: Fulfill, [[Handler]]: onFulfilled }.
  const fulfillReaction = new PromiseReactionRecord({
    Capability: resultCapability,
    Type: 'Fulfill',
    Handler: onFulfilledJobCallback,
  });
  // 8. Let rejectReaction be the PromiseReaction { [[Capability]]: resultCapability, [[Type]]: Reject, [[Handler]]: onRejected }.
  const rejectReaction = new PromiseReactionRecord({
    Capability: resultCapability,
    Type: 'Reject',
    Handler: onRejectedJobCallback,
  });
  // 9. If promise.[[PromiseState]] is pending, then
  if (promise.PromiseState === 'pending') {
    surroundingAgent.debugger_tryTouchDuringPreview(promise);
    // a. Append fulfillReaction as the last element of the List that is promise.[[PromiseFulfillReactions]].
    promise.PromiseFulfillReactions!.push(fulfillReaction);
    // b. Append rejectReaction as the last element of the List that is promise.[[PromiseRejectReactions]].
    promise.PromiseRejectReactions!.push(rejectReaction);
  } else if (promise.PromiseState === 'fulfilled') {
    // a. Let value be promise.[[PromiseResult]].
    const value = promise.PromiseResult!;
    // b. Let fulfillJob be NewPromiseReactionJob(fulfillReaction, value).
    const fulfillJob = NewPromiseReactionJob(fulfillReaction, value);
    // c. Perform HostEnqueuePromiseJob(fulfillJob.[[Job]], fulfillJob.[[Realm]]).
    HostEnqueuePromiseJob(fulfillJob.Job, fulfillJob.Realm);
  } else {
    // a. Assert: The value of promise.[[PromiseState]] is rejected.
    Assert(promise.PromiseState === 'rejected');
    // b. Let reason be promise.[[PromiseResult]].
    const reason = promise.PromiseResult!;
    // c. If promise.[[PromiseIsHandled]] is false, perform HostPromiseRejectionTracker(promise, "handle").
  if (!promise.PromiseIsHandled) {
      HostPromiseRejectionTracker(promise, 'handle');
    }
    // d. Let rejectJob be NewPromiseReactionJob(rejectReaction, reason).
    const rejectJob = NewPromiseReactionJob(rejectReaction, reason);
    // e. Perform HostEnqueuePromiseJob(rejectJob.[[Job]], rejectJob.[[Realm]]).
    HostEnqueuePromiseJob(rejectJob.Job, rejectJob.Realm);
  }
  // 12. Set promise.[[PromiseIsHandled]] to true.
  promise.PromiseIsHandled = true;
  // 13. If resultCapability is undefined, then
  if (resultCapability === undefined) {
    // a. Return undefined.
    return undefined;
  } else { // 14. Else,
    // a. Return resultCapability.[[Promise]].
    return resultCapability.Promise;
  }
}
