import { expect, it, vi } from "vite-plus/test";
import type { StaticValue } from "../src/types.js";
import { callWithArgumentList } from "../src/evaluate/array-like.js";
import {
  getObjectProperty,
  listValue,
  objectValue,
  primitiveValue,
} from "../src/evaluate/values.js";
import { loadHostRealm } from "../src/host/host-realm.js";
import { createEvaluationContext } from "./helpers/evaluation-context.js";

const createEvaluator = () => ({
  getRealm: () => loadHostRealm("ecmascript"),
  getProperty: vi.fn((receiver: StaticValue, key: string) => {
    if (receiver.kind !== "object") throw new Error("Unexpected property receiver");
    return getObjectProperty(receiver, key);
  }),
  callAlternatives: (): never => {
    throw new Error("Unexpected branch");
  },
});

it("preserves the existing 1,000-element array-like boundary", () => {
  const evaluator = createEvaluator();
  const source = objectValue([{ kind: "property", key: "length", value: primitiveValue(1000) }]);
  const invoke = vi.fn((args: StaticValue[]) => primitiveValue(args.length));
  expect(
    callWithArgumentList(evaluator, source, createEvaluationContext(), null, false, invoke),
  ).toEqual(primitiveValue(1000));
  expect(evaluator.getProperty).toHaveBeenCalledTimes(1001);
  expect(invoke).toHaveBeenCalledTimes(1);
});

it("does not fabricate a target call when the argument list exceeds its existing bound", () => {
  const evaluator = createEvaluator();
  const source = objectValue([{ kind: "property", key: "length", value: primitiveValue(1001) }]);
  const invoke = vi.fn(() => primitiveValue("called"));
  const result = callWithArgumentList(
    evaluator,
    source,
    createEvaluationContext(),
    null,
    false,
    invoke,
  );
  expect(result).toMatchObject({
    kind: "unknown",
    reason: "argument list exceeds supported length",
  });
  expect(evaluator.getProperty).toHaveBeenCalledTimes(1);
  expect(invoke).not.toHaveBeenCalled();
});

it("keeps 10,000 definite arguments supported with independent argument storage", () => {
  const nativeSource = Array.from({ length: 10000 }, (_value, index) => index);
  const nativeResult = Reflect.apply(
    (...args: number[]) => {
      args.push(10000);
      return args.length;
    },
    null,
    nativeSource,
  );
  const source = listValue(nativeSource.map(primitiveValue));
  const evaluator = createEvaluator();
  const result = callWithArgumentList(
    evaluator,
    source,
    createEvaluationContext(),
    null,
    false,
    (args) => {
      args.push(primitiveValue(10000));
      return primitiveValue(args.length);
    },
  );
  expect(result).toEqual(primitiveValue(nativeResult));
  expect(source.items).toHaveLength(nativeSource.length);
  expect(source.items[9999]).toEqual(primitiveValue(nativeSource[9999]));
  expect(evaluator.getProperty).not.toHaveBeenCalled();
});
