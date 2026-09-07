import type {
  SourceLocation,
  StaticObjectValue,
  StaticUnknownValue,
  StaticValue,
  StubRenderTools,
} from "../types.js";
import { listValue, objectValue, thrownValue, UNDEFINED_VALUE, unknownValue } from "./values.js";

export type PromiseTools = Pick<StubRenderTools, "call" | "markEscaped" | "queueMicrotask">;

export interface PromiseReaction {
  run: (outcome: StaticValue, tools: PromiseTools) => void;
  escape: (markEscaped: PromiseTools["markEscaped"]) => void;
}

/**
 * A promise the analysis saw created. Its outcome is a value, a rejection being
 * a thrown value; `then`/`await` read through to it once settled. Reactions run
 * as microtasks once the promise settles, or wait until `resolve`/`reject`
 * runs, and once either flows into code the analysis does not follow the
 * promise may settle at any time.
 */
export interface ModeledPromise {
  value: StaticObjectValue;
  settled: StaticValue | null;
  isEscaped: boolean;
  reactions: PromiseReaction[];
}

const promisesByValue = new WeakMap<StaticObjectValue, ModeledPromise>();

export const getModeledPromise = (value: StaticValue): ModeledPromise | null =>
  value.kind === "object" ? (promisesByValue.get(value) ?? null) : null;

export const isThrownOutcome = (
  value: StaticValue,
): value is StaticUnknownValue & { thrown: StaticValue } =>
  value.kind === "unknown" && value.thrown !== undefined;

const createPendingPromise = (): ModeledPromise => {
  const promise: ModeledPromise = {
    value: objectValue([]),
    settled: null,
    isEscaped: false,
    reactions: [],
  };
  promisesByValue.set(promise.value, promise);
  return promise;
};

/** `Promise.resolve(outcome)`, or an async function's return: a promise is returned as is. */
export const resolvedPromiseValue = (outcome: StaticValue): StaticValue => {
  if (getModeledPromise(outcome)) return outcome;
  const promise = createPendingPromise();
  promise.settled = outcome;
  return promise.value;
};

/**
 * `await value`: the outcome of a settled promise; unknown while it is pending.
 * The continuation of an `await` is itself a microtask, so a promise that only
 * awaits queued reactions (`await fetchThing().then(transform)`) settles once
 * the queue drains, which happens before the continuation would run.
 */
export const awaitedValue = (
  value: StaticValue,
  location: SourceLocation | null,
  drainMicrotasks: () => void,
): StaticValue => {
  const promise = getModeledPromise(value);
  if (!promise) return value;
  if (!promise.settled && !promise.isEscaped) drainMicrotasks();
  return promise.settled ?? unknownValue("promise settled asynchronously", location);
};

export const escapePromise = (
  promise: ModeledPromise,
  markEscaped: PromiseTools["markEscaped"],
): void => {
  if (promise.settled || promise.isEscaped) return;
  promise.isEscaped = true;
  for (const reaction of promise.reactions.splice(0)) reaction.escape(markEscaped);
};

const settlePromise = (
  promise: ModeledPromise,
  outcome: StaticValue,
  tools: PromiseTools,
): void => {
  if (promise.settled || promise.isEscaped) return;
  const adopted = getModeledPromise(outcome);
  if (adopted) {
    subscribe(adopted, forwardTo(promise), tools);
    return;
  }
  promise.settled = outcome;
  for (const reaction of promise.reactions.splice(0)) {
    tools.queueMicrotask(() => reaction.run(outcome, tools));
  }
};

const forwardTo = (target: ModeledPromise): PromiseReaction => ({
  run: (outcome, tools) => settlePromise(target, outcome, tools),
  escape: (markEscaped) => escapePromise(target, markEscaped),
});

const subscribe = (
  promise: ModeledPromise,
  reaction: PromiseReaction,
  tools: PromiseTools,
): void => {
  const settled = promise.settled;
  if (settled) tools.queueMicrotask(() => reaction.run(settled, tools));
  else if (promise.isEscaped) reaction.escape(tools.markEscaped);
  else promise.reactions.push(reaction);
};

const settlingFunction = (
  name: string,
  promise: ModeledPromise,
  toOutcome: (value: StaticValue) => StaticValue,
  markEscaped: PromiseTools["markEscaped"],
): StaticValue => ({
  kind: "native-function",
  name,
  call: ([value], tools) => {
    settlePromise(promise, toOutcome(value ?? UNDEFINED_VALUE), tools);
    return UNDEFINED_VALUE;
  },
  onEscape: () => escapePromise(promise, markEscaped),
});

/** `new Promise(executor)`, settled when the executor settles it synchronously. */
export const createPromiseValue = (
  executor: StaticValue | undefined,
  tools: PromiseTools,
  location: SourceLocation | null,
): StaticValue => {
  const promise = createPendingPromise();
  const rejection = (reason: StaticValue): StaticValue =>
    thrownValue("rejected promise", reason, location);
  const resolve = settlingFunction("resolve", promise, (value) => value, tools.markEscaped);
  const reject = settlingFunction("reject", promise, rejection, tools.markEscaped);
  if (executor) {
    const outcome = tools.call(executor, [resolve, reject]);
    if (isThrownOutcome(outcome)) settlePromise(promise, outcome, tools);
  }
  return promise.value;
};

export interface PromiseHandlers {
  onFulfilled: StaticValue | null;
  onRejected: StaticValue | null;
  onFinally: StaticValue | null;
}

const handlerOutcome = (
  handlers: PromiseHandlers,
  outcome: StaticValue,
  tools: PromiseTools,
): StaticValue => {
  if (handlers.onFinally) {
    const result = tools.call(handlers.onFinally, []);
    return isThrownOutcome(result) ? result : outcome;
  }
  const handler = isThrownOutcome(outcome) ? handlers.onRejected : handlers.onFulfilled;
  if (!handler) return outcome;
  return tools.call(handler, [isThrownOutcome(outcome) ? outcome.thrown : outcome]);
};

/** `promise.then(...)`/`.catch(...)`/`.finally(...)`: the derived promise, settled from the handlers' results. */
export const chainPromise = (
  promise: ModeledPromise,
  handlers: PromiseHandlers,
  tools: PromiseTools,
): StaticValue => {
  const derived = createPendingPromise();
  subscribe(
    promise,
    {
      run: (outcome, runTools) =>
        settlePromise(derived, handlerOutcome(handlers, outcome, runTools), runTools),
      escape: (markEscaped) => {
        for (const handler of [handlers.onFulfilled, handlers.onRejected, handlers.onFinally]) {
          if (handler) markEscaped(handler);
        }
        escapePromise(derived, markEscaped);
      },
    },
    tools,
  );
  return derived.value;
};

const outcomeOf = (item: StaticValue): StaticValue => getModeledPromise(item)?.settled ?? item;

/** `Promise.all(items)`: the list of outcomes, pending while any item is. */
export const combinePromises = (
  items: StaticValue[],
  tools: PromiseTools,
  location: SourceLocation | null,
): StaticValue => {
  const pending = items.flatMap((item) => {
    const promise = getModeledPromise(item);
    return promise && !promise.settled ? [promise] : [];
  });
  if (pending.some((promise) => promise.isEscaped)) {
    return unknownValue("Promise.all of a promise settled outside the analysis", location);
  }
  const rejection = items.map(outcomeOf).find(isThrownOutcome);
  if (rejection) return resolvedPromiseValue(rejection);
  if (pending.length === 0) return resolvedPromiseValue(listValue(items.map(outcomeOf)));
  const combined = createPendingPromise();
  let remaining = pending.length;
  for (const promise of pending) {
    subscribe(
      promise,
      {
        run: (outcome, runTools) => {
          if (isThrownOutcome(outcome)) settlePromise(combined, outcome, runTools);
          else if (--remaining === 0)
            settlePromise(combined, listValue(items.map(outcomeOf)), runTools);
        },
        escape: (markEscaped) => escapePromise(combined, markEscaped),
      },
      tools,
    );
  }
  return combined.value;
};
