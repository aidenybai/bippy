// This file covers abstract operations defined in
// https://tc39.es/ecma262/#sec-import-calls

import {
  AbstractModuleRecord,
  Assert,
  Call, CreateBuiltinFunction, GatherAsynchronousTransitiveDependencies, GatherAsynchronousTransitiveDependenciesForRequests, GetModuleNamespace, PerformPromiseThen, PromiseCapabilityRecord, Value,
  Throw,
  type Arguments,
  type PromiseObject,
  ListAppendUnique,
  CyclicModuleRecord,
} from '../index.mts';
import {
  AbruptCompletion, ValueOfNormalCompletion, X, type PlainCompletion,
} from '../completion.mts';
import { SafePerformPromiseAll } from '../intrinsics/Promise.mts';

/** https://tc39.es/ecma262/#sec-ContinueDynamicImport */
export function ContinueDynamicImport(
  promiseCapability: PromiseCapabilityRecord,
  phase: 'source' | 'defer' | 'evaluation',
  moduleCompletion: PlainCompletion<AbstractModuleRecord>,
) {
  // 1. If moduleCompletion is an abrupt completion, then
  if (moduleCompletion instanceof AbruptCompletion) {
    // a. Perform ! Call(promiseCapability.[[Reject]], undefined, « moduleCompletion.[[Value]] »).
    X(Call(promiseCapability.Reject, Value.undefined, [moduleCompletion.Value]));
    // b. Return unused.
    return;
  }
  // 2. Let module be moduleCompletion.[[Value]].
  const module = ValueOfNormalCompletion(moduleCompletion);

  if (phase === 'source') {
    const moduleSource = module.ModuleSource;
    if (moduleSource === undefined) {
      X(Call(promiseCapability.Reject, Value.undefined, [Throw.SyntaxError('Module source is not available').Value]));
    } else { // c. Else,
      X(Call(promiseCapability.Resolve, Value.undefined, [moduleSource]));
    }
    return;
  }

  // 3. Let loadPromise be module.LoadRequestedModules(all).
  const loadPromise = module.LoadRequestedModules('all');

  // 4. Let rejectedClosure be a new Abstract Closure with parameters (reason) that captures promiseCapability and performs the following steps when called:
  const rejectedClosure = ([reason = Value.undefined]: Arguments): void => {
    // a. Perform ! Call(promiseCapability.[[Reject]], undefined, « reason »).
    X(Call(promiseCapability.Reject, Value.undefined, [reason]));
    // b. Return unused.
  };
  // 5. Let onRejected be CreateBuiltinFunction(rejectedClosure, 1, "", « »).
  const onRejected = CreateBuiltinFunction(rejectedClosure, 1, Value(''), []);

  // 6. Let linkAndEvaluateClosure be a new Abstract Closure with no parameters that captures module, promiseCapability, and onRejected and performs the following steps when called:
  function* linkAndEvaluateClosure() {
    // a. Let link be Completion(module.Link(all)).
    const link = module.Link('all');
    // b. If link is an abrupt completion, then
    if (link instanceof AbruptCompletion) {
      // i. Perform ! Call(promiseCapability.[[Reject]], undefined, « link.[[Value]] »).
      X(Call(promiseCapability.Reject, Value.undefined, [link.Value]));
      // ii. Return unused.
      return;
    }

    let evaluatePromise: PromiseObject;

    // c. Let fulfilledClosure be a new Abstract Closure with no parameters that captures module and promiseCapability and performs the following steps when called:
    const fulfilledClosure = () => {
      Assert(phase !== 'source');
      // i. Let namespace be GetModuleNamespace(module, phase, all).
      const namespace = GetModuleNamespace(module, phase, 'all');
      // ii. Perform ! Call(promiseCapability.[[Resolve]], undefined, « namespace »).
      X(Call(promiseCapability.Resolve, Value.undefined, [namespace]));
      // iii. Return unused.
    };

    // d. If phase is "defer", then
    if (phase === 'defer') {
      // i. Let evaluationList be module.GatherAsynchronousTransitiveDependencies().
      const evaluationList = GatherAsynchronousTransitiveDependencies(module);
      // ii. If module is a Cyclic Module Record, then
      if (module instanceof CyclicModuleRecord) {
        // 1. Let optionalIndirectRequests be module.GetOptionalIndirectExportsModuleRequests(all).
        const optionalIndirectRequests = module.GetOptionalIndirectExportsModuleRequests('all');
        // 2. Let seen be a new empty List.
        const seen = new Set<AbstractModuleRecord>();
        // 3. Perform ListAppendUnique(evaluationList, GatherAsynchronousTransitiveDependenciesForRequests(module, optionalIndirectRequests, seen)).
        ListAppendUnique(evaluationList, GatherAsynchronousTransitiveDependenciesForRequests(module, optionalIndirectRequests, seen));
      }

      // iii. If evaluationList is empty, then
      if (evaluationList.length === 0) {
        // 1. Perform fulfilledClosure().
        fulfilledClosure();
        // 2. Return unused.
        return;
      }
      // iv. Let asyncDepsEvaluationPromises be a new empty List.
      const asyncDepsEvaluationPromises = [];
      // v. For each dep in evaluationList, append dep.Evaluate() to asyncDepsEvaluationPromises.
      for (const dep of evaluationList) {
        asyncDepsEvaluationPromises.push(yield* dep.Evaluate());
      }
      // vi. Let evaluatePromise be ! SafePerformPromiseAll(asyncDepsEvaluationPromises).
      evaluatePromise = SafePerformPromiseAll(asyncDepsEvaluationPromises);
    } else { // e. Else,
      // i. Assert: phase is EVALUATION.
      Assert(phase === 'evaluation');
      // ii. Let asyncEvaluationList be a new empty List.
      let asyncEvaluationList: AbstractModuleRecord[] = [];
      // iii. If module is a Cyclic Module Record, then
      if (module instanceof CyclicModuleRecord) {
        // 1. Let optionalIndirectRequests be module.GetOptionalIndirectExportsModuleRequests(all).
        const optionalIndirectRequests = module.GetOptionalIndirectExportsModuleRequests('all');
        // 2. Let seen be a new empty List.
        const seen = new Set<AbstractModuleRecord>();
        // 3. Perform ListAppendUnique(asyncEvaluationList, GatherAsynchronousTransitiveDependenciesForRequests(module, optionalIndirectRequests, seen)).
        asyncEvaluationList = GatherAsynchronousTransitiveDependenciesForRequests(module, optionalIndirectRequests, seen);
      }
      // iv. If evaluationList is empty, then
      if (asyncEvaluationList.length === 0) {
        //  1. Let evaluatePromise be module.Evaluate().
        evaluatePromise = yield* module.Evaluate();
      } else { // v. Else,
        // 1. Let evaluationPromises be « module.Evaluate() ».
        const evaluationPromises = [yield* module.Evaluate()];
        // 2. For each Module Record dep of asyncEvaluationList, append dep.Evaluate() to evaluationPromises.
        for (const dep of asyncEvaluationList) {
          evaluationPromises.push(yield* dep.Evaluate());
        }
        // 3. Let evaluatePromise be SafePerformPromiseAll(evaluationPromises).
        evaluatePromise = SafePerformPromiseAll(evaluationPromises);
      }
    }

    // f. Let onFulfilled be CreateBuiltinFunction(fulfilledClosure, 0, "", « »).
    const onFulfilled = CreateBuiltinFunction(fulfilledClosure, 0, Value(''), []);

    // g. Perform PerformPromiseThen(evaluatePromise, onFulfilled, onRejected).
    PerformPromiseThen(evaluatePromise!, onFulfilled, onRejected);
    // h. Return unused.
  }
  // 7. Let linkAndEvaluate be CreateBuiltinFunction(linkAndEvaluateClosure, 0, "", « »).
  const linkAndEvaluate = CreateBuiltinFunction(linkAndEvaluateClosure, 0, Value(''), []);

  // 8. Perform PerformPromiseThen(loadPromise, linkAndEvaluate, onRejected).
  PerformPromiseThen(loadPromise, linkAndEvaluate, onRejected);
  // 9. Return unused.
}
