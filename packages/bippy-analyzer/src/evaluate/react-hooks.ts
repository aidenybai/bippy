import type { SourceLocation } from "../parse/source-types.js";
import { REACT_MEMO_CACHE_SENTINEL_KEY } from "../react/react-api.js";
import type {
  ReactApi,
  StaticBranchValue,
  StaticNativeFunctionValue,
  StaticValue,
  StubRenderTools,
} from "../types.js";
import type { EvaluationContext, FunctionCaller } from "./context.js";
import {
  applyReducerState,
  escapedStateValue,
  escapeReducerDispatch,
  escapeStateCell,
  invokeHookFactory,
  getQueuedState,
  nextMemoCell,
  nextStateCell,
  queueReducerAction,
  queueStateUpdate,
  type HookFrame,
  type StateCell,
} from "./hooks.js";
import { awaitedValue } from "./promises.js";
import { providedContextValue } from "./react-context.js";
import { getThrowCertainty } from "./thrown.js";
import {
  branchValue,
  describeValue,
  FALSE_VALUE,
  isCallable,
  listValue,
  mapValue,
  objectFromRecord,
  UNDEFINED_VALUE,
  unknownPrimitiveValue,
  unknownValue,
} from "./values.js";

export type ReactHookApi = Extract<ReactApi, `use${string}`>;

export interface ReactHookEvaluator extends FunctionCaller {
  readonly assumeOuterProviders: boolean;
  readonly timers: { drainMicrotasks: () => void };
  callAlternatives: (
    branch: StaticBranchValue,
    context: EvaluationContext,
    call: (alternative: StaticValue, context: EvaluationContext) => StaticValue,
  ) => StaticValue;
  report: (code: string, message: string, location: SourceLocation | null) => void;
}

interface PendingReducer {
  (pending: StaticValue, current: StaticValue): StaticValue;
}

const reduceActionQueue = (
  evaluator: ReactHookEvaluator,
  reducer: StaticValue,
  pending: StaticValue,
  current: StaticValue,
  context: EvaluationContext,
  location: SourceLocation | null,
): StaticValue => {
  if (pending.kind === "branch") {
    return evaluator.callAlternatives(pending, context, (alternative, alternativeContext) =>
      reduceActionQueue(evaluator, reducer, alternative, current, alternativeContext, location),
    );
  }
  if (pending.kind !== "list")
    return pending.kind === "unknown"
      ? pending
      : unknownValue("reducer action queue is not a known sequence", location);
  let state = current;
  for (const action of pending.items) {
    if (context.hooks?.doublesHookFactories) {
      const checked = evaluator.callValue(reducer, [state, action], context, location);
      if (getThrowCertainty(checked) === "always") return checked;
    }
    state = evaluator.callValue(reducer, [state, action], context, location);
    if (getThrowCertainty(state) === "always") return state;
  }
  return state;
};

/** `mountState`/`mountReducer`: the initializer runs on mount only, twice under Strict Mode. */
const stateHook = (
  context: EvaluationContext,
  name: string,
  computeInitial: () => StaticValue,
  reduce: (
    action: StaticValue | undefined,
    current: StaticValue,
    tools: StubRenderTools,
  ) => StaticValue,
  escapeDispatch: (frame: HookFrame, cell: StateCell, action: StaticValue) => void,
  reducePending?: PendingReducer,
): StaticValue => {
  const frame = context.hooks;
  if (!frame) {
    return listValue([
      branchValue(
        [computeInitial(), unknownValue(`updated state of ${name}`)],
        "state may change",
        null,
      ),
      unknownValue("state setter"),
    ]);
  }
  const cell = nextStateCell(frame, name, () => invokeHookFactory(frame, computeInitial));
  if (cell.isEscaped) cell.pendingReducerActions = null;
  let value = cell.current;
  if (reducePending && cell.pendingReducerActions !== null) {
    const pending = cell.pendingReducerActions;
    cell.pendingReducerActions = null;
    const reduced = reducePending(pending, cell.current);
    if (getThrowCertainty(reduced) === "always") {
      cell.pendingReducerActions = pending;
      return reduced;
    }
    value = reduced;
    if (getThrowCertainty(reduced) === "maybe") {
      const previous = cell.current;
      cell.pendingReducerActions = mapValue(reduced, (alternative) =>
        getThrowCertainty(alternative) === "never" ? listValue([]) : pending,
      );
      applyReducerState(
        frame,
        cell,
        mapValue(reduced, (alternative) =>
          getThrowCertainty(alternative) === "never" ? alternative : previous,
        ),
      );
    } else {
      applyReducerState(frame, cell, reduced);
    }
  }
  cell.setter ??= {
    kind: "native-function",
    name: `set ${name}`,
    call: ([action], tools) => {
      if (reducePending) {
        queueReducerAction(frame, cell, action ?? UNDEFINED_VALUE, tools.isDeferred());
      } else {
        queueStateUpdate(
          frame,
          cell,
          reduce(action, getQueuedState(cell), tools),
          tools.isDeferred(),
        );
      }
      return UNDEFINED_VALUE;
    },
    onEscape: (argumentValues) => {
      if (argumentValues === null || argumentValues[0] === null) {
        escapeStateCell(frame, cell, null);
        return;
      }
      escapeDispatch(frame, cell, argumentValues[0] ?? UNDEFINED_VALUE);
    },
  };
  const setter = cell.setter;
  return getThrowCertainty(value) === "never"
    ? listValue([value, setter])
    : mapValue(value, (alternative) =>
        getThrowCertainty(alternative) === "always"
          ? alternative
          : listValue([alternative, setter]),
      );
};

/**
 * Mirrors `mountSyncExternalStore`: the snapshot is read on every render, and a
 * passive effect subscribes and re-checks it (`updateStoreInstance`), so a store
 * mutated between render and commit re-renders with the latest value. The
 * listener does the same for store changes triggered during evaluation; once
 * it is held by code the analysis does not follow, the store may change at any
 * time and the snapshot is one value among those the store may hold.
 */
const externalStoreHook = (
  evaluator: ReactHookEvaluator,
  context: EvaluationContext,
  subscribe: StaticValue | undefined,
  getSnapshot: StaticValue | undefined,
  location: SourceLocation | null,
): StaticValue => {
  const readSnapshot = (): StaticValue =>
    getSnapshot
      ? evaluator.callValue(getSnapshot, [], context, location)
      : unknownValue("external store snapshot", location);
  const snapshot = readSnapshot();
  const frame = context.hooks;
  if (!frame) return snapshot;
  const cell = nextStateCell(frame, "useSyncExternalStore", () => snapshot);
  cell.initial = snapshot;
  cell.current = cell.isEscaped ? escapedStateValue(cell) : snapshot;
  if (!frame.isRendering || !subscribe) return cell.current;
  const handleStoreChange: StaticNativeFunctionValue = {
    kind: "native-function",
    name: "handleStoreChange",
    call: (_args, tools) => {
      queueStateUpdate(frame, cell, readSnapshot(), tools.isDeferred());
      return UNDEFINED_VALUE;
    },
    onEscape: () => escapeStateCell(frame, cell, null),
  };
  frame.effects.push({
    isLayout: false,
    callback: {
      kind: "native-function",
      name: "subscribeToStore",
      call: (_args, tools) => {
        const unsubscribe = tools.call(subscribe, [handleStoreChange]);
        handleStoreChange.call([], tools);
        return unsubscribe;
      },
    },
    deps: listValue([subscribe]),
    cleanup: null,
  });
  return cell.current;
};

const readContextValue = (
  evaluator: ReactHookEvaluator,
  contextValue: StaticValue,
  context: EvaluationContext,
  location: SourceLocation | null,
): StaticValue => {
  if (contextValue.kind === "context") {
    return providedContextValue(
      evaluator.assumeOuterProviders,
      contextValue.context,
      context.readContext(contextValue.context),
      location,
    );
  }
  if (contextValue.kind === "external") {
    return unknownValue(`context from ${contextValue.packageName}`, location);
  }
  evaluator.report("unknown-context", `useContext on ${describeValue(contextValue)}`, location);
  return unknownValue(`useContext on ${describeValue(contextValue)}`, location);
};

export const evaluateReactHook = (
  evaluator: ReactHookEvaluator,
  api: ReactHookApi,
  args: StaticValue[],
  context: EvaluationContext,
  location: SourceLocation | null,
  nameHint: string | null,
): StaticValue => {
  const [first, second, third] = args;
  switch (api) {
    case "useState": {
      const computeInitial = (): StaticValue =>
        first?.kind === "function"
          ? evaluator.callFunction(first, [], context)
          : (first ?? UNDEFINED_VALUE);
      return stateHook(
        context,
        nameHint ?? "useState",
        computeInitial,
        (action, current, tools) =>
          action?.kind === "function" ? tools.call(action, [current]) : (action ?? UNDEFINED_VALUE),
        (frame, cell, action) => escapeStateCell(frame, cell, isCallable(action) ? null : action),
      );
    }

    case "useReducer": {
      const computeInitial = (): StaticValue =>
        third?.kind === "function"
          ? evaluator.callFunction(third, [second ?? UNDEFINED_VALUE], context)
          : (second ?? UNDEFINED_VALUE);
      return stateHook(
        context,
        nameHint ?? "useReducer",
        computeInitial,
        (action, current, tools) =>
          first
            ? tools.call(first, [current, action ?? UNDEFINED_VALUE])
            : unknownValue("reducer state after dispatch"),
        (frame, cell, action) => {
          if (!first) {
            escapeStateCell(frame, cell, null);
            return;
          }
          escapeReducerDispatch(frame, cell, (state) =>
            evaluator.callValue(first, [state, action], context, location),
          );
        },
        (pending, current) =>
          first
            ? reduceActionQueue(evaluator, first, pending, current, context, location)
            : unknownValue("reducer state after dispatch"),
      );
    }

    case "useMemo": {
      const compute = (): StaticValue =>
        invokeHookFactory(context.hooks, () =>
          first?.kind === "function"
            ? evaluator.callFunction(first, [], context)
            : unknownValue("useMemo factory", location),
        );
      return context.hooks && second?.kind === "list"
        ? nextMemoCell(context.hooks, second, compute)
        : compute();
    }

    case "useCallback": {
      const callback = first ?? UNDEFINED_VALUE;
      return context.hooks && second?.kind === "list"
        ? nextMemoCell(context.hooks, second, () => callback)
        : callback;
    }

    case "useRef": {
      const createRef = (): StaticValue => objectFromRecord({ current: first ?? UNDEFINED_VALUE });
      return context.hooks ? nextMemoCell(context.hooks, null, createRef) : createRef();
    }

    case "useContext":
      return first
        ? readContextValue(evaluator, first, context, location)
        : unknownValue("useContext without a context", location);

    case "use":
      if (first?.kind === "context") return readContextValue(evaluator, first, context, location);
      return first
        ? awaitedValue(first, location, () => evaluator.timers.drainMicrotasks())
        : unknownValue("use() without an argument", location);

    case "useEffect":

    case "useLayoutEffect":

    case "useInsertionEffect":
      if (context.hooks?.isRendering && first) {
        context.hooks.effects.push({
          isLayout: api !== "useEffect",
          callback: first,
          deps: second ?? null,
          cleanup: null,
        });
      }
      return UNDEFINED_VALUE;

    case "useImperativeHandle":

    case "useDebugValue":
      return UNDEFINED_VALUE;

    case "useId": {
      const createId = (): StaticValue => unknownPrimitiveValue("string", "useId");
      return context.hooks ? nextMemoCell(context.hooks, null, createId) : createId();
    }

    case "useTransition":
      return listValue([
        FALSE_VALUE,
        {
          kind: "native-function",
          name: "startTransition",
          call: ([callback], tools) => (callback ? tools.call(callback, []) : UNDEFINED_VALUE),
        },
      ]);

    case "useDeferredValue":
      return first ?? UNDEFINED_VALUE;

    case "useSyncExternalStore":
      return externalStoreHook(evaluator, context, first, second, location);

    case "useOptimistic":
      return listValue([first ?? UNDEFINED_VALUE, unknownValue("optimistic setter")]);

    case "useActionState":
      return listValue([second ?? UNDEFINED_VALUE, unknownValue("form action"), FALSE_VALUE]);

    case "useMemoCache": {
      if (first?.kind !== "primitive" || typeof first.value !== "number") {
        return unknownValue("memo cache of dynamic size", location);
      }
      const sentinel: StaticValue = { kind: "symbol", key: REACT_MEMO_CACHE_SENTINEL_KEY };
      return listValue(Array.from({ length: first.value }, () => sentinel));
    }
  }
};
