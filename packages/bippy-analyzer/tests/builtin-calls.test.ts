import { expect, it, vi } from "vite-plus/test";
import { evaluateBuiltinCall, type BuiltinEvaluator } from "../src/evaluate/builtin-calls.js";
import { TimerQueue } from "../src/evaluate/timers.js";
import {
  getObjectProperty,
  listValue,
  objectValue,
  primitiveValue,
  UNDEFINED_VALUE,
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
  createFunctionValue: unexpectedOperation,
  evaluateModuleExport: unexpectedOperation,
  importModule: unexpectedOperation,
  getProperty: unexpectedOperation,
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
    createBuiltinEvaluator({ recordHeapMutation }),
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
