import { ExecutionContext } from '../execution-context/ExecutionContext.mts';
import {
  Q, X,
  Await,
  EnsureCompletion,
  NormalCompletion,
  AbruptCompletion,
  ThrowCompletion,
  type YieldCompletion,
  ReturnCompletion,
} from '../completion.mts';
import { Evaluate, type PlainEvaluator, type YieldEvaluator } from '../evaluator.mts';
import {
  Value, type Arguments,
  type NativeSteps,
} from '../value.mts';
import { __ts_cast__ } from '../utils/language.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import {
  Assert,
  Call,
  CreateBuiltinFunction,
  CreateIteratorResultObject,
  generatorBrandToErrorMessageType,
  GetGeneratorKind,
  PerformPromiseThen,
  PromiseCapabilityRecord,
  PromiseResolve,
  RequireInternalSlot,
  type OrdinaryObject,
} from './all.mts';
import {
  RunSuspendedContext, Throw, type Realm, surroundingAgent,
  RunCallerContext,
  runningExecutionContext,
} from '#self';

// This file covers abstract operations defined in
/** https://tc39.es/ecma262/#sec-asyncgenerator-objects */

/** https://tc39.es/ecma262/#sec-asyncgeneratorrequest-records */
export interface AsyncGeneratorRequestRecord {
  readonly Completion: YieldCompletion;
  readonly Capability: PromiseCapabilityRecord;
}
export const AsyncGeneratorRequestRecord = function AsyncGeneratorRequestRecord(value: AsyncGeneratorRequestRecord) {
  Object.setPrototypeOf(value, AsyncGeneratorRequestRecord.prototype);
  return value;
} as {
  (value: AsyncGeneratorRequestRecord): AsyncGeneratorRequestRecord;
  [Symbol.hasInstance](instance: unknown): instance is AsyncGeneratorRequestRecord;
};

export interface AsyncGeneratorObject extends OrdinaryObject {
  AsyncGeneratorState: 'suspendedStart' | 'suspendedYield' | 'executing' | 'completed' | 'draining-queue';
  AsyncGeneratorContext: ExecutionContext;
  AsyncGeneratorQueue: AsyncGeneratorRequestRecord[];
  GeneratorBrand: string | undefined;
}

/** https://tc39.es/ecma262/#sec-asyncgeneratorstart */
export function AsyncGeneratorStart(generator: AsyncGeneratorObject, generatorBody: ParseNode.AsyncGeneratorBody | (() => YieldEvaluator)) {
  // 1. Assert: generator.[[AsyncGeneratorState]] is 'suspendedStart'.
  Assert(generator.AsyncGeneratorState === 'suspendedStart');
  // 2. Let genContext be the running execution context.
  const genContext = surroundingAgent.runningExecutionContext;
  // 3. Set the Generator component of genContext to generator.
  genContext.Generator = generator;
  const closure = function* resumer(): YieldEvaluator {
    const acGenContext = surroundingAgent.runningExecutionContext;
    const acGenerator = acGenContext.Generator as AsyncGeneratorObject;
    // a. If generatorBody is a Parse Node, then
    //     i. Let result be the result of evaluating generatorBody.
    // b. Else,
    //     i. Assert: generatorBody is an Abstract Closure.
    //     ii. Let result be generatorBody().
    let result = EnsureCompletion(
      // Note: Engine262 can only perform the "If generatorBody is an Abstract Closure" check:
      yield* typeof generatorBody === 'function'
        ? generatorBody()
        : Evaluate(generatorBody),
    ) as YieldCompletion;
    // c. Assert: If we return here, the async generator either threw an exception or performed either an implicit or explicit return.
    // d. Remove genContext from the execution context stack and restore the execution context
    //    that is at the top of the execution context stack as the running execution context.
    surroundingAgent.executionContextStack.pop(acGenContext);
    // e. Set generator.[[AsyncGeneratorState]] to completed.
    acGenerator.AsyncGeneratorState = 'draining-queue';
    // f. If result.[[Type]] is normal, set result to NormalCompletion(undefined).
    if (result instanceof NormalCompletion) {
      result = NormalCompletion(Value.undefined);
    }
    // g. If result.[[Type]] is return, set result to NormalCompletion(result.[[Value]]).
    if (result instanceof ReturnCompletion) {
      result = NormalCompletion(result.Value);
    }
    // h. Perform AsyncGeneratorCompleteStep(generator, result, true).
    AsyncGeneratorCompleteStep(acGenerator, result, true);
    // i. Perform AsyncGeneratorDrainQueue(generator).
    yield* AsyncGeneratorDrainQueue(acGenerator);
    // j. Let callerContext be the running execution context.
    // k. Resume callerContext, passing NormalCompletion(undefined).
    yield { suspend: 'async-yield' };
    // l. Assert: This step is never reached.
    Assert(false);
  };
  // 4. Set the code evaluation state of genContext such that when evaluation
  //    is resumed for that execution context the following steps will be performed:
  genContext.CodeEvaluationState = (closure());
  // 5. Set generator.[[AsyncGeneratorContext]] to genContext.
  generator.AsyncGeneratorContext = genContext;
  // 7. Set generator.[[AsyncGeneratorQueue]] to a new empty List.
  generator.AsyncGeneratorQueue = [];
  // 8. Return undefined.
}

/** https://tc39.es/ecma262/#sec-asyncgeneratorvalidate */
export function AsyncGeneratorValidate(generator: Value, generatorBrand: string | undefined) {
  // 1. Perform ? RequireInternalSlot(generator, [[AsyncGeneratorContext]]).
  Q(RequireInternalSlot(generator, 'AsyncGeneratorContext'));
  // 2. Perform ? RequireInternalSlot(generator, [[AsyncGeneratorState]]).
  Q(RequireInternalSlot(generator, 'AsyncGeneratorState'));
  // 3. Perform ? RequireInternalSlot(generator, [[AsyncGeneratorQueue]]).
  Q(RequireInternalSlot(generator, 'AsyncGeneratorQueue'));
  __ts_cast__<AsyncGeneratorObject>(generator);
  // 4. If generator.[[GeneratorBrand]] is not the same value as generatorBrand, throw a TypeError exception.
  const brand = generator.GeneratorBrand;
  if (brand !== generatorBrand) {
    return Throw.TypeError('$1 is not a $2', generator, generatorBrandToErrorMessageType(generatorBrand) || 'AsyncGenerator');
  }
  return undefined;
}

/** https://tc39.es/ecma262/#sec-asyncgeneratorenqueue */
export function AsyncGeneratorEnqueue(generator: AsyncGeneratorObject, completion: YieldCompletion, promiseCapability: PromiseCapabilityRecord) {
  // 1. Let request be AsyncGeneratorRequest { [[Completion]]: completion, [[Capability]]: promiseCapability }.
  const request = AsyncGeneratorRequestRecord({ Completion: completion, Capability: promiseCapability });
  // 2. Append request to the end of generator.[[AsyncGeneratorQueue]].
  generator.AsyncGeneratorQueue.push(request);
}

/** https://tc39.es/ecma262/#sec-asyncgeneratorcompletestep */
function AsyncGeneratorCompleteStep(generator: AsyncGeneratorObject, completion: YieldCompletion, done: boolean, realm?: Realm) {
  // 1. Let queue be generator.[[AsyncGeneratorQueue]].
  const queue = generator.AsyncGeneratorQueue;
  // 2. Assert: queue is not empty.
  Assert(queue.length > 0);
  // 3. Let next be the first element of queue.
  // 4. Remove the first element from queue.
  const next = queue.shift()!;
  // 5. Let promiseCapability be next.[[Capability]].
  const promiseCapability = next.Capability;
  // 6. Let value be completion.[[Value]].
  const value = completion instanceof Value ? completion : completion.Value;
  // 7. If completion.[[Type]] is throw, then
  if (completion instanceof ThrowCompletion) {
    // a. Perform ! Call(promiseCapability.[[Reject]], undefined, « value »).
    X(Call(promiseCapability.Reject, Value.undefined, [value]));
  } else { // 8. Else,
    // a. Assert: completion.[[Type]] is normal.
    Assert(completion instanceof NormalCompletion);
    let iteratorResult;
    // b. If realm is present, then
    if (realm !== undefined) {
      // i. Let oldRealm be the running execution context's Realm.
      const oldRealm = surroundingAgent.runningExecutionContext.Realm;
      // ii. Set the running execution context's Realm to realm.
      surroundingAgent.runningExecutionContext.Realm = realm;
      // iii. Let iteratorResult be CreateIteratorResultObject(value, done).
      iteratorResult = CreateIteratorResultObject(value, done);
      // iv. Set the running execution context's Realm to oldRealm.
      surroundingAgent.runningExecutionContext.Realm = oldRealm;
    } else { // c. Else,
      // i. Let iteratorResult be CreateIteratorResultObject(value, done).
      iteratorResult = CreateIteratorResultObject(value, done);
    }
    // d. Perform ! Call(promiseCapability.[[Resolve]], undefined, « iteratorResult »).
    X(Call(promiseCapability.Resolve, Value.undefined, [iteratorResult]));
  }
}

/** https://tc39.es/ecma262/#sec-asyncgeneratorresume */
export function* AsyncGeneratorResume(generator: AsyncGeneratorObject, completion: YieldCompletion) {
  // 1. Assert: generator.[[AsyncGeneratorState]] is either suspendedStart or suspendedYield.
  Assert(generator.AsyncGeneratorState === 'suspendedStart' || generator.AsyncGeneratorState === 'suspendedYield');
  // 2. Let genContext be generator.[[AsyncGeneratorContext]].
  const genContext = generator.AsyncGeneratorContext;
  // 3. Set generator.[[AsyncGeneratorState]] to executing.
  generator.AsyncGeneratorState = 'executing';
  // 4. Perform ! RunSuspendedContext(genContext, completion).
  X(yield* RunSuspendedContext(genContext, { resume: 'async-yield', value: completion }));
  return undefined;
}

/** https://tc39.es/ecma262/#sec-asyncgeneratorunwrapyieldresumption */
function* AsyncGeneratorUnwrapYieldResumption(resumptionValue: YieldCompletion): YieldEvaluator {
  // 1. If resumptionValue.[[Type]] is not return, return Completion(resumptionValue).
  if (!(resumptionValue instanceof ReturnCompletion)) {
    return Q(resumptionValue);
  }
  // 2. Let awaited be Await(resumptionValue.[[Value]]).
  const awaited = EnsureCompletion(yield* Await(resumptionValue.Value));
  // 3. If awaited.[[Type]] is throw, return Completion(awaited).
  if (awaited instanceof ThrowCompletion) {
    return Q(awaited);
  }
  Assert(awaited instanceof NormalCompletion);
  return ReturnCompletion(awaited.Value);
}

/** https://tc39.es/ecma262/#sec-asyncgeneratoryield */
export function* AsyncGeneratorYield(arg: Value): YieldEvaluator {
  const genContext = runningExecutionContext();

  // Assert: genContext is the execution context of a generator.
  Assert(genContext.Generator !== undefined);

  const gen = genContext.Generator as AsyncGeneratorObject;
  Assert(GetGeneratorKind() === 'async');
  const completion = NormalCompletion(arg);

  // Assert: The execution context stack has at least two elements.
  Assert(surroundingAgent.executionContextStack.length >= 2);

  // Let previousContext be the second to top element of the execution context stack.
  const previousContext = surroundingAgent.executionContextStack[surroundingAgent.executionContextStack.length - 2];

  const previousRealm = previousContext.Realm;
  AsyncGeneratorCompleteStep(gen, completion, false, previousRealm);
  const queue = gen.AsyncGeneratorQueue;
  if (queue.length) {
    // a. NOTE: Execution continues without suspending the generator.
    const toYield = queue[0];
    const resumptionValue = toYield.Completion;
    return yield* AsyncGeneratorUnwrapYieldResumption(resumptionValue);
  }
  gen.AsyncGeneratorState = 'suspendedYield';
  const resumptionValue = yield* RunCallerContext({ suspend: 'async-yield' });
  return yield* AsyncGeneratorUnwrapYieldResumption(resumptionValue);
}

/** https://tc39.es/ecma262/#sec-asyncgeneratorawaitreturn */
export function* AsyncGeneratorAwaitReturn(generator: AsyncGeneratorObject): PlainEvaluator {
  Assert(generator.AsyncGeneratorState === 'draining-queue');
  // 1. Let queue be generator.[[AsyncGeneratorQueue]].
  const queue = generator.AsyncGeneratorQueue;
  // 2. Assert: queue is not empty.
  Assert(queue.length > 0);
  // 3. Let next be the first element of queue.
  const next = queue[0];
  // 4. Let completion be next.[[Completion]].
  const completion = next.Completion;
  // 5. Assert: completion.[[Type]] is return.
  Assert(completion instanceof ReturnCompletion);
  // 6. Let promise be PromiseResolve(%Promise%, completion.[[Value]]).
  const promiseCompletion = yield* PromiseResolve(surroundingAgent.intrinsic('%Promise%'), completion.Value);
  if (promiseCompletion instanceof AbruptCompletion) {
    AsyncGeneratorCompleteStep(generator, promiseCompletion, true);
    yield* AsyncGeneratorDrainQueue(generator);
    return;
  }
  const promise = X(promiseCompletion);
  // 7. Let fulfilledClosure be a new Abstract Closure with parameters (value) that captures generator and performs the following steps when called:
  const fulfilledClosure: NativeSteps = function* fulfilledClosure([value = Value.undefined]: Arguments) {
    Assert(generator.AsyncGeneratorState === 'draining-queue');
    // b. Let result be NormalCompletion(value).
    const result = NormalCompletion(value);
    // c. Perform AsyncGeneratorCompleteStep(generator, result, true).
    AsyncGeneratorCompleteStep(generator, result, true);
    // d. Perform AsyncGeneratorDrainQueue(generator).
    yield* AsyncGeneratorDrainQueue(generator);
    // e. Return undefined.
    return Value.undefined;
  };
  // 8. Let onFulfilled be CreateBuiltinFunction(fulfilledClosure, 1, "", « »).
  const onFulfilled = CreateBuiltinFunction(fulfilledClosure, 1, Value(''), []);
  // 9. Let rejectedClosure be a new Abstract Closure with parameters (reason) that captures generator and performs the following steps when called:
  const rejectedClosure: NativeSteps = function* rejectedClosure([reason = Value.undefined]: Arguments) {
    Assert(generator.AsyncGeneratorState === 'draining-queue');
    // b. Let result be ThrowCompletion(reason).
    const result = ThrowCompletion(reason);
    // c. Perform AsyncGeneratorCompleteStep(generator, result, true).
    AsyncGeneratorCompleteStep(generator, result, true);
    // d. Perform AsyncGeneratorDrainQueue(generator).
    yield* AsyncGeneratorDrainQueue(generator);
    // e. Return undefined.
    return Value.undefined;
  };
  // 10. Let onRejected be CreateBuiltinFunction(rejectedClosure, 1, "", « »).
  const onRejected = CreateBuiltinFunction(rejectedClosure, 1, Value(''), []);
  // 11. Perform PerformPromiseThen(promise, onFulfilled, onRejected).
  PerformPromiseThen(promise, onFulfilled, onRejected);
}

/** https://tc39.es/ecma262/#sec-asyncgeneratordrainqueue */
function* AsyncGeneratorDrainQueue(generator: AsyncGeneratorObject) {
  // 1. Assert: generator.[[AsyncGeneratorState]] is completed.
  Assert(generator.AsyncGeneratorState === 'draining-queue');
  // 2. Let queue be generator.[[AsyncGeneratorQueue]].
  const queue = generator.AsyncGeneratorQueue;
  while (queue.length) {
    const next = queue[0];
    let completion = next.Completion;
    if (completion instanceof ReturnCompletion) {
      yield* AsyncGeneratorAwaitReturn(generator);
      return;
    } else {
      if (completion instanceof NormalCompletion) {
        completion = NormalCompletion(Value.undefined);
      }
      AsyncGeneratorCompleteStep(generator, completion, true);
    }
  }
  generator.AsyncGeneratorState = 'completed';
}
