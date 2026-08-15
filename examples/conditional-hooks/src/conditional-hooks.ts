import {
  didFiberRender,
  getRDTHook,
  instrument,
  onRendererInject,
  traverseFiber,
  useFiber,
} from "bippy";
import type { Fiber, FiberRoot, ReactRenderer, Unsubscribe } from "bippy";
import { useReducer } from "react";

interface ConditionalHookDispatcher {
  readContext?: (...arguments_: unknown[]) => unknown;
  use?: (...arguments_: unknown[]) => unknown;
  useActionState?: (...arguments_: unknown[]) => unknown;
  useCallback?: (...arguments_: unknown[]) => unknown;
  useCacheRefresh?: (...arguments_: unknown[]) => unknown;
  useContext?: (...arguments_: unknown[]) => unknown;
  useDebugValue?: (...arguments_: unknown[]) => unknown;
  useDeferredValue?: (...arguments_: unknown[]) => unknown;
  useEffect?: (...arguments_: unknown[]) => unknown;
  useEffectEvent?: (...arguments_: unknown[]) => unknown;
  useFormState?: (...arguments_: unknown[]) => unknown;
  useHostTransitionStatus?: (...arguments_: unknown[]) => unknown;
  useId?: (...arguments_: unknown[]) => unknown;
  useImperativeHandle?: (...arguments_: unknown[]) => unknown;
  useInsertionEffect?: (...arguments_: unknown[]) => unknown;
  useLayoutEffect?: (...arguments_: unknown[]) => unknown;
  useMemo?: (...arguments_: unknown[]) => unknown;
  useMemoCache?: (...arguments_: unknown[]) => unknown;
  useOptimistic?: (...arguments_: unknown[]) => unknown;
  useReducer?: (...arguments_: unknown[]) => unknown;
  useRef?: (...arguments_: unknown[]) => unknown;
  useState?: (...arguments_: unknown[]) => unknown;
  useSyncExternalStore?: (...arguments_: unknown[]) => unknown;
  useTransition?: (...arguments_: unknown[]) => unknown;
}

interface ConditionalHookDispatcherRef {
  H?: unknown;
  current?: unknown;
}

interface ConditionalHookRuntime {
  activeFiber: Fiber | null;
  currentDispatcher: ConditionalHookDispatcher | null;
  dispatcherKey: "H" | "current";
  dispatcherRef: ConditionalHookDispatcherRef;
  getHookKey: ConditionalHookKeyResolver;
  originalDescriptor: PropertyDescriptor | undefined;
  proxyByDispatcher: WeakMap<object, ConditionalHookDispatcher>;
  renderer: ReactRenderer;
  scheduleUpdate: (() => void) | null;
}

interface ConditionalHookScope {
  cells: Map<PropertyKey, ConditionalHookCell>;
  didCommit: boolean;
  didUnmount: boolean;
  effects: Map<PropertyKey, ConditionalEffectCell>;
  fiber: Fiber;
  hookKinds: Map<PropertyKey, ConditionalHookKind>;
  layoutEffectsDisconnected: boolean;
  passiveEffectsDisconnected: boolean;
  renderer: ReactRenderer;
  scheduleUpdate: (() => void) | null;
}

interface ConditionalRenderFrame {
  callCounts: Map<PropertyKey, number>;
  cells: Map<PropertyKey, ConditionalHookCell>;
  effects: Map<PropertyKey, ConditionalEffectRegistration>;
  fiber: Fiber;
  hookKinds: Map<PropertyKey, ConditionalHookKind>;
  reducerActionCounts: Map<PropertyKey, number>;
  reducerOverrides: Map<PropertyKey, (state: unknown, action: unknown) => unknown>;
  replayedCells: Set<PropertyKey>;
  renderPhaseUpdates: Map<PropertyKey, unknown[]>;
  scope: ConditionalHookScope;
}

interface ConditionalVisibilityState {
  layoutEffectsHidden: boolean;
  passiveEffectsHidden: boolean;
}

interface ConditionalStateCell {
  dispatch: (action: unknown) => void;
  kind: "state";
  value: unknown;
}

interface ConditionalReducerCell {
  dispatch: (action: unknown) => void;
  kind: "reducer";
  pendingActions: unknown[];
  reducer: (state: unknown, action: unknown) => unknown;
  value: unknown;
}

interface ConditionalRefCell {
  kind: "ref";
  value: ConditionalRef<unknown>;
}

interface ConditionalMemoCell {
  dependencies: readonly unknown[] | undefined;
  kind: "memo";
  value: unknown;
}

interface ConditionalValueCell {
  kind: "deferred-value" | "id" | "memo-cache";
  value: unknown;
}

interface ConditionalExternalStoreCell {
  getSnapshot: () => unknown;
  kind: "external-store";
  value: unknown;
}

interface ConditionalOptimisticCell {
  dispatch: (action: unknown) => void;
  isPending: boolean;
  kind: "optimistic";
  reducer: (state: unknown, action: unknown) => unknown;
  value: unknown;
}

interface ConditionalTransitionCell {
  isPending: boolean;
  kind: "transition";
  startTransition: (callback: () => void) => void;
}

interface ConditionalActionStateCell {
  action: (previousState: unknown, payload: unknown) => unknown;
  dispatch: (payload: unknown) => void;
  isPending: boolean;
  kind: "action-state";
  pendingAction: Promise<void>;
  pendingActions: number;
  value: unknown;
}

interface ConditionalEffectEventCell {
  callback: (...arguments_: unknown[]) => unknown;
  event: (...arguments_: unknown[]) => unknown;
  kind: "effect-event";
}

interface ConditionalCacheRefreshCell {
  kind: "cache-refresh";
  refresh: () => void;
}

interface ConditionalEffectCell {
  cleanup: (() => void) | undefined;
  create: ConditionalEffectRegistration["create"];
  dependencies: readonly unknown[] | undefined;
  kind: ConditionalEffectKind;
  version: number;
}

interface ConditionalEffectRegistration {
  create: () => (() => void) | void;
  dependencies: readonly unknown[] | undefined;
  kind: ConditionalEffectKind;
}

interface ConditionalRef<Value> {
  current: Value;
}

interface ConditionalStateSetter<State> {
  (action: State | ((previousState: State) => State)): void;
}

interface ConditionalReducerDispatcher<Action> {
  (action: Action): void;
}

export interface ConditionalHooksInstallation extends Unsubscribe {
  readonly supportedRenderers: number;
}

export interface ConditionalHooksOptions {
  getHookKey?: ConditionalHookKeyResolver;
}

export interface ConditionalHookKeyResolver {
  (hookName: string, stack: string): PropertyKey;
}

const isConditionalHooksInstallation = (
  value: Unsubscribe,
): value is ConditionalHooksInstallation =>
  typeof Reflect.get(value, "supportedRenderers") === "number";

type ConditionalHookCell =
  | ConditionalActionStateCell
  | ConditionalCacheRefreshCell
  | ConditionalEffectEventCell
  | ConditionalExternalStoreCell
  | ConditionalMemoCell
  | ConditionalOptimisticCell
  | ConditionalReducerCell
  | ConditionalRefCell
  | ConditionalStateCell
  | ConditionalTransitionCell
  | ConditionalValueCell;

type ConditionalEffectKind = "effect" | "insertion-effect" | "layout-effect";

type ConditionalHookKind =
  | ConditionalHookCell["kind"]
  | ConditionalEffectKind
  | "imperative-handle";

const runtimes = new Set<ConditionalHookRuntime>();
const scopes = new Set<ConditionalHookScope>();
const runtimeByDispatcherRef = new WeakMap<object, ConditionalHookRuntime>();
const scopeByFiber = new WeakMap<Fiber, ConditionalHookScope>();
const renderFrameByFiber = new WeakMap<Fiber, ConditionalRenderFrame>();
const pendingPassiveEffects: Array<() => void> = [];

let installation: ConditionalHooksInstallation | null = null;
let renderingRuntime: ConditionalHookRuntime | null = null;
let conditionalId = 0;
let didSchedulePassiveEffects = false;
let scheduledUpdateVersion = 0;

const createUnsubscribe = (unsubscribe: () => void): Unsubscribe =>
  Object.assign(unsubscribe, { [Symbol.dispose]: unsubscribe });

const incrementVersion = (version: number): number => version + 1;

const isContextOnlyDispatcher = (dispatcher: ConditionalHookDispatcher | null): boolean => {
  if (!dispatcher) return true;
  return (
    typeof dispatcher.useState === "function" &&
    dispatcher.useState === dispatcher.useReducer &&
    dispatcher.useReducer === dispatcher.useRef &&
    dispatcher.useRef === dispatcher.useEffect
  );
};

const isConditionalHookDispatcher = (value: unknown): value is ConditionalHookDispatcher =>
  typeof value === "object" && value !== null;

const defaultHookKeyResolver: ConditionalHookKeyResolver = (hookName, stack) => {
  const callsiteFrames: string[] = [];
  for (const stackLine of stack.split("\n")) {
    const line = stackLine.trim();
    if (!line.startsWith("at ") && !line.includes("@")) continue;
    const normalizedLine = line.replaceAll("\\", "/");
    if (
      normalizedLine.includes("node_modules/react-dom/") ||
      normalizedLine.includes("node_modules/.vite/deps/react-dom") ||
      normalizedLine.includes("react-dom-client.development.js") ||
      normalizedLine.includes("react-dom-client.production.js") ||
      normalizedLine.includes("react-native/Libraries/Renderer")
    ) {
      break;
    }
    if (
      normalizedLine.includes("/src/conditional-hooks.ts") ||
      normalizedLine.includes("/dist/conditional-hooks.") ||
      normalizedLine.includes("node_modules/bippy/conditional-hooks") ||
      normalizedLine.includes("node_modules/react/") ||
      normalizedLine.includes("node_modules/.vite/deps/react") ||
      normalizedLine.includes("react.development.js") ||
      normalizedLine.includes("react.production.js")
    ) {
      continue;
    }
    callsiteFrames.push(normalizedLine);
  }
  if (callsiteFrames.length === 0) {
    throw new Error(`Could not derive a callsite key for React.${hookName}().`);
  }
  return `${hookName}:${callsiteFrames.join("\n")}`;
};

const getAutomaticHookKey = (runtime: ConditionalHookRuntime, hookName: string): PropertyKey => {
  prepareRuntime(runtime);
  const { frame } = getScope();
  const stack = new Error().stack ?? "";
  const callsiteKey = runtime.getHookKey(hookName, stack);
  const occurrence = frame.callCounts.get(callsiteKey) ?? 0;
  frame.callCounts.set(callsiteKey, occurrence + 1);
  return `react:${String(callsiteKey)}:${occurrence}`;
};

const prepareRuntime = (runtime: ConditionalHookRuntime): void => {
  if (runtime.activeFiber) return;
  throw new Error("The component was not initialized for conditional hooks.");
};

const getDependencies = (value: unknown): readonly unknown[] | undefined =>
  Array.isArray(value) ? value : undefined;

const createDispatcherProxy = (
  runtime: ConditionalHookRuntime,
  dispatcher: ConditionalHookDispatcher,
): ConditionalHookDispatcher =>
  new Proxy(dispatcher, {
    get: (target, property, receiver) => {
      if (!runtime.activeFiber) return Reflect.get(target, property, receiver);
      if (property === "useState") {
        return (initialState: unknown) =>
          readStateCell(getAutomaticHookKey(runtime, "useState"), initialState);
      }
      if (property === "useReducer") {
        return (reducer: unknown, initialState: unknown, initialize: unknown) => {
          if (typeof reducer !== "function") throw new TypeError("useReducer requires a reducer.");
          const initializer =
            typeof initialize === "function" ? (value: unknown) => initialize(value) : undefined;
          return readReducerCell(
            getAutomaticHookKey(runtime, "useReducer"),
            (state: unknown, action: unknown) => reducer(state, action),
            initialState,
            initializer,
          );
        };
      }
      if (property === "useRef") {
        return (initialValue: unknown) =>
          readRefCell(getAutomaticHookKey(runtime, "useRef"), initialValue);
      }
      if (property === "useMemo") {
        return (create: unknown, dependencies: unknown) => {
          if (typeof create !== "function") throw new TypeError("useMemo requires a function.");
          return readMemoCell(
            getAutomaticHookKey(runtime, "useMemo"),
            () => create(),
            getDependencies(dependencies),
          );
        };
      }
      if (property === "useCallback") {
        return (callback: unknown, dependencies: unknown) => {
          if (typeof callback !== "function") {
            throw new TypeError("useCallback requires a function.");
          }
          return readMemoCell(
            getAutomaticHookKey(runtime, "useCallback"),
            () => callback,
            getDependencies(dependencies),
          );
        };
      }
      if (
        property === "useEffect" ||
        property === "useInsertionEffect" ||
        property === "useLayoutEffect"
      ) {
        return (create: unknown, dependencies: unknown) => {
          if (typeof create !== "function") {
            throw new TypeError(`${property} requires a function.`);
          }
          const effectKind =
            property === "useEffect"
              ? "effect"
              : property === "useInsertionEffect"
                ? "insertion-effect"
                : "layout-effect";
          registerEffect(
            getAutomaticHookKey(runtime, property),
            effectKind,
            () => create(),
            getDependencies(dependencies),
          );
        };
      }
      if (property === "useImperativeHandle") {
        return (ref: unknown, create: unknown, dependencies: unknown) => {
          if (typeof create !== "function") {
            throw new TypeError("useImperativeHandle requires a function.");
          }
          const effectDependencies = getDependencies(dependencies);
          registerEffect(
            getAutomaticHookKey(runtime, "useImperativeHandle"),
            "layout-effect",
            () =>
              setImperativeHandle(ref, (...arguments_) =>
                Reflect.apply(create, undefined, arguments_),
              ),
            effectDependencies ? [...effectDependencies, ref] : undefined,
            "imperative-handle",
          );
        };
      }
      if (property === "useDeferredValue") {
        return (value: unknown) =>
          readValueCell(getAutomaticHookKey(runtime, "useDeferredValue"), "deferred-value", value);
      }
      if (property === "useTransition") {
        return () => readTransitionCell(getAutomaticHookKey(runtime, "useTransition"));
      }
      if (property === "useSyncExternalStore") {
        return (subscribe: unknown, getSnapshot: unknown) => {
          if (typeof subscribe !== "function" || typeof getSnapshot !== "function") {
            throw new TypeError(
              "useSyncExternalStore requires subscribe and getSnapshot functions.",
            );
          }
          return readExternalStoreCell(
            getAutomaticHookKey(runtime, "useSyncExternalStore"),
            (onStoreChange) => Reflect.apply(subscribe, undefined, [onStoreChange]),
            () => Reflect.apply(getSnapshot, undefined, []),
          );
        };
      }
      if (property === "useId") {
        return () => readIdCell(getAutomaticHookKey(runtime, "useId"));
      }
      if (property === "useCacheRefresh") {
        return () => readCacheRefreshCell(getAutomaticHookKey(runtime, "useCacheRefresh"));
      }
      if (property === "useOptimistic") {
        return (passthrough: unknown, reducer: unknown) =>
          readOptimisticCell(
            getAutomaticHookKey(runtime, "useOptimistic"),
            passthrough,
            typeof reducer === "function"
              ? (state: unknown, action: unknown): unknown =>
                  Reflect.apply(reducer, undefined, [state, action])
              : (_state: unknown, action: unknown): unknown => action,
          );
      }
      if (property === "useActionState" || property === "useFormState") {
        return (action: unknown, initialState: unknown) => {
          if (typeof action !== "function") {
            throw new TypeError(`${property} requires an action function.`);
          }
          return readActionStateCell(
            getAutomaticHookKey(runtime, property),
            (previousState, payload) => Reflect.apply(action, undefined, [previousState, payload]),
            initialState,
          );
        };
      }
      if (property === "useEffectEvent") {
        return (callback: unknown) => {
          if (typeof callback !== "function") {
            throw new TypeError("useEffectEvent requires a function.");
          }
          return readEffectEventCell(
            getAutomaticHookKey(runtime, "useEffectEvent"),
            (...arguments_) => Reflect.apply(callback, undefined, arguments_),
          );
        };
      }
      if (property === "useMemoCache") {
        return (size: unknown) => {
          if (typeof size !== "number") throw new TypeError("useMemoCache requires a size.");
          return readMemoCacheCell(getAutomaticHookKey(runtime, "useMemoCache"), size);
        };
      }
      if (property === "useContext" && typeof target.readContext === "function") {
        return target.readContext;
      }
      if (property === "useDebugValue") return (): void => {};
      return Reflect.get(target, property, receiver);
    },
  });

const getRuntimeDispatcher = (
  runtime: ConditionalHookRuntime,
): ConditionalHookDispatcher | null => {
  const dispatcher = runtime.currentDispatcher;
  if (!dispatcher || isContextOnlyDispatcher(dispatcher)) {
    return dispatcher;
  }
  renderingRuntime = runtime;
  const existingProxy = runtime.proxyByDispatcher.get(dispatcher);
  if (existingProxy) return existingProxy;
  const proxy = createDispatcherProxy(runtime, dispatcher);
  runtime.proxyByDispatcher.set(dispatcher, proxy);
  return proxy;
};

const associateScopeWithFiber = (scope: ConditionalHookScope, fiber: Fiber): void => {
  scope.fiber = fiber;
  scopeByFiber.set(fiber, scope);
  if (fiber.alternate) scopeByFiber.set(fiber.alternate, scope);
};

const beginRender = (runtime: ConditionalHookRuntime, fiber: Fiber): void => {
  runtime.activeFiber = fiber;
  const scope =
    scopeByFiber.get(fiber) ?? (fiber.alternate ? scopeByFiber.get(fiber.alternate) : undefined);
  if (!scope) return;
  scope.scheduleUpdate = runtime.scheduleUpdate;
  const previousFrame = renderFrameByFiber.get(fiber);
  const shouldReplayStrictCells =
    !scope.didCommit && (fiber.mode & 0b0001000) !== 0 && previousFrame !== undefined;
  associateScopeWithFiber(scope, fiber);
  renderFrameByFiber.set(fiber, {
    callCounts: new Map(),
    cells: shouldReplayStrictCells ? new Map(previousFrame.cells) : new Map(),
    effects: new Map(),
    fiber,
    hookKinds: new Map(),
    reducerActionCounts: new Map(),
    reducerOverrides: new Map(),
    replayedCells: shouldReplayStrictCells ? new Set(previousFrame.cells.keys()) : new Set(),
    renderPhaseUpdates: new Map(),
    scope,
  });
};

const handleDispatcherChange = (
  runtime: ConditionalHookRuntime,
  dispatcher: ConditionalHookDispatcher | null,
): void => {
  runtime.currentDispatcher = dispatcher;
  if (isContextOnlyDispatcher(dispatcher)) {
    runtime.activeFiber = null;
    if (renderingRuntime === runtime) renderingRuntime = null;
    return;
  }
  runtime.activeFiber = null;
  renderingRuntime = runtime;
};

const restoreRuntime = (runtime: ConditionalHookRuntime): void => {
  const descriptor = runtime.originalDescriptor;
  if (descriptor) {
    Object.defineProperty(runtime.dispatcherRef, runtime.dispatcherKey, descriptor);
    runtime.dispatcherRef[runtime.dispatcherKey] = runtime.currentDispatcher;
  } else {
    delete runtime.dispatcherRef[runtime.dispatcherKey];
    runtime.dispatcherRef[runtime.dispatcherKey] = runtime.currentDispatcher;
  }
  runtimes.delete(runtime);
  runtimeByDispatcherRef.delete(runtime.dispatcherRef);
};

const installRenderer = (renderer: ReactRenderer, options: ConditionalHooksOptions): boolean => {
  const dispatcherRef = renderer.currentDispatcherRef;
  if (!dispatcherRef || typeof dispatcherRef !== "object") return false;
  if (runtimeByDispatcherRef.has(dispatcherRef)) return true;

  const dispatcherKey = "H" in dispatcherRef ? "H" : "current";
  const originalDescriptor = Object.getOwnPropertyDescriptor(dispatcherRef, dispatcherKey);
  if (originalDescriptor?.configurable === false) return false;
  const currentDispatcherValue = "H" in dispatcherRef ? dispatcherRef.H : dispatcherRef.current;

  const runtime: ConditionalHookRuntime = {
    activeFiber: null,
    currentDispatcher: isConditionalHookDispatcher(currentDispatcherValue)
      ? currentDispatcherValue
      : null,
    dispatcherKey,
    dispatcherRef,
    getHookKey: options.getHookKey ?? defaultHookKeyResolver,
    originalDescriptor,
    proxyByDispatcher: new WeakMap(),
    renderer,
    scheduleUpdate: null,
  };

  Object.defineProperty(dispatcherRef, dispatcherKey, {
    configurable: true,
    enumerable: originalDescriptor?.enumerable ?? true,
    get: () => getRuntimeDispatcher(runtime),
    set: (dispatcher: ConditionalHookDispatcher | null) => {
      handleDispatcherChange(runtime, dispatcher);
    },
  });

  runtimes.add(runtime);
  runtimeByDispatcherRef.set(dispatcherRef, runtime);
  return true;
};

const getActiveRuntime = (): { fiber: Fiber; runtime: ConditionalHookRuntime } => {
  for (const runtime of runtimes) {
    const fiber = runtime.activeFiber;
    if (fiber) {
      return { fiber, runtime };
    }
  }
  throw new Error("Conditional hooks must be called from a transformed function component.");
};

const getScope = (): { frame: ConditionalRenderFrame; scope: ConditionalHookScope } => {
  const { fiber, runtime } = getActiveRuntime();
  let scope =
    scopeByFiber.get(fiber) ?? (fiber.alternate ? scopeByFiber.get(fiber.alternate) : undefined);
  if (!scope) {
    scope = {
      cells: new Map(),
      didCommit: false,
      didUnmount: false,
      effects: new Map(),
      fiber,
      hookKinds: new Map(),
      layoutEffectsDisconnected: false,
      passiveEffectsDisconnected: false,
      renderer: runtime.renderer,
      scheduleUpdate: runtime.scheduleUpdate,
    };
    associateScopeWithFiber(scope, fiber);
  }
  let frame = renderFrameByFiber.get(fiber);
  scope.scheduleUpdate = runtime.scheduleUpdate ?? scope.scheduleUpdate;
  if (!frame || frame.scope !== scope) {
    frame = {
      callCounts: new Map(),
      cells: new Map(),
      effects: new Map(),
      fiber,
      hookKinds: new Map(),
      reducerActionCounts: new Map(),
      reducerOverrides: new Map(),
      replayedCells: new Set(),
      renderPhaseUpdates: new Map(),
      scope,
    };
    renderFrameByFiber.set(fiber, frame);
  }
  return { frame, scope };
};

const registerHookKind = (
  frame: ConditionalRenderFrame,
  scope: ConditionalHookScope,
  key: PropertyKey,
  kind: ConditionalHookKind,
): void => {
  const previousKind = frame.hookKinds.get(key) ?? scope.hookKinds.get(key);
  if (previousKind && previousKind !== kind) {
    throw new Error(
      `Conditional hook key ${String(key)} changed from ${previousKind} to ${kind}. Keys must identify one hook callsite.`,
    );
  }
  frame.hookKinds.set(key, kind);
};

const scheduleScopeUpdate = (scope: ConditionalHookScope): void => {
  if (scope.didUnmount) return;
  if (scope.scheduleUpdate) {
    scope.scheduleUpdate();
    return;
  }
  const scheduleUpdate = scope.renderer.scheduleUpdate;
  if (!scheduleUpdate) {
    throw new Error("The active React renderer does not expose scheduleUpdate().");
  }
  // HACK: DevTools schedules a no-op lane, so cloning props bypasses React's bailout check.
  const currentFiber = getCurrentFiberBranch(scope.fiber);
  currentFiber.memoizedProps = { ...currentFiber.memoizedProps };
  if (currentFiber.tag === 14 || currentFiber.tag === 15) {
    const pendingProps = {
      ...currentFiber.pendingProps,
      __bippyConditionalHookUpdate: ++scheduledUpdateVersion,
    };
    currentFiber.pendingProps = pendingProps;
    if (currentFiber.alternate) currentFiber.alternate.pendingProps = pendingProps;
  }
  scheduleUpdate(currentFiber);
};

const getCurrentFiberBranch = (fiber: Fiber): Fiber => {
  let root = fiber;
  while (root.return) root = root.return;
  if (
    typeof root.stateNode === "object" &&
    root.stateNode !== null &&
    Reflect.get(root.stateNode, "current") === root
  ) {
    return fiber;
  }
  return fiber.alternate ?? fiber;
};

const getRenderFrameForScope = (
  scope: ConditionalHookScope,
): ConditionalRenderFrame | undefined => {
  for (const runtime of runtimes) {
    const fiber = runtime.activeFiber;
    if (!fiber) continue;
    const activeScope =
      scopeByFiber.get(fiber) ?? (fiber.alternate ? scopeByFiber.get(fiber.alternate) : undefined);
    if (activeScope === scope) return renderFrameByFiber.get(fiber);
  }
  return undefined;
};

const enqueueRenderPhaseUpdate = (
  frame: ConditionalRenderFrame,
  key: PropertyKey,
  action: unknown,
): void => {
  const updates = frame.renderPhaseUpdates.get(key);
  if (updates) updates.push(action);
  else frame.renderPhaseUpdates.set(key, [action]);
};

const areDependenciesEqual = (
  previousDependencies: readonly unknown[] | undefined,
  nextDependencies: readonly unknown[] | undefined,
): boolean => {
  if (!previousDependencies || !nextDependencies) return false;
  if (previousDependencies.length !== nextDependencies.length) return false;
  return previousDependencies.every((dependency, index) =>
    Object.is(dependency, nextDependencies[index]),
  );
};

const runEffectCleanup = (cell: ConditionalEffectCell): void => {
  const cleanup = cell.cleanup;
  cell.cleanup = undefined;
  cleanup?.();
};

const flushPassiveEffects = (): void => {
  didSchedulePassiveEffects = false;
  for (const invoke of pendingPassiveEffects.splice(0)) invoke();
};

const schedulePassiveEffect = (invoke: () => void): void => {
  pendingPassiveEffects.push(invoke);
  if (didSchedulePassiveEffects) return;
  didSchedulePassiveEffects = true;
  queueMicrotask(flushPassiveEffects);
};

const startEffect = (
  scope: ConditionalHookScope,
  key: PropertyKey,
  cell: ConditionalEffectCell,
  create: ConditionalEffectRegistration["create"],
): void => {
  const version = ++cell.version;
  const invoke = (): void => {
    if (scope.didUnmount || scope.effects.get(key) !== cell || cell.version !== version) return;
    cell.cleanup = create() || undefined;
  };
  if (cell.kind !== "effect") {
    invoke();
  } else {
    schedulePassiveEffect(invoke);
  }
};

const isStrictEffectsFiber = (fiber: Fiber): boolean => (fiber.mode & 0b0010000) !== 0;

const getVisibilityState = (fiber: Fiber): ConditionalVisibilityState => {
  let layoutEffectsHidden = false;
  let passiveEffectsHidden = false;
  let ancestor = fiber.return;
  while (ancestor) {
    if (ancestor.tag === 22 && ancestor.memoizedState !== null) {
      layoutEffectsHidden = true;
    }
    if (ancestor.tag === 31 && ancestor.memoizedProps.mode === "hidden") {
      layoutEffectsHidden = true;
      passiveEffectsHidden = true;
    }
    ancestor = ancestor.return;
  }
  return { layoutEffectsHidden, passiveEffectsHidden };
};

const reconnectEffects = (scope: ConditionalHookScope, kind: ConditionalEffectKind): void => {
  for (const [key, cell] of scope.effects) {
    if (cell.kind === kind || (kind === "layout-effect" && cell.kind === "insertion-effect")) {
      startEffect(scope, key, cell, cell.create);
    }
  }
};

const disconnectEffects = (scope: ConditionalHookScope, kind: ConditionalEffectKind): void => {
  for (const cell of scope.effects.values()) {
    if (cell.kind === kind || (kind === "layout-effect" && cell.kind === "insertion-effect")) {
      runEffectCleanup(cell);
    }
  }
};

const updateScopeVisibility = (scope: ConditionalHookScope): void => {
  associateScopeWithFiber(scope, getCurrentFiberBranch(scope.fiber));
  const visibility = getVisibilityState(scope.fiber);
  const shouldDisconnectLayoutEffects = visibility.layoutEffectsHidden;
  const shouldDisconnectPassiveEffects = visibility.passiveEffectsHidden;

  if (shouldDisconnectLayoutEffects !== scope.layoutEffectsDisconnected) {
    scope.layoutEffectsDisconnected = shouldDisconnectLayoutEffects;
    if (shouldDisconnectLayoutEffects) disconnectEffects(scope, "layout-effect");
    else reconnectEffects(scope, "layout-effect");
  }
  if (shouldDisconnectPassiveEffects !== scope.passiveEffectsDisconnected) {
    scope.passiveEffectsDisconnected = shouldDisconnectPassiveEffects;
    if (shouldDisconnectPassiveEffects) disconnectEffects(scope, "effect");
    else reconnectEffects(scope, "effect");
  }
};

const applyRenderPhaseUpdates = (frame: ConditionalRenderFrame): boolean => {
  let didStateChange = false;
  for (const [key, actions] of frame.renderPhaseUpdates) {
    const cell = frame.cells.get(key) ?? frame.scope.cells.get(key);
    if (!cell || (cell.kind !== "state" && cell.kind !== "reducer")) continue;
    let nextValue = cell.value;
    for (const action of actions) {
      if (cell.kind === "state") {
        nextValue = typeof action === "function" ? action(nextValue) : action;
      } else {
        const reducer = frame.reducerOverrides.get(key) ?? cell.reducer;
        nextValue = reducer(nextValue, action);
      }
    }
    if (Object.is(cell.value, nextValue)) continue;
    cell.value = nextValue;
    didStateChange = true;
  }
  return didStateChange;
};

const commitRenderFrame = (
  frame: ConditionalRenderFrame,
  pendingInsertionEffects: Array<[ConditionalHookScope, PropertyKey, ConditionalEffectCell]>,
  pendingLayoutEffects: Array<[ConditionalHookScope, PropertyKey, ConditionalEffectCell]>,
  pendingStrictLayoutEffects: Array<[ConditionalHookScope, PropertyKey, ConditionalEffectCell]>,
  pendingStrictPassiveEffects: Array<[ConditionalHookScope, PropertyKey, ConditionalEffectCell]>,
): void => {
  const { effects, scope } = frame;
  scopes.add(scope);
  associateScopeWithFiber(scope, frame.fiber);
  for (const [key, kind] of frame.hookKinds) scope.hookKinds.set(key, kind);
  for (const [key, cell] of frame.cells) {
    const previousCell = scope.cells.get(key);
    if (
      previousCell?.kind === "reducer" &&
      cell.kind === "reducer" &&
      previousCell.dispatch === cell.dispatch
    ) {
      previousCell.value = cell.value;
    } else {
      scope.cells.set(key, cell);
    }
  }
  for (const [key, reducer] of frame.reducerOverrides) {
    const cell = scope.cells.get(key);
    if (cell?.kind === "reducer") {
      cell.reducer = reducer;
      const actionCount = frame.reducerActionCounts.get(key) ?? 0;
      if (actionCount > 0) cell.pendingActions.splice(0, actionCount);
    }
  }
  const isInitialCommit = !scope.didCommit;
  scope.didCommit = true;

  if (applyRenderPhaseUpdates(frame)) {
    queueMicrotask(() => scheduleScopeUpdate(scope));
    return;
  }

  for (const [key, cell] of scope.effects) {
    if (effects.has(key)) continue;
    runEffectCleanup(cell);
    scope.effects.delete(key);
  }

  const changedEffects: Array<[PropertyKey, ConditionalEffectCell]> = [];
  for (const [key, registration] of effects) {
    const previousCell = scope.effects.get(key);
    if (
      previousCell &&
      previousCell.kind === registration.kind &&
      areDependenciesEqual(previousCell.dependencies, registration.dependencies)
    ) {
      previousCell.create = registration.create;
      continue;
    }
    if (previousCell) runEffectCleanup(previousCell);
    const cell: ConditionalEffectCell = {
      cleanup: undefined,
      create: registration.create,
      dependencies: registration.dependencies,
      kind: registration.kind,
      version: previousCell?.version ?? 0,
    };
    scope.effects.set(key, cell);
    changedEffects.push([key, cell]);
  }

  const visibility = getVisibilityState(scope.fiber);
  const areLayoutEffectsHidden = visibility.layoutEffectsHidden;
  const arePassiveEffectsHidden = visibility.passiveEffectsHidden;
  for (const [key, cell] of changedEffects) {
    if (cell.kind !== "effect" && areLayoutEffectsHidden) continue;
    if (cell.kind === "effect" && arePassiveEffectsHidden) continue;
    if (cell.kind === "insertion-effect") {
      pendingInsertionEffects.push([scope, key, cell]);
    } else if (cell.kind === "layout-effect") {
      pendingLayoutEffects.push([scope, key, cell]);
    } else {
      startEffect(scope, key, cell, cell.create);
    }
  }

  if (isInitialCommit && isStrictEffectsFiber(frame.fiber)) {
    const layoutEffects = areLayoutEffectsHidden
      ? []
      : changedEffects.filter(([, cell]) => cell.kind === "layout-effect");
    for (const [key, cell] of layoutEffects) {
      pendingStrictLayoutEffects.push([scope, key, cell]);
    }
    const passiveEffects = arePassiveEffectsHidden
      ? []
      : changedEffects.filter(([, cell]) => cell.kind === "effect");
    for (const [key, cell] of passiveEffects) {
      pendingStrictPassiveEffects.push([scope, key, cell]);
    }
  }
};

const commitRoot = (root: FiberRoot): void => {
  flushPassiveEffects();
  const pendingInsertionEffects: Array<[ConditionalHookScope, PropertyKey, ConditionalEffectCell]> =
    [];
  const pendingLayoutEffects: Array<[ConditionalHookScope, PropertyKey, ConditionalEffectCell]> =
    [];
  const pendingStrictLayoutEffects: Array<
    [ConditionalHookScope, PropertyKey, ConditionalEffectCell]
  > = [];
  const pendingStrictPassiveEffects: Array<
    [ConditionalHookScope, PropertyKey, ConditionalEffectCell]
  > = [];
  traverseFiber(root.current, (fiber) => {
    let frame = renderFrameByFiber.get(fiber);
    if (!frame) {
      const scope =
        scopeByFiber.get(fiber) ??
        (fiber.alternate ? scopeByFiber.get(fiber.alternate) : undefined);
      if (scope && didFiberRender(fiber)) {
        frame = {
          callCounts: new Map(),
          cells: new Map(),
          effects: new Map(),
          fiber,
          hookKinds: new Map(),
          reducerActionCounts: new Map(),
          reducerOverrides: new Map(),
          replayedCells: new Set(),
          renderPhaseUpdates: new Map(),
          scope,
        };
      }
    }
    if (!frame) return;
    renderFrameByFiber.delete(fiber);
    commitRenderFrame(
      frame,
      pendingInsertionEffects,
      pendingLayoutEffects,
      pendingStrictLayoutEffects,
      pendingStrictPassiveEffects,
    );
  });
  for (const [scope, key, cell] of pendingInsertionEffects) {
    startEffect(scope, key, cell, cell.create);
  }
  for (const [scope, key, cell] of pendingLayoutEffects) {
    startEffect(scope, key, cell, cell.create);
  }
  if (pendingStrictLayoutEffects.length > 0 || pendingStrictPassiveEffects.length > 0) {
    queueMicrotask(() => {
      for (const [, , cell] of pendingStrictLayoutEffects) runEffectCleanup(cell);
      for (const [, , cell] of pendingStrictPassiveEffects) runEffectCleanup(cell);
      for (const [scope, key, cell] of pendingStrictLayoutEffects) {
        startEffect(scope, key, cell, cell.create);
      }
      for (const [scope, key, cell] of pendingStrictPassiveEffects) {
        startEffect(scope, key, cell, cell.create);
      }
    });
  }
  for (const scope of scopes) updateScopeVisibility(scope);
};

const disposeScope = (scope: ConditionalHookScope): void => {
  if (scope.didUnmount) return;
  scope.didUnmount = true;
  for (const cell of scope.effects.values()) runEffectCleanup(cell);
  scope.effects.clear();
  scope.cells.clear();
  scope.hookKinds.clear();
  scopeByFiber.delete(scope.fiber);
  renderFrameByFiber.delete(scope.fiber);
  if (scope.fiber.alternate) {
    scopeByFiber.delete(scope.fiber.alternate);
    renderFrameByFiber.delete(scope.fiber.alternate);
  }
  scopes.delete(scope);
};

const unmountFiber = (fiber: Fiber): void => {
  const scope =
    scopeByFiber.get(fiber) ?? (fiber.alternate ? scopeByFiber.get(fiber.alternate) : undefined);
  if (scope) disposeScope(scope);
};

const installAvailableRenderers = (options: ConditionalHooksOptions): void => {
  for (const renderer of getRDTHook().renderers.values()) installRenderer(renderer, options);
};

export const installConditionalHooks = (
  options: ConditionalHooksOptions = {},
): ConditionalHooksInstallation => {
  if (installation) {
    installAvailableRenderers(options);
    return installation;
  }

  const unsubscribeInstrumentation = instrument({
    name: "bippy-conditional-hooks",
    onActive: () => installAvailableRenderers(options),
    onCommitFiberRoot: (_rendererId, root) => commitRoot(root),
    onCommitFiberUnmount: (_rendererId, fiber) => unmountFiber(fiber),
  });
  const unsubscribeRendererInject = onRendererInject((renderer) =>
    installRenderer(renderer, options),
  );
  installAvailableRenderers(options);

  let didUnsubscribe = false;
  const unsubscribe = createUnsubscribe(() => {
    if (didUnsubscribe) return;
    didUnsubscribe = true;
    unsubscribeRendererInject();
    unsubscribeInstrumentation();
    for (const scope of scopes) disposeScope(scope);
    for (const runtime of runtimes) restoreRuntime(runtime);
    renderingRuntime = null;
    if (installation === unsubscribe) installation = null;
  });

  Object.defineProperty(unsubscribe, "supportedRenderers", {
    configurable: true,
    get: () => runtimes.size,
  });
  if (!isConditionalHooksInstallation(unsubscribe)) {
    throw new Error("Failed to install conditional hooks.");
  }
  installation = unsubscribe;
  return unsubscribe;
};

export const useConditionalHooks = (): void => {
  const fiber = useFiber();
  const [, scheduleUpdate] = useReducer(incrementVersion, 0);
  const runtime = renderingRuntime;
  if (!fiber || !runtime) {
    throw new Error("Conditional hooks require an installed client renderer.");
  }
  runtime.scheduleUpdate = () => scheduleUpdate();
  beginRender(runtime, fiber);
};

const ensureInstalled = (): void => {
  if (!installation) installConditionalHooks();
};

const readStateCell = <State>(
  key: PropertyKey,
  initialState: State | (() => State),
): [State, ConditionalStateSetter<State>] => {
  ensureInstalled();
  const { frame, scope } = getScope();
  registerHookKind(frame, scope, key, "state");
  let cell = frame.cells.get(key) ?? scope.cells.get(key);
  if (!cell) {
    const stateCell: ConditionalStateCell = {
      dispatch: (action) => {
        if (scope.didUnmount) return;
        const renderFrame = getRenderFrameForScope(scope);
        if (renderFrame) {
          enqueueRenderPhaseUpdate(renderFrame, key, action);
          return;
        }
        if (scope.cells.get(key) !== stateCell) return;
        const nextValue = typeof action === "function" ? action(stateCell.value) : action;
        if (typeof action === "function" && (scope.fiber.mode & 0b0001000) !== 0) {
          action(stateCell.value);
        }
        if (Object.is(stateCell.value, nextValue)) return;
        stateCell.value = nextValue;
        scheduleScopeUpdate(scope);
      },
      kind: "state",
      value:
        typeof initialState === "function"
          ? Reflect.apply(initialState, undefined, [])
          : initialState,
    };
    cell = stateCell;
    frame.cells.set(key, cell);
  } else if (frame.replayedCells.delete(key) && typeof initialState === "function") {
    Reflect.apply(initialState, undefined, []);
  }
  if (cell.kind !== "state") throw new Error(`Conditional hook key ${String(key)} is not state.`);
  return [cell.value, cell.dispatch] as [State, ConditionalStateSetter<State>];
};

const readReducerCell = <State, Action, InitialState>(
  key: PropertyKey,
  reducer: (state: State, action: Action) => State,
  initialState: InitialState,
  initialize?: (initialState: InitialState) => State,
): [State, ConditionalReducerDispatcher<Action>] => {
  ensureInstalled();
  const { frame, scope } = getScope();
  registerHookKind(frame, scope, key, "reducer");
  let cell = frame.cells.get(key) ?? scope.cells.get(key);
  if (!cell) {
    const reducerCell: ConditionalReducerCell = {
      dispatch: (action) => {
        if (scope.didUnmount) return;
        const renderFrame = getRenderFrameForScope(scope);
        if (renderFrame) {
          enqueueRenderPhaseUpdate(renderFrame, key, action);
          return;
        }
        if (scope.cells.get(key) !== reducerCell) return;
        reducerCell.pendingActions.push(action);
        scheduleScopeUpdate(scope);
      },
      kind: "reducer",
      pendingActions: [],
      reducer: (state, action) => reducer(state as State, action as Action),
      value: initialize ? initialize(initialState) : initialState,
    };
    cell = reducerCell;
    frame.cells.set(key, cell);
  } else if (frame.replayedCells.delete(key) && initialize) {
    initialize(initialState);
  }
  if (cell.kind !== "reducer") {
    throw new Error(`Conditional hook key ${String(key)} is not a reducer.`);
  }
  const currentReducer = (state: unknown, action: unknown): unknown =>
    reducer(state as State, action as Action);
  frame.reducerOverrides.set(key, currentReducer);
  if (cell.pendingActions.length > 0) {
    let nextValue = cell.value;
    for (const action of cell.pendingActions) nextValue = currentReducer(nextValue, action);
    const renderedCell: ConditionalReducerCell = {
      ...cell,
      value: nextValue,
    };
    frame.cells.set(key, renderedCell);
    frame.reducerActionCounts.set(key, cell.pendingActions.length);
    cell = renderedCell;
  }
  return [cell.value, cell.dispatch] as [State, ConditionalReducerDispatcher<Action>];
};

const readRefCell = <Value>(key: PropertyKey, initialValue: Value): ConditionalRef<Value> => {
  ensureInstalled();
  const { frame, scope } = getScope();
  registerHookKind(frame, scope, key, "ref");
  let cell = frame.cells.get(key) ?? scope.cells.get(key);
  if (!cell) {
    cell = {
      kind: "ref",
      value: { current: initialValue },
    };
    frame.cells.set(key, cell);
  }
  if (cell.kind !== "ref") throw new Error(`Conditional hook key ${String(key)} is not a ref.`);
  return cell.value as ConditionalRef<Value>;
};

const readMemoCell = <Value>(
  key: PropertyKey,
  create: () => Value,
  dependencies?: readonly unknown[],
): Value => {
  ensureInstalled();
  const { frame, scope } = getScope();
  registerHookKind(frame, scope, key, "memo");
  const cell = frame.cells.get(key) ?? scope.cells.get(key);
  if (cell?.kind === "memo" && frame.replayedCells.delete(key)) {
    create();
    return cell.value as Value;
  }
  if (cell?.kind === "memo" && areDependenciesEqual(cell.dependencies, dependencies)) {
    return cell.value as Value;
  }
  if (cell && cell.kind !== "memo") {
    throw new Error(`Conditional hook key ${String(key)} is not memoized.`);
  }
  const value = create();
  frame.cells.set(key, {
    dependencies,
    kind: "memo",
    value,
  });
  return value;
};

const readValueCell = <Value>(
  key: PropertyKey,
  kind: ConditionalValueCell["kind"],
  value: Value,
): Value => {
  const { frame, scope } = getScope();
  registerHookKind(frame, scope, key, kind);
  const cell = frame.cells.get(key) ?? scope.cells.get(key);
  if (cell && cell.kind !== kind) {
    throw new Error(`Conditional hook key ${String(key)} is not ${kind}.`);
  }
  if (!cell || !Object.is(cell.value, value)) {
    frame.cells.set(key, { kind, value });
  }
  return value;
};

const readIdCell = (key: PropertyKey): string => {
  const { frame, scope } = getScope();
  registerHookKind(frame, scope, key, "id");
  let cell = frame.cells.get(key) ?? scope.cells.get(key);
  if (!cell) {
    cell = { kind: "id", value: `:bippy-${(++conditionalId).toString(32)}:` };
    frame.cells.set(key, cell);
  }
  if (cell.kind !== "id" || typeof cell.value !== "string") {
    throw new Error(`Conditional hook key ${String(key)} is not an id.`);
  }
  return cell.value;
};

const readTransitionCell = (key: PropertyKey): [boolean, (callback: () => void) => void] => {
  const { frame, scope } = getScope();
  registerHookKind(frame, scope, key, "transition");
  let cell = frame.cells.get(key) ?? scope.cells.get(key);
  if (!cell) {
    const transitionCell: ConditionalTransitionCell = {
      isPending: false,
      kind: "transition",
      startTransition: (callback) => {
        const currentCell = scope.cells.get(key);
        if (scope.didUnmount || currentCell?.kind !== "transition") return;
        currentCell.isPending = true;
        scheduleScopeUpdate(scope);
        try {
          callback();
        } finally {
          queueMicrotask(() => {
            const latestCell = scope.cells.get(key);
            if (scope.didUnmount || latestCell?.kind !== "transition") return;
            latestCell.isPending = false;
            scheduleScopeUpdate(scope);
          });
        }
      },
    };
    cell = transitionCell;
    frame.cells.set(key, cell);
  }
  if (cell.kind !== "transition") {
    throw new Error(`Conditional hook key ${String(key)} is not a transition.`);
  }
  return [cell.isPending, cell.startTransition];
};

const readExternalStoreCell = (
  key: PropertyKey,
  subscribe: (onStoreChange: () => void) => unknown,
  getSnapshot: () => unknown,
): unknown => {
  const { frame, scope } = getScope();
  registerHookKind(frame, scope, key, "external-store");
  const value = getSnapshot();
  const previousCell = frame.cells.get(key) ?? scope.cells.get(key);
  if (previousCell && previousCell.kind !== "external-store") {
    throw new Error(`Conditional hook key ${String(key)} is not an external store.`);
  }
  frame.cells.set(key, { getSnapshot, kind: "external-store", value });
  registerEffect(
    key,
    "effect",
    () => {
      const checkForUpdates = (): void => {
        const cell = scope.cells.get(key);
        if (scope.didUnmount || cell?.kind !== "external-store") return;
        const nextValue = cell.getSnapshot();
        if (Object.is(cell.value, nextValue)) return;
        cell.value = nextValue;
        scheduleScopeUpdate(scope);
      };
      checkForUpdates();
      const unsubscribe = subscribe(checkForUpdates);
      return typeof unsubscribe === "function"
        ? () => {
            Reflect.apply(unsubscribe, undefined, []);
          }
        : undefined;
    },
    [subscribe],
    "external-store",
  );
  return value;
};

const readCacheRefreshCell = (key: PropertyKey): (() => void) => {
  const { frame, scope } = getScope();
  registerHookKind(frame, scope, key, "cache-refresh");
  let cell = frame.cells.get(key) ?? scope.cells.get(key);
  if (!cell) {
    cell = {
      kind: "cache-refresh",
      refresh: () => scheduleScopeUpdate(scope),
    };
    frame.cells.set(key, cell);
  }
  if (cell.kind !== "cache-refresh") {
    throw new Error(`Conditional hook key ${String(key)} is not a cache refresh.`);
  }
  return cell.refresh;
};

const readOptimisticCell = (
  key: PropertyKey,
  passthrough: unknown,
  reducer: (state: unknown, action: unknown) => unknown,
): [unknown, (action: unknown) => void] => {
  const { frame, scope } = getScope();
  registerHookKind(frame, scope, key, "optimistic");
  let cell = frame.cells.get(key) ?? scope.cells.get(key);
  if (!cell) {
    const optimisticCell: ConditionalOptimisticCell = {
      dispatch: (action) => {
        const currentCell = scope.cells.get(key);
        if (scope.didUnmount || currentCell?.kind !== "optimistic") return;
        currentCell.value = currentCell.reducer(currentCell.value, action);
        currentCell.isPending = true;
        scheduleScopeUpdate(scope);
      },
      isPending: false,
      kind: "optimistic",
      reducer,
      value: passthrough,
    };
    cell = optimisticCell;
    frame.cells.set(key, cell);
  }
  if (cell.kind !== "optimistic") {
    throw new Error(`Conditional hook key ${String(key)} is not optimistic state.`);
  }
  if (scope.cells.get(key) === cell && cell.isPending) {
    cell = { ...cell, isPending: false, reducer };
    frame.cells.set(key, cell);
  } else if (!Object.is(cell.value, passthrough)) {
    cell = { ...cell, reducer, value: passthrough };
    frame.cells.set(key, cell);
  } else {
    cell.reducer = reducer;
  }
  return [cell.value, cell.dispatch];
};

const readActionStateCell = (
  key: PropertyKey,
  action: (previousState: unknown, payload: unknown) => unknown,
  initialState: unknown,
): [unknown, (payload: unknown) => void, boolean] => {
  const { frame, scope } = getScope();
  registerHookKind(frame, scope, key, "action-state");
  let cell = frame.cells.get(key) ?? scope.cells.get(key);
  if (!cell) {
    const actionStateCell: ConditionalActionStateCell = {
      action,
      dispatch: (payload) => {
        const currentCell = scope.cells.get(key);
        if (scope.didUnmount || currentCell?.kind !== "action-state") return;
        const dispatchedAction = currentCell.action;
        currentCell.pendingActions++;
        currentCell.isPending = true;
        scheduleScopeUpdate(scope);
        currentCell.pendingAction = currentCell.pendingAction
          .catch(() => {})
          .then(async () => {
            const latestCell = scope.cells.get(key);
            if (scope.didUnmount || latestCell?.kind !== "action-state") return;
            latestCell.value = await dispatchedAction(latestCell.value, payload);
          })
          .finally(() => {
            const latestCell = scope.cells.get(key);
            if (scope.didUnmount || latestCell?.kind !== "action-state") return;
            latestCell.pendingActions--;
            latestCell.isPending = latestCell.pendingActions > 0;
            scheduleScopeUpdate(scope);
          });
      },
      isPending: false,
      kind: "action-state",
      pendingAction: Promise.resolve(),
      pendingActions: 0,
      value: initialState,
    };
    cell = actionStateCell;
    frame.cells.set(key, cell);
  }
  if (cell.kind !== "action-state") {
    throw new Error(`Conditional hook key ${String(key)} is not action state.`);
  }
  if (cell.action !== action) {
    cell = { ...cell, action };
    frame.cells.set(key, cell);
  }
  return [cell.value, cell.dispatch, cell.isPending];
};

const readEffectEventCell = (
  key: PropertyKey,
  callback: (...arguments_: unknown[]) => unknown,
): ((...arguments_: unknown[]) => unknown) => {
  const { frame, scope } = getScope();
  registerHookKind(frame, scope, key, "effect-event");
  let cell = frame.cells.get(key) ?? scope.cells.get(key);
  if (!cell) {
    const effectEventCell: ConditionalEffectEventCell = {
      callback,
      event: (...arguments_) => {
        if (getRenderFrameForScope(scope)) {
          throw new Error(
            "A function returned by useEffectEvent cannot be called during rendering.",
          );
        }
        const currentCell = scope.cells.get(key);
        if (currentCell?.kind !== "effect-event") return undefined;
        return currentCell.callback(...arguments_);
      },
      kind: "effect-event",
    };
    cell = effectEventCell;
    frame.cells.set(key, cell);
  }
  if (cell.kind !== "effect-event") {
    throw new Error(`Conditional hook key ${String(key)} is not an effect event.`);
  }
  if (cell.callback !== callback) {
    cell = { ...cell, callback };
    frame.cells.set(key, cell);
  }
  return cell.event;
};

const readMemoCacheCell = (key: PropertyKey, size: number): unknown[] => {
  const { frame, scope } = getScope();
  registerHookKind(frame, scope, key, "memo-cache");
  let cell = frame.cells.get(key) ?? scope.cells.get(key);
  if (!cell) {
    cell = {
      kind: "memo-cache",
      value: Array.from({ length: size }, () => Symbol.for("react.memo_cache_sentinel")),
    };
    frame.cells.set(key, cell);
  }
  if (cell.kind !== "memo-cache" || !Array.isArray(cell.value)) {
    throw new Error(`Conditional hook key ${String(key)} is not a memo cache.`);
  }
  return cell.value;
};

const setImperativeHandle = (
  ref: unknown,
  create: (...arguments_: unknown[]) => unknown,
): (() => void) | void => {
  const value = create();
  if (typeof ref === "function") {
    const cleanup = ref(value);
    return typeof cleanup === "function" ? cleanup : () => ref(null);
  }
  if (typeof ref !== "object" || ref === null || !("current" in ref)) return;
  Reflect.set(ref, "current", value);
  return () => {
    Reflect.set(ref, "current", null);
  };
};

const registerEffect = (
  key: PropertyKey,
  kind: ConditionalEffectKind,
  create: () => (() => void) | void,
  dependencies?: readonly unknown[],
  hookKind: ConditionalHookKind = kind,
): void => {
  ensureInstalled();
  const { frame, scope } = getScope();
  registerHookKind(frame, scope, key, hookKind);
  frame.effects.set(key, {
    create,
    dependencies,
    kind,
  });
};
