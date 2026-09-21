import { expect, it, vi } from "vite-plus/test";
import type { StaticValue } from "../src/types.js";
import type { EvaluationContext } from "../src/evaluate/context.js";
import { reflectConstruct } from "../src/evaluate/reflect-construct.js";
import { loadHostRealm } from "../src/host/host-realm.js";
import {
  branchValue,
  getObjectProperty,
  listValue,
  objectValue,
  primitiveValue,
  unknownValue,
} from "../src/evaluate/values.js";
import { createCallbackValue, createEvaluationContext } from "./helpers/evaluation-context.js";

const unexpectedOperation = (): never => {
  throw new Error("Unexpected constructor operation");
};
const createEvaluator = () => ({
  getRealm: vi.fn(() => loadHostRealm("ecmascript")),
  getProperty: vi.fn((source: StaticValue, key: string) => {
    if (source.kind !== "object") return unexpectedOperation();
    return getObjectProperty(source, key);
  }),
  callAlternatives: (
    value: StaticValue,
    context: EvaluationContext,
    proceed: (value: StaticValue, context: EvaluationContext) => StaticValue,
  ): StaticValue =>
    value.kind === "branch"
      ? branchValue(
          value.alternatives.map((alternative) => proceed(alternative, context)),
          "constructor alternatives",
        )
      : proceed(value, context),
  construct: vi.fn((_target: StaticValue, args: StaticValue[]) => primitiveValue(args.length)),
  constructSuper: unexpectedOperation,
});
it.each([1000, 1001])("retains the array-like construction limit at %i", (count) => {
  const evaluator = createEvaluator();
  const source = objectValue([{ kind: "property", key: "length", value: primitiveValue(count) }]);
  const result = reflectConstruct(
    evaluator,
    [{ kind: "global", name: "Array" }, source],
    createEvaluationContext(),
    null,
  );
  if (count === 1000) {
    expect(result).toEqual(primitiveValue(1000));
    expect(evaluator.construct).toHaveBeenCalledTimes(1);
    expect(evaluator.getProperty).toHaveBeenCalledTimes(1001);
  } else {
    expect(result).toMatchObject({
      kind: "unknown",
      reason: "argument list exceeds supported length",
    });
    expect(evaluator.construct).not.toHaveBeenCalled();
    expect(evaluator.getProperty).toHaveBeenCalledTimes(1);
  }
});
it("keeps 10000 definite construction arguments independent", () => {
  const nativeSource = Array.from({ length: 10000 }, (_value, index) => index);
  const NativeTarget = class {
    length: number;
    constructor(...values: number[]) {
      values.push(10000);
      this.length = values.length;
    }
  };
  const native = Reflect.construct(NativeTarget, nativeSource);
  const source = listValue(nativeSource.map(primitiveValue));
  const evaluator = createEvaluator();
  evaluator.construct.mockImplementation((_target, args) => {
    args.push(primitiveValue(10000));
    return primitiveValue(args.length);
  });
  expect(
    reflectConstruct(
      evaluator,
      [{ kind: "global", name: "Array" }, source],
      createEvaluationContext(),
      null,
    ),
  ).toEqual(primitiveValue(native.length));
  expect(source.items).toHaveLength(nativeSource.length);
  expect(evaluator.getProperty).not.toHaveBeenCalled();
});
it.each([4, 5])("bounds raw constructor choices before correlated pruning: %i by %i", (count) => {
  const context = createEvaluationContext();
  const target = branchValue(
    Array.from({ length: count }, () => createCallbackValue(createEvaluationContext())),
    "targets",
  );
  const evaluator = createEvaluator();
  const result = reflectConstruct(evaluator, [target, listValue([]), target], context, null);
  if (count === 4) {
    expect(evaluator.getRealm).toHaveBeenCalled();
    expect(result).not.toMatchObject({
      kind: "unknown",
      reason: "Reflect.construct exceeds supported constructor alternatives",
    });
  } else {
    expect(result).toMatchObject({
      kind: "unknown",
      reason: "Reflect.construct exceeds supported constructor alternatives",
    });
    expect(evaluator.getRealm).not.toHaveBeenCalled();
  }
  expect(evaluator.getProperty).not.toHaveBeenCalled();
  expect(evaluator.construct).not.toHaveBeenCalled();
});
it.each([false, true])(
  "does not fabricate acquisition for a dynamic constructor: newTarget=%s",
  (isNewTarget) => {
    const target: StaticValue = { kind: "global", name: "Array" };
    const dynamic = unknownValue("opaque constructor");
    const evaluator = createEvaluator();
    const result = reflectConstruct(
      evaluator,
      isNewTarget ? [target, objectValue(), dynamic] : [dynamic, objectValue()],
      createEvaluationContext(),
      null,
    );
    expect(result).toMatchObject({
      kind: "unknown",
      reason: isNewTarget
        ? "Reflect.construct with a dynamic new.target"
        : "Reflect.construct with a dynamic target",
    });
    expect(evaluator.getProperty).not.toHaveBeenCalled();
    expect(evaluator.construct).not.toHaveBeenCalled();
  },
);
