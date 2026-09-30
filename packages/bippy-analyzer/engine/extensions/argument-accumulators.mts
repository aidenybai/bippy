import { surroundingAgent, type Agent, type Value } from "#self";

interface ArgumentAccumulatorInfo {
  readonly agent: Agent;
  readonly kind: "arguments" | "template-substitutions";
}

const accumulators = new WeakMap<object, ArgumentAccumulatorInfo>();

export const createArgumentAccumulator = (kind: ArgumentAccumulatorInfo["kind"]): Value[] => {
  if (kind !== "arguments" && kind !== "template-substitutions")
    throw new TypeError("Invalid argument accumulator kind");
  const list: Value[] = [];
  accumulators.set(list, Object.freeze({ agent: surroundingAgent, kind }));
  return list;
};

export const getArgumentAccumulatorInfo = (value: object): ArgumentAccumulatorInfo | undefined =>
  accumulators.get(value);
