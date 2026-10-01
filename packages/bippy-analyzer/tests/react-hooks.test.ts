import { describe, expect, it, vi } from "vite-plus/test";
import { beginHookPass, escapeStateCell, queueReducerAction } from "../src/evaluate/hooks.js";
import { resolvedPromiseValue } from "../src/evaluate/promises.js";
import {
  evaluateReactHook,
  type ReactHookApi,
  type ReactHookEvaluator,
} from "../src/evaluate/react-hooks.js";
import { nativeFunction } from "../src/evaluate/stubs.js";
import {
  branchValue,
  getObjectProperty,
  listValue,
  mapValue,
  primitiveValue,
  thrownValue,
  UNDEFINED_VALUE,
} from "../src/evaluate/values.js";
import type { ContextDefinition } from "../src/types.js";
import { createCallbackValue, createEvaluationContext } from "./helpers/evaluation-context.js";

const createEvaluator = (): ReactHookEvaluator => ({
  assumeOuterProviders: false,
  timers: { drainMicrotasks: vi.fn() },
  callFunction: vi.fn(() => {
    throw new Error("Unexpected function call");
  }),
  callValue: vi.fn(() => {
    throw new Error("Unexpected value call");
  }),
  callAlternatives: vi.fn((branch, context, call) =>
    mapValue(branch, (alternative) => call(alternative, context)),
  ),
  report: vi.fn(),
});

describe("React hooks without an interpreter", () => {
  it("runs a strict initializer twice on mount, keeps its first result, and reuses the setter", () => {
    const context = createEvaluationContext();
    context.hooks.doublesHookFactories = true;
    const evaluator = createEvaluator();
    const initial = primitiveValue(1);
    vi.mocked(evaluator.callFunction)
      .mockReturnValueOnce(initial)
      .mockReturnValueOnce(primitiveValue(2));
    const callback = createCallbackValue(context);
    beginHookPass(context.hooks);
    const mounted = evaluateReactHook(evaluator, "useState", [callback], context, null, "count");
    const setter = context.hooks.cells[0].setter;
    expect(setter).not.toBeNull();
    expect(mounted).toMatchObject({ kind: "list", items: [initial, setter] });
    expect(evaluator.callFunction).toHaveBeenCalledTimes(2);
    beginHookPass(context.hooks);
    const updated = evaluateReactHook(evaluator, "useState", [callback], context, null, "count");
    expect(updated).toMatchObject({ kind: "list", items: [initial, setter] });
    expect(context.hooks.cells[0].setter).toBe(setter);
    expect(evaluator.callFunction).toHaveBeenCalledTimes(2);
  });

  it("retains uncertain state when no component frame is available", () => {
    const evaluator = createEvaluator();
    const result = evaluateReactHook(
      evaluator,
      "useState",
      [primitiveValue(3)],
      { ...createEvaluationContext(), hooks: null },
      null,
      "count",
    );
    expect(result).toMatchObject({
      kind: "list",
      items: [
        {
          kind: "branch",
          alternatives: [primitiveValue(3), { kind: "unknown", reason: "updated state of count" }],
        },
        { kind: "unknown", reason: "state setter" },
      ],
    });
    expect(evaluator.callFunction).not.toHaveBeenCalled();
  });

  it("reduces queued actions in order and double-checks each action in strict mode", () => {
    const evaluator = createEvaluator();
    const context = createEvaluationContext();
    context.hooks.doublesHookFactories = true;
    const reducer = createCallbackValue(context);
    const calls: number[][] = [];
    vi.mocked(evaluator.callValue).mockImplementation((_callee, [state, action]) => {
      if (
        state?.kind !== "primitive" ||
        typeof state.value !== "number" ||
        action?.kind !== "primitive" ||
        typeof action.value !== "number"
      )
        throw new Error("Expected numeric reducer operands");
      calls.push([state.value, action.value]);
      return primitiveValue(state.value + action.value);
    });
    beginHookPass(context.hooks);
    evaluateReactHook(
      evaluator,
      "useReducer",
      [reducer, primitiveValue(1)],
      context,
      null,
      "count",
    );
    const cell = context.hooks.cells[0];
    queueReducerAction(context.hooks, cell, primitiveValue(2), false);
    queueReducerAction(context.hooks, cell, primitiveValue(3), false);
    beginHookPass(context.hooks);
    evaluateReactHook(
      evaluator,
      "useReducer",
      [reducer, primitiveValue(99)],
      context,
      null,
      "count",
    );
    expect(calls).toEqual([
      [1, 2],
      [1, 2],
      [3, 3],
      [3, 3],
    ]);
    expect(cell.current).toEqual(primitiveValue(6));
    expect(cell.pendingReducerActions).toBeNull();
  });

  it("restores a failed action queue for retry without committing partial state", () => {
    const evaluator = createEvaluator();
    const context = createEvaluationContext();
    const reducer = createCallbackValue(context);
    beginHookPass(context.hooks);
    evaluateReactHook(evaluator, "useReducer", [reducer, primitiveValue(0)], context, null, null);
    const cell = context.hooks.cells[0];
    const pending = listValue([primitiveValue(1), primitiveValue(2)]);
    cell.pendingReducerActions = pending;
    const thrown = thrownValue("failed reducer", primitiveValue("failed"));
    vi.mocked(evaluator.callValue)
      .mockReturnValueOnce(primitiveValue(1))
      .mockReturnValueOnce(thrown);
    beginHookPass(context.hooks);
    expect(evaluateReactHook(evaluator, "useReducer", [reducer], context, null, null)).toBe(thrown);
    expect(cell.current).toEqual(primitiveValue(0));
    expect(cell.pendingReducerActions).toBe(pending);
    vi.mocked(evaluator.callValue)
      .mockReturnValueOnce(primitiveValue(1))
      .mockReturnValueOnce(primitiveValue(3));
    beginHookPass(context.hooks);
    evaluateReactHook(evaluator, "useReducer", [reducer], context, null, null);
    expect(cell.current).toEqual(primitiveValue(3));
    expect(cell.pendingReducerActions).toBeNull();
  });

  it("routes forked action queues through the evaluator's branch operation", () => {
    const evaluator = createEvaluator();
    const context = createEvaluationContext();
    const reducer = createCallbackValue(context);
    vi.mocked(evaluator.callValue).mockImplementation((_callee, argumentsList) => argumentsList[1]);
    beginHookPass(context.hooks);
    evaluateReactHook(evaluator, "useReducer", [reducer, primitiveValue(0)], context, null, null);
    const pending = branchValue(
      [listValue([primitiveValue(1)]), listValue([primitiveValue(2)])],
      "queued action",
    );
    context.hooks.cells[0].pendingReducerActions = pending;
    beginHookPass(context.hooks);
    evaluateReactHook(evaluator, "useReducer", [reducer], context, null, null);
    expect(evaluator.callAlternatives).toHaveBeenCalledWith(pending, context, expect.any(Function));
    expect(context.hooks.cells[0].current).toMatchObject({
      kind: "branch",
      alternatives: [primitiveValue(1), primitiveValue(2)],
    });
  });

  it("reuses memo results until dependencies change", () => {
    const context = createEvaluationContext();
    const evaluator = createEvaluator();
    const callback = createCallbackValue(context);
    const initial = primitiveValue("first");
    const updated = primitiveValue("second");
    vi.mocked(evaluator.callFunction).mockReturnValueOnce(initial).mockReturnValueOnce(updated);
    beginHookPass(context.hooks);
    expect(
      evaluateReactHook(
        evaluator,
        "useMemo",
        [callback, listValue([primitiveValue(1)])],
        context,
        null,
        null,
      ),
    ).toBe(initial);
    beginHookPass(context.hooks);
    expect(
      evaluateReactHook(
        evaluator,
        "useMemo",
        [callback, listValue([primitiveValue(1)])],
        context,
        null,
        null,
      ),
    ).toBe(initial);
    beginHookPass(context.hooks);
    expect(
      evaluateReactHook(
        evaluator,
        "useMemo",
        [callback, listValue([primitiveValue(2)])],
        context,
        null,
        null,
      ),
    ).toBe(updated);
    expect(evaluator.callFunction).toHaveBeenCalledTimes(2);
  });

  it("keeps refs stable across renders and ignores later initial values", () => {
    const context = createEvaluationContext();
    const evaluator = createEvaluator();
    beginHookPass(context.hooks);
    const ref = evaluateReactHook(evaluator, "useRef", [primitiveValue(1)], context, null, null);
    beginHookPass(context.hooks);
    expect(evaluateReactHook(evaluator, "useRef", [primitiveValue(2)], context, null, null)).toBe(
      ref,
    );
    if (ref.kind !== "object") throw new Error("Expected a ref object");
    expect(getObjectProperty(ref, "current")).toEqual(primitiveValue(1));
  });

  it.each<ReactHookApi>(["useEffect", "useLayoutEffect", "useInsertionEffect"])(
    "registers %s only during rendering",
    (api) => {
      const context = createEvaluationContext();
      const evaluator = createEvaluator();
      const callback = createCallbackValue(context);
      const deps = listValue([]);
      evaluateReactHook(evaluator, api, [callback, deps], context, null, null);
      expect(context.hooks.effects).toEqual([]);
      beginHookPass(context.hooks);
      expect(evaluateReactHook(evaluator, api, [callback, deps], context, null, null)).toBe(
        UNDEFINED_VALUE,
      );
      expect(context.hooks.effects).toEqual([
        { isLayout: api !== "useEffect", callback, deps, cleanup: null },
      ]);
      expect(evaluator.callFunction).not.toHaveBeenCalled();
    },
  );

  it("re-reads external snapshots and records a passive subscription", () => {
    const context = createEvaluationContext();
    const evaluator = createEvaluator();
    const subscribe = nativeFunction("subscribe", () => UNDEFINED_VALUE);
    const getSnapshot = nativeFunction("getSnapshot", () => UNDEFINED_VALUE);
    const initial = primitiveValue(1);
    const updated = primitiveValue(2);
    vi.mocked(evaluator.callValue).mockReturnValueOnce(initial).mockReturnValueOnce(updated);
    beginHookPass(context.hooks);
    expect(
      evaluateReactHook(
        evaluator,
        "useSyncExternalStore",
        [subscribe, getSnapshot],
        context,
        null,
        null,
      ),
    ).toBe(initial);
    expect(context.hooks.effects).toMatchObject([
      {
        isLayout: false,
        deps: { kind: "list", items: [subscribe] },
        callback: { kind: "native-function", name: "subscribeToStore" },
      },
    ]);
    beginHookPass(context.hooks);
    expect(
      evaluateReactHook(
        evaluator,
        "useSyncExternalStore",
        [subscribe, getSnapshot],
        context,
        null,
        null,
      ),
    ).toBe(updated);
    expect(evaluator.callValue).toHaveBeenNthCalledWith(2, getSnapshot, [], context, null);
    expect(context.hooks.cells).toHaveLength(1);
    expect(context.hooks.effects).toHaveLength(1);
  });

  it("keeps escaped external stores uncertain on subsequent renders", () => {
    const context = createEvaluationContext();
    const evaluator = createEvaluator();
    const subscribe = nativeFunction("subscribe", () => UNDEFINED_VALUE);
    const getSnapshot = nativeFunction("getSnapshot", () => UNDEFINED_VALUE);
    vi.mocked(evaluator.callValue).mockReturnValue(primitiveValue(1));
    beginHookPass(context.hooks);
    evaluateReactHook(
      evaluator,
      "useSyncExternalStore",
      [subscribe, getSnapshot],
      context,
      null,
      null,
    );
    escapeStateCell(context.hooks, context.hooks.cells[0], null);
    beginHookPass(context.hooks);
    expect(
      evaluateReactHook(
        evaluator,
        "useSyncExternalStore",
        [subscribe, getSnapshot],
        context,
        null,
        null,
      ),
    ).toMatchObject({ kind: "branch", alternatives: [primitiveValue(1), { kind: "unknown" }] });
  });

  it.each<ReactHookApi>(["useContext", "use"])("reads the nearest provider through %s", (api) => {
    const context = createEvaluationContext();
    const evaluator = createEvaluator();
    const definition: ContextDefinition = {
      name: "Theme",
      displayName: null,
      defaultValue: primitiveValue("default"),
      location: null,
    };
    const provided = primitiveValue("dark");
    context.readContext = vi.fn(() => provided);
    expect(
      evaluateReactHook(
        evaluator,
        api,
        [{ kind: "context", context: definition }],
        context,
        null,
        null,
      ),
    ).toBe(provided);
    expect(context.readContext).toHaveBeenCalledWith(definition);
    expect(evaluator.timers.drainMicrotasks).not.toHaveBeenCalled();
  });

  it("unwraps a settled promise passed to use without draining unrelated microtasks", () => {
    const evaluator = createEvaluator();
    const value = primitiveValue("settled");
    expect(
      evaluateReactHook(
        evaluator,
        "use",
        [resolvedPromiseValue(value)],
        createEvaluationContext(),
        null,
        null,
      ),
    ).toBe(value);
    expect(evaluator.timers.drainMicrotasks).not.toHaveBeenCalled();
  });

  it("reports an invalid context through the diagnostic operation", () => {
    const evaluator = createEvaluator();
    expect(
      evaluateReactHook(
        evaluator,
        "useContext",
        [primitiveValue(3)],
        createEvaluationContext(),
        null,
        null,
      ),
    ).toMatchObject({ kind: "unknown", reason: "useContext on 3" });
    expect(evaluator.report).toHaveBeenCalledWith("unknown-context", "useContext on 3", null);
  });
});
