import { expect, it, vi } from "vite-plus/test";
import { evaluateBuiltinCall, type BuiltinEvaluator } from "../src/evaluate/builtin-calls.js";
import { createPathPredicate, getAlternativeGuards } from "../src/evaluate/predicates.js";
import { nativeFunction } from "../src/evaluate/stubs.js";
import { hasProperty } from "../src/evaluate/has-property.js";
import { TimerQueue } from "../src/evaluate/timers.js";
import {
  branchValue,
  getObjectProperty,
  listValue,
  objectFromRecord,
  objectValue,
  primitiveValue,
  UNDEFINED_VALUE,
  unknownPrimitiveValue,
} from "../src/evaluate/values.js";
import { loadHostRealm } from "../src/host/host-realm.js";
import { createCallbackValue, createEvaluationContext } from "./helpers/evaluation-context.js";

const unexpectedOperation = (): never => {
  throw new Error("Unexpected evaluator operation");
};

const createBuiltinEvaluator = (overrides: Partial<BuiltinEvaluator> = {}): BuiltinEvaluator => ({
  get graph() {
    return unexpectedOperation();
  },
  get history() {
    return unexpectedOperation();
  },
  get indexedDb() {
    return unexpectedOperation();
  },
  get storageAreas() {
    return unexpectedOperation();
  },
  hostDocument: null,
  origin: null,
  project: { readServedAsset: unexpectedOperation },
  timers: new TimerQueue(),
  getRealm: () => loadHostRealm("ecmascript"),
  callValue: unexpectedOperation,
  callFunction: unexpectedOperation,
  continueValue: unexpectedOperation,
  createFunctionValue: unexpectedOperation,
  evaluateModuleExport: unexpectedOperation,
  importModule: unexpectedOperation,
  getProperty: unexpectedOperation,
  getHasProperty: unexpectedOperation,
  getProxyMethod: unexpectedOperation,
  resolveIterable: unexpectedOperation,
  callAlternatives: unexpectedOperation,
  runMaybe: unexpectedOperation,
  markEscaped: unexpectedOperation,
  recordHeapMutation: unexpectedOperation,
  assignOwnProperty: unexpectedOperation,
  assignProperty: unexpectedOperation,
  setReactApiProperty: unexpectedOperation,
  setGlobalMember: unexpectedOperation,
  materializeNamespace: unexpectedOperation,
  constructSuper: unexpectedOperation,
  construct: unexpectedOperation,
  callDeferred: unexpectedOperation,
  runIntervalTicks: unexpectedOperation,
  runTimerTask: unexpectedOperation,
  queueMicrotask: unexpectedOperation,
  bindContinuationWithCause: (task) => task,
  bindTask: unexpectedOperation,
  runTaskWithCause: unexpectedOperation,
  runTaskAlternatives: unexpectedOperation,
  recordStateMutation: unexpectedOperation,
  ...overrides,
});

it.each([4, 5])("retains the SameValue raw product bound for %i by four choices", (count) => {
  const left = branchValue(
    Array.from({ length: count }, (_value, index) => primitiveValue(index)),
    "left",
  );
  const right = branchValue([1, 5, 6, 7].map(primitiveValue), "right");
  const result = evaluateBuiltinCall(
    createBuiltinEvaluator(),
    { kind: "global", name: "Object.is" },
    [left, right],
    createEvaluationContext(),
    null,
  );
  expect(result?.kind).toBe(count === 4 ? "branch" : "unknown-primitive");
});

it("retains SameValue signed-zero predicates and preferences", () => {
  const source = branchValue(
    [-0, 0].map(primitiveValue),
    "zero",
    null,
    1,
    createPathPredicate("zero", null),
  );
  const result = evaluateBuiltinCall(
    createBuiltinEvaluator(),
    { kind: "global", name: "Object.is" },
    [source, primitiveValue(-0)],
    createEvaluationContext(),
    null,
  );
  expect(result).toMatchObject({
    kind: "branch",
    preferredIndex: 1,
    alternatives: [primitiveValue(true), primitiveValue(false)],
  });
  if (result?.kind !== "branch" || source.kind !== "branch") throw new Error("Expected choices");
  expect(getAlternativeGuards(result)).toEqual(getAlternativeGuards(source));
});

it.each([unknownPrimitiveValue("any", "tag"), unknownPrimitiveValue("string", "tag")])(
  "keeps an unknown $primitiveType tag dynamic",
  (tag) => {
    const getProperty = vi.fn(() => tag);
    const result = evaluateBuiltinCall(
      createBuiltinEvaluator({ getProperty }),
      { kind: "global", name: "Object.prototype.toString.call" },
      [objectValue()],
      createEvaluationContext(),
      null,
    );
    expect(result).toMatchObject({ kind: "unknown-primitive", primitiveType: "string" });
    expect(getProperty).toHaveBeenCalledTimes(1);
  },
);

it("retains an opaque object's unknown builtin tag without invoking stored functions", () => {
  const callback = vi.fn(() => UNDEFINED_VALUE);
  const receiver = objectFromRecord({ method: nativeFunction("opaque", callback) });
  const result = evaluateBuiltinCall(
    createBuiltinEvaluator({ getProperty: () => UNDEFINED_VALUE }),
    { kind: "global", name: "Object.prototype.toString.call" },
    [receiver],
    createEvaluationContext(),
    null,
  );
  expect(result).toMatchObject({ kind: "unknown-primitive", primitiveType: "string" });
  expect(callback).not.toHaveBeenCalled();
});

it("dispatches primitive builtins without an interpreter", () => {
  const context = createEvaluationContext();
  expect(
    evaluateBuiltinCall(
      createBuiltinEvaluator(),
      { kind: "global", name: "String" },
      [primitiveValue(42)],
      context,
      null,
    ),
  ).toEqual(primitiveValue("42"));
});

it("runs one animation frame and escapes a recursively scheduled frame", () => {
  const context = createEvaluationContext();
  const callback = createCallbackValue(context);
  const nestedCallback = createCallbackValue(context);
  const markEscaped = vi.fn<BuiltinEvaluator["markEscaped"]>();
  let evaluator: BuiltinEvaluator;
  const callValue = vi.fn<BuiltinEvaluator["callValue"]>(() => {
    evaluateBuiltinCall(
      evaluator,
      { kind: "global", name: "requestAnimationFrame" },
      [nestedCallback],
      context,
      null,
    );
    return UNDEFINED_VALUE;
  });
  evaluator = createBuiltinEvaluator({
    callValue,
    markEscaped,
    runTimerTask: (_handle, _context, _location, task) => task(),
  });
  evaluateBuiltinCall(
    evaluator,
    { kind: "global", name: "requestAnimationFrame" },
    [callback],
    context,
    null,
  );
  expect(markEscaped).not.toHaveBeenCalled();
  evaluator.timers.runNextTask();
  expect(callValue).toHaveBeenCalledWith(callback, [], context, null);
  expect(markEscaped).toHaveBeenCalledWith(nestedCallback);
  expect(evaluator.timers.hasTasks()).toBe(false);
});

it("constructs Web Audio objects with concrete control surfaces", () => {
  const context = createEvaluationContext();
  const evaluator = createBuiltinEvaluator();
  const audioContext = evaluateBuiltinCall(
    evaluator,
    { kind: "global", name: "AudioContext" },
    [objectValue([{ kind: "property", key: "sampleRate", value: primitiveValue(24_000) }])],
    context,
    null,
    true,
  );
  const workletNode = evaluateBuiltinCall(
    evaluator,
    { kind: "global", name: "AudioWorkletNode" },
    [audioContext, primitiveValue("processor")],
    context,
    null,
    true,
  );
  if (audioContext.kind !== "object" || workletNode.kind !== "object")
    throw new Error("Expected modeled Web Audio objects");
  const port = getObjectProperty(workletNode, "port");
  if (port.kind !== "object") throw new Error("Expected modeled AudioWorklet port");
  expect(getObjectProperty(audioContext, "sampleRate")).toEqual(primitiveValue(24_000));
  expect(getObjectProperty(audioContext, "state")).toMatchObject({
    kind: "unknown-primitive",
    primitiveType: "string",
  });
  expect(getObjectProperty(audioContext, "createGain")).toMatchObject({ kind: "native-function" });
  expect(getObjectProperty(port, "postMessage")).toMatchObject({ kind: "native-function" });
});

it("preserves array callback receivers through builtin dispatch", () => {
  const context = createEvaluationContext();
  const callback = createCallbackValue(context);
  const receiver = listValue([primitiveValue(2), primitiveValue(3)]);
  const callbackThis = objectValue();
  const callValue = vi.fn<BuiltinEvaluator["callValue"]>((_callee, args) => args[0]);
  const result = evaluateBuiltinCall(
    createBuiltinEvaluator({ callValue }),
    { kind: "method", name: "map", receiver },
    [callback, callbackThis],
    context,
    null,
  );
  expect(result).not.toBe(receiver);
  expect(result).toMatchObject({ kind: "list", items: receiver.items });
  expect(callValue).toHaveBeenCalledTimes(2);
  expect(callValue.mock.calls[0][0]).toMatchObject({ kind: "function", boundThis: callbackThis });
  expect(callValue.mock.calls[0].slice(1)).toEqual([
    [receiver.items[0], primitiveValue(0), receiver],
    context,
    null,
  ]);
});

it("journals property definitions through the supplied mutation operation", () => {
  const context = createEvaluationContext();
  const target = objectValue();
  const recordHeapMutation = vi.fn<BuiltinEvaluator["recordHeapMutation"]>();
  const result = evaluateBuiltinCall(
    createBuiltinEvaluator({
      recordHeapMutation,
      getHasProperty: (value, key) => hasProperty(key, value) ?? unexpectedOperation(),
      continueValue: (value, continuationContext, run) => {
        expect(value.kind).not.toBe("branch");
        return run(value, continuationContext);
      },
      getProperty: (value, key) =>
        value.kind === "object" ? getObjectProperty(value, key) : unexpectedOperation(),
    }),
    { kind: "global", name: "Object.defineProperty" },
    [
      target,
      primitiveValue("answer"),
      objectValue([{ kind: "property", key: "value", value: primitiveValue(42) }]),
    ],
    context,
    null,
  );
  expect(result).toBe(target);
  expect(recordHeapMutation).toHaveBeenCalledWith(target);
  expect(recordHeapMutation).toHaveBeenCalledTimes(1);
  expect(getObjectProperty(target, "answer")).toEqual(primitiveValue(42));
});

it("constructs source functions through module operations without the module coordinator", () => {
  const context = createEvaluationContext();
  const addVirtualModule = vi.fn<BuiltinEvaluator["graph"]["addVirtualModule"]>(
    () => context.module,
  );
  const evaluateModuleExport = vi.fn<BuiltinEvaluator["evaluateModuleExport"]>(
    () => UNDEFINED_VALUE,
  );
  const evaluator = createBuiltinEvaluator({
    graph: {
      resolver: { rootDirectory: "/", extensions: [] },
      addVirtualModule,
      resolveImportedModule: unexpectedOperation,
    },
    evaluateModuleExport,
  });
  expect(
    evaluateBuiltinCall(
      evaluator,
      { kind: "global", name: "Function" },
      [primitiveValue("value"), primitiveValue("return value;")],
      context,
      null,
    ),
  ).toBe(UNDEFINED_VALUE);
  expect(addVirtualModule.mock.calls[0][1]).toContain("function anonymous(value");
  expect(evaluateModuleExport).toHaveBeenCalledWith(context.module, "default");
});
