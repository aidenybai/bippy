import type {
  SourceLocation,
  StaticObjectValue,
  StaticUnknownValue,
  StaticValue,
  StubRenderTools,
} from "../types.js";
import {
  listValue,
  objectFromRecord,
  objectValue,
  primitiveValue,
  thrownValue,
  UNDEFINED_VALUE,
  unknownValue,
} from "./values.js";

export type PromiseTools = Pick<
  StubRenderTools,
  "call" | "callDeferred" | "markEscaped" | "queueMicrotask"
>;

export interface PromiseReaction {
  run: (outcome: StaticValue, tools: PromiseTools) => void;
  escape: (tools: PromiseTools) => void;
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

/** An async function activation; `result` is the promise it returned, created once its body suspends at an `await`. */
export interface AsyncCall {
  kind: "async";
  result: ModeledPromise | null;
}

/**
 * The rest of an async body after an `await`, run with the awaited outcome once
 * the promise settles. `isEscaped` is set when it will settle outside the
 * analysis, so the outcome is unknown and the updates the rest makes are deferred.
 * Returns the body's eventual return value, or null when it suspended again.
 */
interface AwaitResumption {
  (outcome: StaticValue, isEscaped: boolean): StaticValue | null;
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

/**
 * `await` of a value the analysis cannot see settle (an external promise, a
 * value it does not know): the continuation runs at an unknown time, so the
 * updates it makes are deferred. A promise the analysis saw settle, whatever
 * its outcome, resumes the continuation like any other.
 */
export const isAwaitDeferred = (operand: StaticValue, awaited: StaticValue): boolean =>
  !getModeledPromise(operand)?.settled && isPossiblyUnsettled(awaited);

/** A value the analysis cannot see settle: it may be a promise pending outside the analysis. */
const isPossiblyUnsettled = (value: StaticValue): boolean =>
  (value.kind === "unknown" && !isThrownOutcome(value)) ||
  value.kind === "external" ||
  (value.kind === "branch" && value.alternatives.some(isPossiblyUnsettled));

/**
 * `await` on a promise that will not settle before the continuation would run:
 * pending, not escaped, even once the reactions queued so far have run (the
 * continuation is itself a microtask).
 */
export const getPendingPromise = (
  value: StaticValue,
  drainMicrotasks: () => void,
): ModeledPromise | null => {
  const promise = getModeledPromise(value);
  if (!promise || promise.settled || promise.isEscaped) return null;
  drainMicrotasks();
  return promise.settled || promise.isEscaped ? null : promise;
};

/** Suspends the async `call` on the pending `promise`; the value `resume` returns settles the call's result. */
export const suspendOnPromise = (
  call: AsyncCall,
  promise: ModeledPromise,
  resume: AwaitResumption,
  location: SourceLocation | null,
): void => {
  const result = call.result ?? createPendingPromise();
  call.result = result;
  promise.reactions.push({
    run: (outcome, tools) => {
      const returned = resume(outcome, false);
      if (returned) settlePromise(result, returned, tools);
    },
    escape: (tools) => {
      resume(unknownValue("promise settled outside the analysis", location), true);
      escapePromise(result, tools);
    },
  });
};

const escapePromise = (promise: ModeledPromise, tools: PromiseTools): void => {
  if (promise.settled || promise.isEscaped) return;
  promise.isEscaped = true;
  for (const reaction of promise.reactions.splice(0)) reaction.escape(tools);
};

/** The result of an async function whose body awaited a promise the analysis cannot see settle: it settles at an unknown time too. */
export const escapedPromiseValue = (): StaticValue => {
  const promise = createPendingPromise();
  promise.isEscaped = true;
  return promise.value;
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
  escape: (tools) => escapePromise(target, tools),
});

/** Runs `onSettled` once `promise` settles, or once it escapes, when it may settle at any time. */
export const onPromiseSettled = (
  promise: ModeledPromise,
  onSettled: (isEscaped: boolean) => void,
  queueMicrotask: PromiseTools["queueMicrotask"],
): void => {
  if (promise.settled) queueMicrotask(() => onSettled(false));
  else if (promise.isEscaped) onSettled(true);
  else promise.reactions.push({ run: () => onSettled(false), escape: () => onSettled(true) });
};

const subscribe = (
  promise: ModeledPromise,
  reaction: PromiseReaction,
  tools: PromiseTools,
): void => {
  const settled = promise.settled;
  if (settled) tools.queueMicrotask(() => reaction.run(settled, tools));
  else if (promise.isEscaped) reaction.escape(tools);
  else promise.reactions.push(reaction);
};

const settlingFunction = (
  name: string,
  promise: ModeledPromise,
  toOutcome: (value: StaticValue) => StaticValue,
  creationTools: PromiseTools,
): StaticValue => ({
  kind: "native-function",
  name,
  call: ([value], tools) => {
    settlePromise(promise, toOutcome(value ?? UNDEFINED_VALUE), tools);
    return UNDEFINED_VALUE;
  },
  onEscape: () => escapePromise(promise, creationTools),
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
  const resolve = settlingFunction("resolve", promise, (value) => value, tools);
  const reject = settlingFunction("reject", promise, rejection, tools);
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

/**
 * `promise.then(...)`/`.catch(...)`/`.finally(...)`: the derived promise,
 * settled from the handlers' results. Once the promise escapes, the handlers
 * that run whatever the outcome are continuations landing at an unknown time.
 */
export const chainPromise = (
  promise: ModeledPromise,
  handlers: PromiseHandlers,
  tools: PromiseTools,
  location: SourceLocation | null,
): StaticValue => {
  const derived = createPendingPromise();
  subscribe(
    promise,
    {
      run: (outcome, runTools) =>
        settlePromise(derived, handlerOutcome(handlers, outcome, runTools), runTools),
      escape: (escapeTools) => {
        if (handlers.onFinally) escapeTools.callDeferred(handlers.onFinally, []);
        if (handlers.onFulfilled) {
          escapeTools.callDeferred(handlers.onFulfilled, [
            unknownValue("promise settled outside the analysis", location),
          ]);
        }
        if (handlers.onRejected) escapeTools.markEscaped(handlers.onRejected);
        escapePromise(derived, escapeTools);
      },
    },
    tools,
  );
  return derived.value;
};

const outcomeOf = (item: StaticValue): StaticValue => getModeledPromise(item)?.settled ?? item;

/** The `{ status, value }` / `{ status, reason }` record `Promise.allSettled` reports for one outcome. */
const settledRecord = (outcome: StaticValue): StaticValue =>
  isThrownOutcome(outcome)
    ? objectFromRecord({ status: primitiveValue("rejected"), reason: outcome.thrown })
    : objectFromRecord({ status: primitiveValue("fulfilled"), value: outcome });

/**
 * `Promise.all(items)`: the list of outcomes, rejecting with the first
 * rejection; `Promise.allSettled(items)`: the list of settlement records.
 * Both pend while any item does.
 */
export const combinePromises = (
  items: StaticValue[],
  combinator: "all" | "allSettled",
  tools: PromiseTools,
  location: SourceLocation | null,
): StaticValue => {
  const pending = items.flatMap((item) => {
    const promise = getModeledPromise(item);
    return promise && !promise.settled ? [promise] : [];
  });
  if (pending.some((promise) => promise.isEscaped) || items.some(isPossiblyUnsettled)) {
    return unknownValue(
      `Promise.${combinator} of a promise settled outside the analysis`,
      location,
    );
  }
  const combinedOutcome = (): StaticValue => {
    const outcomes = items.map(outcomeOf);
    if (combinator === "allSettled") return listValue(outcomes.map(settledRecord));
    return outcomes.find(isThrownOutcome) ?? listValue(outcomes);
  };
  if (pending.length === 0) return resolvedPromiseValue(combinedOutcome());
  const combined = createPendingPromise();
  let remaining = pending.length;
  for (const promise of pending) {
    subscribe(
      promise,
      {
        run: (outcome, runTools) => {
          if (combinator === "all" && isThrownOutcome(outcome)) {
            settlePromise(combined, outcome, runTools);
          } else if (--remaining === 0) {
            settlePromise(combined, combinedOutcome(), runTools);
          }
        },
        escape: (escapeTools) => escapePromise(combined, escapeTools),
      },
      tools,
    );
  }
  return combined.value;
};
