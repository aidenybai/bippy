import type { SourceLocation } from "../parse/source-types.js";
import type { Scope, StaticValue } from "../types.js";
import type { ConditionalEvaluationOptions, EvaluationContext, ValueCaller } from "./context.js";
import type { CallableValue } from "./values.js";

export interface CallbackEvaluator extends ValueCaller {
  runMaybe: <Result>(
    scope: Scope | null,
    run: () => Result,
    reason: string,
    location: SourceLocation | null,
    isLikelyRun?: boolean,
    isRepeated?: boolean,
    options?: ConditionalEvaluationOptions,
  ) => Result;
}

export const callCallback = (
  evaluator: ValueCaller,
  callback: CallableValue,
  args: StaticValue[],
  context: EvaluationContext,
): StaticValue => evaluator.callValue(callback, args, context, null);

/**
 * A callback run for an item that may be absent (`mayRepeat` false) or occur
 * any number of times (`mayRepeat` true): its side effects are uncertain.
 */
export const callUncertainCallback = (
  evaluator: CallbackEvaluator,
  callback: CallableValue,
  args: StaticValue[],
  context: EvaluationContext,
  mayRepeat: boolean,
  predicate: string | null = null,
): StaticValue =>
  evaluator.runMaybe(
    callback.kind === "function" ? callback.scope : context.scope,
    () => callCallback(evaluator, callback, args, context),
    "callback for an item that may not occur",
    null,
    true,
    mayRepeat,
    { predicate: predicate ?? undefined },
  );
