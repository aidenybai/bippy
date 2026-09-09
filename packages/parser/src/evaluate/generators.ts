import type { StaticObjectValue, StaticValue } from "../types.js";
import { nativeFunction } from "../frameworks/stubs.js";
import { getThrowCertainty, withoutThrows } from "./thrown.js";
import {
  hasDefiniteItems,
  listValue,
  objectFromRecord,
  primitiveValue,
  thrownValue,
  UNDEFINED_VALUE,
  unknownValue,
} from "./values.js";

/** The rest of a generator body after a `yield`, run with the value `next(sent)` sends in; null when it yielded again. */
export interface GeneratorResumption {
  (sent: StaticValue): StaticValue | null;
}

/** A pending `yield`: what the generator yielded and how its body goes on. */
export interface GeneratorSuspension {
  yielded: StaticValue;
  resume: GeneratorResumption;
}

/**
 * A generator activation. A `yield` that leads its statement suspends the body
 * as `suspension`; one the body cannot suspend at (inside a loop, `yield*`) is
 * evaluated eagerly and `collected`, its sent value unknown.
 */
export interface GeneratorCall {
  kind: "generator";
  suspension: GeneratorSuspension | null;
  collected: StaticValue[];
}

export interface GeneratorRun {
  (): StaticValue | null;
}

interface GeneratorStep {
  value: StaticValue;
  isDone: boolean;
  /** `value` is what `next()` throws or cannot determine rather than an iteration result. */
  isAbrupt: boolean;
}

interface GeneratorState {
  call: GeneratorCall;
  start: GeneratorRun;
  resume: GeneratorResumption | null;
  queue: StaticValue[];
  /** The body's return value once it completed, handed out by the `next()` that reports `done`. */
  returned: StaticValue | null;
  isStarted: boolean;
  isDone: boolean;
}

const generatorsByValue = new WeakMap<StaticObjectValue, GeneratorState>();

const iterationResult = (value: StaticValue, isDone: boolean): StaticValue =>
  objectFromRecord({ value, done: primitiveValue(isDone) });

const abruptStep = (value: StaticValue): GeneratorStep => ({ value, isDone: true, isAbrupt: true });

const dequeue = (state: GeneratorState): GeneratorStep => {
  if (!hasDefiniteItems(listValue(state.queue))) {
    state.queue = [];
    return abruptStep(unknownValue("step of a generator with an uncertain number of yields"));
  }
  const [value, ...rest] = state.queue;
  state.queue = rest;
  return { value: value ?? UNDEFINED_VALUE, isDone: false, isAbrupt: false };
};

const close = (state: GeneratorState): void => {
  state.isDone = true;
  state.resume = null;
  state.returned = null;
  state.queue = [];
};

const finish = (state: GeneratorState): GeneratorStep => {
  const returned = state.returned;
  state.returned = null;
  if (returned === null) return { value: UNDEFINED_VALUE, isDone: true, isAbrupt: false };
  if (getThrowCertainty(returned) === "always") return abruptStep(returned);
  return { value: withoutThrows(returned), isDone: true, isAbrupt: false };
};

/** Runs the body until it yields again or completes, queueing what it yielded meanwhile. */
const advance = (state: GeneratorState, run: GeneratorRun): GeneratorStep => {
  const returned = run();
  const { call } = state;
  state.queue.push(...call.collected.splice(0));
  if (call.suspension) {
    state.queue.push(call.suspension.yielded);
    state.resume = call.suspension.resume;
    call.suspension = null;
  } else {
    state.isDone = true;
    state.returned = returned;
  }
  return state.queue.length > 0 ? dequeue(state) : finish(state);
};

const step = (state: GeneratorState, sent: StaticValue): GeneratorStep => {
  if (state.queue.length > 0) return dequeue(state);
  if (state.isDone) return finish(state);
  if (!state.isStarted) {
    state.isStarted = true;
    return advance(state, state.start);
  }
  const resume = state.resume;
  if (!resume) return finish(state);
  state.resume = null;
  return advance(state, () => resume(sent));
};

const stepResult = (generatorStep: GeneratorStep): StaticValue =>
  generatorStep.isAbrupt
    ? generatorStep.value
    : iterationResult(generatorStep.value, generatorStep.isDone);

/**
 * A generator object: `next(sent)` runs the body to its next `yield`, or to
 * completion, and `sent` is what the `yield` it resumes evaluates to.
 */
export const createGeneratorValue = (
  call: GeneratorCall,
  start: GeneratorRun,
): StaticObjectValue => {
  const state: GeneratorState = {
    call,
    start,
    resume: null,
    queue: [],
    returned: null,
    isStarted: false,
    isDone: false,
  };
  const generator = objectFromRecord({
    next: nativeFunction("next", ([sent]) => stepResult(step(state, sent ?? UNDEFINED_VALUE))),
    return: nativeFunction("return", ([value]) => {
      close(state);
      return iterationResult(value ?? UNDEFINED_VALUE, true);
    }),
    throw: nativeFunction("throw", ([error]) => {
      const thrown = thrownValue("generator throw", error ?? UNDEFINED_VALUE);
      if (state.queue.length > 0 || !state.resume) {
        close(state);
        return thrown;
      }
      return stepResult(step(state, thrown));
    }),
  });
  generatorsByValue.set(generator, state);
  return generator;
};

/** What iterating a generator object yields from its current position; iterating exhausts it. */
export const getGeneratorItems = (value: StaticValue): StaticValue | null => {
  const state = value.kind === "object" ? generatorsByValue.get(value) : undefined;
  if (!state) return null;
  const items: StaticValue[] = [];
  for (;;) {
    const generatorStep = step(state, UNDEFINED_VALUE);
    if (generatorStep.isAbrupt) return generatorStep.value;
    if (generatorStep.isDone) return listValue(items);
    items.push(generatorStep.value);
  }
};
