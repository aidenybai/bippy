import { expect, it, vi } from "vite-plus/test";
import {
  constructClassInstance,
  evaluateClassMembers,
  getClassPrototypeObject,
  renderClassComponent,
  type ClassEvaluator,
} from "../src/evaluate/class-component.js";
import { beginHookPass } from "../src/evaluate/hooks.js";
import type { FunctionFactory } from "../src/evaluate/context.js";
import {
  getObjectProperty,
  objectValue,
  primitiveValue,
  UNDEFINED_VALUE,
} from "../src/evaluate/values.js";
import { loadHostRealm } from "../src/host/host-realm.js";
import { createModuleRecord } from "../src/graph/module-record.js";
import { parseSourceText } from "../src/parse/parse-source-file.js";
import type { StaticClassValue, StaticObjectValue } from "../src/types.js";
import { createEvaluationContext } from "./helpers/evaluation-context.js";

const unexpectedOperation = (): never => {
  throw new Error("Unexpected evaluator operation");
};

const createFunctionValue: FunctionFactory["createFunctionValue"] = (node, context, name) => ({
  kind: "function",
  node,
  scope: context.scope,
  module: context.module,
  thisValue: null,
  superBinding: context.superBinding,
  name,
  properties: objectValue(),
});

const createClassValue = (): StaticClassValue => {
  const context = createEvaluationContext();
  context.module = createModuleRecord(
    parseSourceText("/class.ts", "class Fixture { constructor() {} render() {} }", "ts"),
  );
  const node = context.module.file.program.body[0];
  if (node?.type !== "ClassDeclaration") throw new Error("Expected a class fixture");
  const value = evaluateClassMembers(
    {
      createFunctionValue,
      evaluateExpression: unexpectedOperation,
      continueValue: unexpectedOperation,
    },
    node,
    context,
    (members) => ({
      kind: "class",
      node,
      scope: context.scope,
      module: context.module,
      name: "Fixture",
      body: { members, superValue: null },
      properties: objectValue(),
    }),
  );
  if (value.kind !== "class") throw new Error("Expected a modeled class");
  return value;
};

const createClassEvaluator = (overrides: Partial<ClassEvaluator> = {}): ClassEvaluator => ({
  assumeOuterProviders: false,
  pendingSuperBindings: new WeakMap(),
  createFunctionValue,
  evaluateExpression: unexpectedOperation,
  continueValue: (value, context, proceed) => proceed(value, context),
  getThisValue: unexpectedOperation,
  getRealm: () => loadHostRealm("ecmascript"),
  getConstructorResult: (_returned, instance) => instance,
  recordHeapMutation: unexpectedOperation,
  callValue: unexpectedOperation,
  callFunction: () => UNDEFINED_VALUE,
  ...overrides,
});

it("builds and caches class prototypes using only a function factory", () => {
  const context = createEvaluationContext();
  const classValue = createClassValue();
  const factory = { createFunctionValue: vi.fn(createFunctionValue) };
  const prototype = getClassPrototypeObject(factory, classValue, context);
  expect(getClassPrototypeObject(factory, classValue, context)).toBe(prototype);
  expect(factory.createFunctionValue).toHaveBeenCalledTimes(2);
  expect(getObjectProperty(prototype, "constructor")).toBe(classValue);
  expect(getObjectProperty(prototype, "render")).toMatchObject({
    kind: "function",
    thisValue: UNDEFINED_VALUE,
  });
});

it("exposes pending super bindings only while a constructor runs", () => {
  const context = createEvaluationContext();
  const evaluator = createClassEvaluator();
  const callFunction = vi.fn<ClassEvaluator["callFunction"]>(
    (_callback, _args, _context, options) => {
      const instance = options?.thisValue;
      if (instance?.kind !== "object") throw new Error("Expected a constructor receiver");
      expect(evaluator.pendingSuperBindings.has(instance)).toBe(true);
      return UNDEFINED_VALUE;
    },
  );
  evaluator.callFunction = callFunction;
  const result = constructClassInstance(evaluator, createClassValue(), [], context);
  expect(result.kind).toBe("object");
  if (result.kind !== "object") throw new Error("Expected an instance");
  expect(evaluator.pendingSuperBindings.has(result)).toBe(false);
  expect(callFunction).toHaveBeenCalledTimes(1);
});

it("cleans up pending construction state when evaluation throws", () => {
  const evaluator = createClassEvaluator();
  const instances: StaticObjectValue[] = [];
  const failure = new Error("Constructor evaluation failed");
  evaluator.callFunction = (_callback, _args, _context, options) => {
    if (options?.thisValue?.kind === "object") instances.push(options.thisValue);
    throw failure;
  };
  expect(() =>
    constructClassInstance(evaluator, createClassValue(), [], createEvaluationContext()),
  ).toThrow(failure);
  expect(instances).toHaveLength(1);
  expect(evaluator.pendingSuperBindings.has(instances[0])).toBe(false);
});

it("reuses the class instance across renders on the same hook frame", () => {
  const context = createEvaluationContext();
  const classValue = createClassValue();
  const callFunction = vi.fn<ClassEvaluator["callFunction"]>((callback) =>
    callback.name === "render" ? primitiveValue("rendered") : UNDEFINED_VALUE,
  );
  const evaluator = createClassEvaluator({ callFunction });
  expect(
    renderClassComponent(evaluator, classValue, objectValue(), null, context).rendered,
  ).toEqual(primitiveValue("rendered"));
  beginHookPass(context.hooks);
  expect(
    renderClassComponent(evaluator, classValue, objectValue(), null, context).rendered,
  ).toEqual(primitiveValue("rendered"));
  expect(
    callFunction.mock.calls.filter(([callback]) => callback.name === "constructor"),
  ).toHaveLength(1);
  const renderCalls = callFunction.mock.calls.filter(([callback]) => callback.name === "render");
  expect(renderCalls).toHaveLength(2);
  expect(renderCalls[0][3]?.thisValue).toBe(renderCalls[1][3]?.thisValue);
});
