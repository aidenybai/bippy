import type { StaticObjectValue, StaticValue } from "../types.js";
import { nativeFunction } from "./stubs.js";
import {
  hasDefiniteItems,
  listValue,
  objectFromRecord,
  primitiveValue,
  UNDEFINED_VALUE,
  unknownValue,
} from "./values.js";

interface GeneratorState {
  yields: StaticValue[];
  returned: StaticValue;
  position: number;
}

const generatorsByValue = new WeakMap<StaticObjectValue, GeneratorState>();

const iterationResult = (value: StaticValue, isDone: boolean): StaticValue =>
  objectFromRecord({ value, done: primitiveValue(isDone) });

/**
 * A generator object whose body already ran to completion, so iteration
 * replays its `yield`s in order. Effects the body interleaves with its
 * consumer therefore happen before the consumer's first `next()`.
 */
export const createGeneratorValue = (
  yields: StaticValue[],
  returned: StaticValue,
): StaticObjectValue => {
  const state: GeneratorState = { yields, returned, position: 0 };
  const finish = (): StaticValue => {
    const isFirstFinish = state.position === state.yields.length;
    state.position = state.yields.length + 1;
    return iterationResult(isFirstFinish ? state.returned : UNDEFINED_VALUE, true);
  };
  const generator = objectFromRecord({
    next: nativeFunction("next", () => {
      if (!hasDefiniteItems(listValue(state.yields)))
        return unknownValue("step of a generator with an uncertain number of yields");
      if (state.position >= state.yields.length) return finish();
      return iterationResult(state.yields[state.position++], false);
    }),
    return: nativeFunction("return", () => finish()),
    throw: nativeFunction("throw", () => finish()),
  });
  generatorsByValue.set(generator, state);
  return generator;
};

/** What iterating a generator object yields from its current position; iterating exhausts it. */
export const getGeneratorItems = (value: StaticValue): StaticValue | null => {
  const state = value.kind === "object" ? generatorsByValue.get(value) : undefined;
  if (!state) return null;
  const remaining = state.yields.slice(Math.min(state.position, state.yields.length));
  state.position = state.yields.length + 1;
  return listValue(remaining);
};
