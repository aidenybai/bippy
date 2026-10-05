import {
  EnsureCompletion, X, ExecutionContext, surroundingAgent, Evaluate, Value, type ParseNode, Assert, Call, PromiseCapabilityRecord, RunSuspendedContext,
  type AsyncBuiltinSteps,
  type PlainEvaluator,
} from '#self';

// This file covers abstract operations defined in
/** https://tc39.es/ecma262/#sec-async-function-objects */

/** https://tc39.es/ecma262/#sec-asyncblockstart */
export function* AsyncBlockStart(promiseCapability: PromiseCapabilityRecord, asyncBody: ParseNode.AsyncBody | ParseNode.ExpressionBody | ParseNode.Module | AsyncBuiltinSteps, asyncContext: ExecutionContext): PlainEvaluator<void> {
  asyncContext.promiseCapability = promiseCapability;

  asyncContext.CodeEvaluationState = (function* closure() {
    const acAsyncContext = surroundingAgent.runningExecutionContext;
    let result;
    if (typeof asyncBody === 'function') {
      result = EnsureCompletion(yield* asyncBody());
    } else {
      result = EnsureCompletion(yield* Evaluate(asyncBody));
    }
    // Assert: If we return here, the async function either threw an exception or performed an implicit or explicit return; all awaiting is done.
    surroundingAgent.executionContextStack.pop(acAsyncContext);
    if (result.Type === 'normal') {
      X(Call(promiseCapability.Resolve, Value.undefined, [Value.undefined]));
    } else if (result.Type === 'return') {
      X(Call(promiseCapability.Resolve, Value.undefined, [result.Value]));
    } else {
      Assert(result.Type === 'throw');
      X(Call(promiseCapability.Reject, Value.undefined, [result.Value]));
    }
    // Resume the caller context, passing NormalCompletion(~unused~).
    yield { suspend: 'async-yield' };
    // Assert: This step is never reached.
    Assert(false);
  }());
  const result = X(yield* RunSuspendedContext(asyncContext, { resume: 'async-yield', value: undefined }));
  Assert(result === undefined);
}

/** https://tc39.es/ecma262/#sec-async-functions-abstract-operations-async-function-start */
export function* AsyncFunctionStart(promiseCapability: PromiseCapabilityRecord, asyncFunctionBody: ParseNode.AsyncBody | ParseNode.ExpressionBody | AsyncBuiltinSteps) {
  const runningContext = surroundingAgent.runningExecutionContext;
  const asyncContext = runningContext.copy();
  X(yield* AsyncBlockStart(promiseCapability, asyncFunctionBody, asyncContext));
}
