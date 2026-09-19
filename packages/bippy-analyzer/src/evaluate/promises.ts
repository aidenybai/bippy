import type { SourceLocation } from "../parse/source-types.js";
import type {
  JournaledState,
  StaticObjectValue,
  StaticUnknownValue,
  StaticValue,
  StubRenderTools,
} from "../types.js";
import { createErrorValue } from "./errors.js";
import { getAlternativeGuards } from "./predicates.js";
import {
  branchValue,
  listValue,
  mapValue,
  objectValue,
  primitiveValue,
  thrownValue,
  UNDEFINED_VALUE,
  unknownValue,
} from "./values.js";

export interface PromiseTools extends Pick<
  StubRenderTools,
  | "call"
  | "callDeferred"
  | "markEscaped"
  | "queueMicrotask"
  | "bindTask"
  | "runTask"
  | "runTaskAlternatives"
  | "recordStateMutation"
> {}

export interface PromiseReaction {
  run: (outcome: StaticValue, tools: PromiseTools) => void;
  escape: (tools: PromiseTools) => void;
}

const PENDING_STATE: StaticObjectValue = { kind: "object", entries: [] };
const ESCAPED_STATE: StaticObjectValue = { kind: "object", entries: [] };
const outcomesByState = new WeakMap<StaticValue, StaticValue>();
const followingStates = new WeakSet<StaticValue>();
const promisesByValue = new WeakMap<StaticObjectValue, ModeledPromise>();

const getSettledValue = (state: StaticValue): StaticValue | null => {
  if (state.kind !== "branch") return outcomesByState.get(state) ?? null;
  if (state.alternatives.some((alternative) => getSettledValue(alternative) === null)) return null;
  return mapValue(state, (alternative) => getSettledValue(alternative) ?? UNDEFINED_VALUE);
};

const createSettledState = (outcome: StaticValue): StaticValue => {
  const state = objectValue();
  outcomesByState.set(state, outcome);
  return state;
};

export class ModeledPromise implements JournaledState<StaticValue> {
  readonly allocation = 0;
  readonly value = objectValue();
  readonly reactions: PromiseReaction[] = [];
  state: StaticValue = PENDING_STATE;

  get settled(): StaticValue | null {
    return getSettledValue(this.state);
  }

  get isEscaped(): boolean {
    return this.state === ESCAPED_STATE || this.state.kind === "unknown";
  }

  capture(): StaticValue {
    return this.state;
  }

  restore(state: StaticValue): void {
    this.state = state;
  }

  join(
    states: StaticValue[],
    reason: string,
    location: SourceLocation | null,
    preferredPath: number,
    predicate?: string | null,
  ): void {
    this.state = branchValue(states, reason, location, preferredPath, predicate ?? null);
  }
}

export interface AsyncCall {
  result: ModeledPromise | null;
}

interface AwaitResumption {
  (outcome: StaticValue, isEscaped: boolean): StaticValue | null;
}

export const getModeledPromise = (value: StaticValue): ModeledPromise | null =>
  value.kind === "object" ? (promisesByValue.get(value) ?? null) : null;

export const isThrownOutcome = (
  value: StaticValue,
): value is StaticUnknownValue & { thrown: StaticValue } =>
  value.kind === "unknown" && value.thrown !== undefined;

const createPendingPromise = (): ModeledPromise => {
  const promise = new ModeledPromise();
  promisesByValue.set(promise.value, promise);
  return promise;
};

const visitState = (
  state: StaticValue,
  tools: PromiseTools,
  visit: (state: StaticValue) => void,
): void => {
  if (state.kind !== "branch") return visit(state);
  const resolved = getAlternativeGuards(state);
  if (!resolved) return visit(ESCAPED_STATE);
  state.alternatives.forEach((alternative, index) => {
    tools.runTask({ guard: resolved.guards[index], inputs: [...resolved.inputs] }, () =>
      visitState(alternative, tools, visit),
    );
  });
};

const resolvePromise = (outcome: StaticValue): ModeledPromise => {
  const modeled = getModeledPromise(outcome);
  if (modeled) return modeled;
  const promise = createPendingPromise();
  promise.state = createSettledState(outcome);
  return promise;
};

export const resolvedPromiseValue = (outcome: StaticValue): StaticValue =>
  resolvePromise(outcome).value;

export const awaitedValue = (
  value: StaticValue,
  location: SourceLocation | null,
  drainMicrotasks: () => void,
): StaticValue => {
  const promise = getModeledPromise(value);
  if (!promise) return value;
  if (!promise.settled && !promise.isEscaped) drainMicrotasks();
  return mapValue(
    promise.state,
    (state) =>
      outcomesByState.get(state) ?? unknownValue("promise settled asynchronously", location),
  );
};

export const isAwaitDeferred = (operand: StaticValue, awaited: StaticValue): boolean =>
  !getModeledPromise(operand)?.settled && isPossiblyUnsettled(awaited);

export const isPossiblyUnsettled = (value: StaticValue): boolean =>
  (value.kind === "unknown" && !isThrownOutcome(value)) ||
  value.kind === "external" ||
  (value.kind === "branch" && value.alternatives.some(isPossiblyUnsettled));

export const getAwaitPromise = (value: StaticValue): ModeledPromise | null => {
  const promise = getModeledPromise(value);
  if (promise) return promise;
  if (isThrownOutcome(value) || isPossiblyUnsettled(value)) return null;
  return resolvePromise(value);
};

export const suspendOnPromise = (
  call: AsyncCall,
  promise: ModeledPromise,
  resume: AwaitResumption,
  location: SourceLocation | null,
  tools: PromiseTools,
): void => {
  const result = call.result ?? createPendingPromise();
  call.result = result;
  subscribe(
    promise,
    {
      run: (outcome, runTools) => {
        const returned = resume(outcome, false);
        if (returned) settlePromise(result, returned, runTools);
      },
      escape: (escapeTools) => {
        const reason = "promise settled outside the analysis";
        const outcome = branchValue(
          [
            unknownValue("promise fulfilled outside the analysis", location),
            thrownValue(
              "promise rejected outside the analysis",
              unknownValue("promise rejection reason", location),
              location,
            ),
          ],
          reason,
          location,
        );
        if (outcome.kind === "branch") {
          const alternatives = getAlternativeGuards(outcome);
          if (alternatives) {
            escapeTools.runTaskAlternatives(
              alternatives.guards.map((guard) => ({
                guard,
                inputs: [...alternatives.inputs],
              })),
              (index) => {
                const alternative = outcome.alternatives[index];
                if (alternative) resume(alternative, true);
              },
              reason,
            );
          } else {
            resume(outcome, true);
          }
        } else {
          resume(outcome, true);
        }
        escapePromise(result, escapeTools);
      },
    },
    tools,
  );
};

const escapePromise = (
  promise: ModeledPromise,
  tools: PromiseTools,
  pendingState: StaticValue = PENDING_STATE,
): void => {
  visitState(promise.state, tools, (state) => {
    if (state !== pendingState) return;
    tools.recordStateMutation(promise);
    promise.state = ESCAPED_STATE;
    for (const reaction of promise.reactions) reaction.escape(tools);
  });
};

export const escapedPromiseValue = (): StaticValue => {
  const promise = createPendingPromise();
  promise.state = ESCAPED_STATE;
  return promise.value;
};

const settlePromise = (
  promise: ModeledPromise,
  outcome: StaticValue,
  tools: PromiseTools,
  pendingState: StaticValue = PENDING_STATE,
): void => {
  visitState(promise.state, tools, (state) => {
    if (state !== pendingState) return;
    const adopted = getModeledPromise(outcome);
    if (adopted && adopted !== promise) {
      const following = objectValue();
      followingStates.add(following);
      tools.recordStateMutation(promise);
      promise.state = following;
      tools.queueMicrotask(() => subscribe(adopted, forwardTo(promise, following), tools));
      return;
    }
    const settled =
      adopted === promise
        ? thrownValue(
            "promise resolved with itself",
            createErrorValue(
              "TypeError",
              [primitiveValue("Chaining cycle detected for promise")],
              null,
            ),
            null,
          )
        : outcome;
    tools.recordStateMutation(promise);
    promise.state = createSettledState(settled);
    for (const reaction of promise.reactions) {
      tools.queueMicrotask(() => reaction.run(settled, tools));
    }
  });
};

const forwardTo = (target: ModeledPromise, following: StaticValue): PromiseReaction => ({
  run: (outcome, tools) => settlePromise(target, outcome, tools, following),
  escape: (tools) => escapePromise(target, tools, following),
});

export const onPromiseSettled = (
  promise: ModeledPromise,
  onSettled: (isEscaped: boolean) => void,
  tools: PromiseTools,
): void =>
  subscribe(
    promise,
    {
      run: () => onSettled(false),
      escape: () => onSettled(true),
    },
    tools,
  );

const subscribe = (
  promise: ModeledPromise,
  reaction: PromiseReaction,
  tools: PromiseTools,
): void => {
  visitState(promise.state, tools, (state) => {
    if (state === PENDING_STATE || followingStates.has(state)) {
      const run = tools.bindTask((outcome: StaticValue | null, runTools: PromiseTools) => {
        if (outcome) reaction.run(outcome, runTools);
        else reaction.escape(runTools);
      });
      const guardedReaction: PromiseReaction = {
        run,
        escape: (escapeTools) => run(null, escapeTools),
      };
      promise.reactions.push(guardedReaction);
      return;
    }
    const outcome = outcomesByState.get(state);
    if (outcome) tools.queueMicrotask(() => reaction.run(outcome, tools));
    else reaction.escape(tools);
  });
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
    if (isThrownOutcome(result)) return result;
    return chainPromise(
      resolvePromise(result),
      {
        onFulfilled: { kind: "native-function", name: "finally fulfilled", call: () => outcome },
        onRejected: null,
        onFinally: null,
      },
      tools,
      null,
    );
  }
  const handler = isThrownOutcome(outcome) ? handlers.onRejected : handlers.onFulfilled;
  if (!handler) return outcome;
  return tools.call(handler, [isThrownOutcome(outcome) ? outcome.thrown : outcome]);
};

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

const settleCombinedPromise = (
  combined: ModeledPromise,
  receipts: ModeledPromise[],
  outcomes: StaticValue[],
  tools: PromiseTools,
): void => {
  if (outcomes.length === receipts.length) {
    settlePromise(combined, listValue(outcomes), tools);
    return;
  }
  visitState(receipts[outcomes.length].state, tools, (state) => {
    if (state === PENDING_STATE || followingStates.has(state)) return;
    const outcome = outcomesByState.get(state);
    if (!outcome) escapePromise(combined, tools);
    else if (isThrownOutcome(outcome)) settlePromise(combined, outcome, tools);
    else settleCombinedPromise(combined, receipts, [...outcomes, outcome], tools);
  });
};

export const combinePromises = (
  items: StaticValue[],
  tools: PromiseTools,
  location: SourceLocation | null,
): StaticValue => {
  if (items.some(isPossiblyUnsettled)) {
    return unknownValue("Promise.all of a promise settled outside the analysis", location);
  }
  if (items.length === 0) return resolvedPromiseValue(listValue([]));
  const combined = createPendingPromise();
  const receipts = items.map(() => createPendingPromise());
  items.forEach((item, index) => {
    const promise = resolvePromise(item);
    subscribe(
      promise,
      {
        run: (outcome, runTools) => {
          settlePromise(receipts[index], outcome, runTools);
          if (isThrownOutcome(outcome)) settlePromise(combined, outcome, runTools);
          else settleCombinedPromise(combined, receipts, [], runTools);
        },
        escape: (escapeTools) => escapePromise(combined, escapeTools),
      },
      tools,
    );
  });
  return combined.value;
};
