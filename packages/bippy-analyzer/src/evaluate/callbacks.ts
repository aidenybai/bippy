import type { SourceLocation } from "../parse/source-types.js";
import type { Scope, StaticValue } from "../types.js";
import type {
  ConditionalEvaluationOptions,
  EvaluationContext,
  ValueCaller,
  ValueCallOptions,
} from "./context.js";

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
  callback: StaticValue,
  args: StaticValue[],
  context: EvaluationContext,
  options?: ValueCallOptions,
): StaticValue =>
  options
    ? evaluator.callValue(callback, args, context, null, options)
    : evaluator.callValue(callback, args, context, null);

/**
 * A callback run for an item that may be absent (`mayRepeat` false) or occur
 * any number of times (`mayRepeat` true): its side effects are uncertain.
 */
export const callUncertainCallback = (
  evaluator: CallbackEvaluator,
  callback: StaticValue,
  args: StaticValue[],
  context: EvaluationContext,
  mayRepeat: boolean,
  predicate: string | null = null,
  options?: ValueCallOptions,
): StaticValue =>
  evaluator.runMaybe(
    callback.kind === "function" ? callback.scope : context.scope,
    () => callCallback(evaluator, callback, args, context, options),
    "callback for an item that may not occur",
    null,
    true,
    mayRepeat,
    { predicate: predicate ?? undefined },
  );
