import "./install-hook-only.js";

import { instrument, traverseFiber } from "./core.js";
import { _renderers, getRDTHook, onRendererInject } from "./rdt-hook.js";
import type { Fiber, FiberRoot, ReactRenderer } from "./types.js";
import { toUnsubscribe, type Unsubscribe } from "./unsubscribe.js";

interface ConditionalHookDispatcher {
  readContext?: (...arguments_: unknown[]) => unknown;
  useCallback?: (...arguments_: unknown[]) => unknown;
  useContext?: (...arguments_: unknown[]) => unknown;
  useDebugValue?: (...arguments_: unknown[]) => unknown;
  useEffect?: (...arguments_: unknown[]) => unknown;
  useLayoutEffect?: (...arguments_: unknown[]) => unknown;
  useMemo?: (...arguments_: unknown[]) => unknown;
  useReducer?: (...arguments_: unknown[]) => unknown;
  useRef?: (...arguments_: unknown[]) => unknown;
  useState?: (...arguments_: unknown[]) => unknown;
}

interface ConditionalHookDispatcherRef {
  H?: ConditionalHookDispatcher | null;
  current?: ConditionalHookDispatcher | null;
}

interface ConditionalHookRuntime {
  activeFiber: Fiber | null;
  currentDispatcher: ConditionalHookDispatcher | null;
  dispatcherKey: "H" | "current";
  dispatcherRef: ConditionalHookDispatcherRef;
  getHookKey: ConditionalHookKeyResolver;
  interceptReactHooks: boolean;
  originalDescriptor: PropertyDescriptor | undefined;
  proxyByDispatcher: WeakMap<object, ConditionalHookDispatcher>;
  renderer: ReactRenderer;
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

export interface ConditionalRef<Value> {
  current: Value;
}

export interface ConditionalStateSetter<State> {
  (action: State | ((previousState: State) => State)): void;
}

export interface ConditionalReducerDispatcher<Action> {
  (action: Action): void;
}

export interface ConditionalHooksInstallation extends Unsubscribe {
  readonly supportedRenderers: number;
}

export interface ConditionalHooksOptions {
  getHookKey?: ConditionalHookKeyResolver;
  interceptReactHooks?: boolean;
}

export interface ConditionalHookKeyResolver {
  (hookName: string, stack: string): PropertyKey;
}

type ConditionalHookCell =
  | ConditionalMemoCell
  | ConditionalReducerCell
  | ConditionalRefCell
  | ConditionalStateCell;

type ConditionalEffectKind = "effect" | "layout-effect";

type ConditionalHookKind = ConditionalHookCell["kind"] | ConditionalEffectKind;

const runtimes = new Set<ConditionalHookRuntime>();
const scopes = new Set<ConditionalHookScope>();
const runtimeByDispatcherRef = new WeakMap<object, ConditionalHookRuntime>();
const scopeByFiber = new WeakMap<Fiber, ConditionalHookScope>();
const renderFrameByFiber = new WeakMap<Fiber, ConditionalRenderFrame>();

let installation: ConditionalHooksInstallation | null = null;
let scheduledUpdateVersion = 0;

const getCurrentFiber = (renderer: ReactRenderer): Fiber | null => {
  try {
    return renderer.getCurrentFiber?.() ?? null;
  } catch {
    return null;
  }
};

const isContextOnlyDispatcher = (dispatcher: ConditionalHookDispatcher | null): boolean => {
  if (!dispatcher) return true;
  return (
    typeof dispatcher.useState === "function" &&
    dispatcher.useState === dispatcher.useReducer &&
    dispatcher.useReducer === dispatcher.useRef &&
    dispatcher.useRef === dispatcher.useEffect
  );
};

const defaultHookKeyResolver: ConditionalHookKeyResolver = (hookName, stack) => {
  const callsite = stack
    .split("\n")
    .map((line) => line.trim())
    .find(
      (line) =>
        line.startsWith("at ") &&
        !line.includes("conditional-hooks") &&
        !line.includes("node_modules/react/") &&
        !line.includes("node_modules/.vite/deps/react") &&
        !line.includes("react.development.js") &&
        !line.includes("react.production.js"),
    );
  if (!callsite) {
    throw new Error(`Could not derive a callsite key for React.${hookName}().`);
  }
  return `${hookName}:${callsite}`;
};

const getAutomaticHookKey = (runtime: ConditionalHookRuntime, hookName: string): PropertyKey => {
  const { frame } = getScope();
  const stack = new Error().stack ?? "";
  const callsiteKey = runtime.getHookKey(hookName, stack);
  const occurrence = frame.callCounts.get(callsiteKey) ?? 0;
  frame.callCounts.set(callsiteKey, occurrence + 1);
  return `react:${String(callsiteKey)}:${occurrence}`;
};

const getDependencies = (value: unknown): readonly unknown[] | undefined =>
  Array.isArray(value) ? value : undefined;

const createDispatcherProxy = (
  runtime: ConditionalHookRuntime,
  dispatcher: ConditionalHookDispatcher,
): ConditionalHookDispatcher =>
  new Proxy(dispatcher, {
    get: (target, property, receiver) => {
      if (property === "useState") {
        return (initialState: unknown) =>
          useConditionalState(getAutomaticHookKey(runtime, "useState"), initialState);
      }
      if (property === "useReducer") {
        return (reducer: unknown, initialState: unknown, initialize: unknown) => {
          if (typeof reducer !== "function") throw new TypeError("useReducer requires a reducer.");
          const initializer =
            typeof initialize === "function" ? (value: unknown) => initialize(value) : undefined;
          return useConditionalReducer(
            getAutomaticHookKey(runtime, "useReducer"),
            (state: unknown, action: unknown) => reducer(state, action),
            initialState,
            initializer,
          );
        };
      }
      if (property === "useRef") {
        return (initialValue: unknown) =>
          useConditionalRef(getAutomaticHookKey(runtime, "useRef"), initialValue);
      }
      if (property === "useMemo") {
        return (create: unknown, dependencies: unknown) => {
          if (typeof create !== "function") throw new TypeError("useMemo requires a function.");
          return useConditionalMemo(
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
          return useConditionalMemo(
            getAutomaticHookKey(runtime, "useCallback"),
            () => callback,
            getDependencies(dependencies),
          );
        };
      }
      if (property === "useEffect" || property === "useLayoutEffect") {
        return (create: unknown, dependencies: unknown) => {
          if (typeof create !== "function") {
            throw new TypeError(`${property} requires a function.`);
          }
          registerEffect(
            getAutomaticHookKey(runtime, property),
            property === "useEffect" ? "effect" : "layout-effect",
            () => create(),
            getDependencies(dependencies),
          );
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
  if (!runtime.interceptReactHooks || !dispatcher || isContextOnlyDispatcher(dispatcher)) {
    return dispatcher;
  }
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
  const previousDispatcher = runtime.currentDispatcher;
  runtime.currentDispatcher = dispatcher;
  if (isContextOnlyDispatcher(dispatcher)) {
    runtime.activeFiber = null;
    return;
  }
  const fiber = getCurrentFiber(runtime.renderer);
  if (fiber && (fiber !== runtime.activeFiber || dispatcher !== previousDispatcher)) {
    beginRender(runtime, fiber);
  }
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
  if (
    typeof renderer.getCurrentFiber !== "function" ||
    typeof renderer.scheduleUpdate !== "function"
  ) {
    return false;
  }
  const dispatcherRef = renderer.currentDispatcherRef;
  if (!dispatcherRef || typeof dispatcherRef !== "object") return false;
  if (runtimeByDispatcherRef.has(dispatcherRef)) return true;

  const dispatcherKey = "H" in dispatcherRef ? "H" : "current";
  const originalDescriptor = Object.getOwnPropertyDescriptor(dispatcherRef, dispatcherKey);
  if (originalDescriptor?.configurable === false) return false;

  const runtime: ConditionalHookRuntime = {
    activeFiber: null,
    currentDispatcher: dispatcherRef[dispatcherKey] ?? null,
    dispatcherKey,
    dispatcherRef,
    getHookKey: options.getHookKey ?? defaultHookKeyResolver,
    interceptReactHooks: options.interceptReactHooks ?? false,
    originalDescriptor,
    proxyByDispatcher: new WeakMap(),
    renderer,
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
    const fiber = runtime.activeFiber ?? getCurrentFiber(runtime.renderer);
    if (fiber) {
      if (runtime.activeFiber !== fiber) beginRender(runtime, fiber);
      return { fiber, runtime };
    }
  }
  throw new Error(
    "Conditional hooks require a React development renderer and must be called while a component is rendering. Call installConditionalHooks() before rendering.",
  );
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
    };
    associateScopeWithFiber(scope, fiber);
  }
  let frame = renderFrameByFiber.get(fiber);
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
  if (root.stateNode?.current === root) return fiber;
  return fiber.alternate ?? fiber;
};

const getRenderFrameForScope = (
  scope: ConditionalHookScope,
): ConditionalRenderFrame | undefined => {
  const fiber = getCurrentFiber(scope.renderer);
  if (!fiber) return undefined;
  const activeScope =
    scopeByFiber.get(fiber) ?? (fiber.alternate ? scopeByFiber.get(fiber.alternate) : undefined);
  if (activeScope !== scope) return undefined;
  return renderFrameByFiber.get(fiber);
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
  if (cell.kind === "layout-effect") {
    invoke();
  } else {
    queueMicrotask(invoke);
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
    if (cell.kind === kind) startEffect(scope, key, cell, cell.create);
  }
};

const disconnectEffects = (scope: ConditionalHookScope, kind: ConditionalEffectKind): void => {
  for (const cell of scope.effects.values()) {
    if (cell.kind === kind) runEffectCleanup(cell);
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
    if (cell.kind === "layout-effect" && areLayoutEffectsHidden) continue;
    if (cell.kind === "effect" && arePassiveEffectsHidden) continue;
    if (cell.kind === "layout-effect") pendingLayoutEffects.push([scope, key, cell]);
    else startEffect(scope, key, cell, cell.create);
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
  const pendingLayoutEffects: Array<[ConditionalHookScope, PropertyKey, ConditionalEffectCell]> =
    [];
  const pendingStrictLayoutEffects: Array<
    [ConditionalHookScope, PropertyKey, ConditionalEffectCell]
  > = [];
  const pendingStrictPassiveEffects: Array<
    [ConditionalHookScope, PropertyKey, ConditionalEffectCell]
  > = [];
  traverseFiber(root.current, (fiber) => {
    const frame = renderFrameByFiber.get(fiber);
    if (!frame) return;
    renderFrameByFiber.delete(fiber);
    commitRenderFrame(
      frame,
      pendingLayoutEffects,
      pendingStrictLayoutEffects,
      pendingStrictPassiveEffects,
    );
  });
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

export const installConditionalHooks = (
  options: ConditionalHooksOptions = {},
): ConditionalHooksInstallation => {
  if (installation) return installation;

  const rdtHook = getRDTHook();
  for (const renderer of [..._renderers, ...rdtHook.renderers.values()]) {
    installRenderer(renderer, options);
  }
  const unsubscribeRendererInject = onRendererInject((renderer) => {
    installRenderer(renderer, options);
  });
  const unsubscribeInstrumentation = instrument({
    name: "bippy-conditional-hooks",
    onCommitFiberRoot: (_rendererId, root) => commitRoot(root),
    onCommitFiberUnmount: (_rendererId, fiber) => unmountFiber(fiber),
  });

  let didUnsubscribe = false;
  const unsubscribe = toUnsubscribe(() => {
    if (didUnsubscribe) return;
    didUnsubscribe = true;
    unsubscribeRendererInject();
    unsubscribeInstrumentation();
    for (const scope of scopes) disposeScope(scope);
    for (const runtime of runtimes) restoreRuntime(runtime);
    if (installation === unsubscribe) installation = null;
  });

  installation = Object.defineProperty(unsubscribe, "supportedRenderers", {
    configurable: true,
    get: () => runtimes.size,
  });
  return installation;
};

const ensureInstalled = (): void => {
  if (!installation) installConditionalHooks();
};

export const useConditionalState = <State>(
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
      value: typeof initialState === "function" ? initialState() : initialState,
    };
    cell = stateCell;
    frame.cells.set(key, cell);
  } else if (frame.replayedCells.delete(key) && typeof initialState === "function") {
    initialState();
  }
  if (cell.kind !== "state") throw new Error(`Conditional hook key ${String(key)} is not state.`);
  return [cell.value, cell.dispatch] as [State, ConditionalStateSetter<State>];
};

export const useConditionalReducer = <State, Action, InitialState>(
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

export const useConditionalRef = <Value>(
  key: PropertyKey,
  initialValue: Value,
): ConditionalRef<Value> => {
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

export const useConditionalMemo = <Value>(
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

export const useConditionalCallback = <Callback extends (...arguments_: never[]) => unknown>(
  key: PropertyKey,
  callback: Callback,
  dependencies?: readonly unknown[],
): Callback => useConditionalMemo(key, () => callback, dependencies);

const registerEffect = (
  key: PropertyKey,
  kind: ConditionalEffectKind,
  create: () => (() => void) | void,
  dependencies?: readonly unknown[],
): void => {
  ensureInstalled();
  const { frame, scope } = getScope();
  registerHookKind(frame, scope, key, kind);
  frame.effects.set(key, {
    create,
    dependencies,
    kind,
  });
};

export const useConditionalEffect = (
  key: PropertyKey,
  create: () => (() => void) | void,
  dependencies?: readonly unknown[],
): void => {
  registerEffect(key, "effect", create, dependencies);
};

export const useConditionalLayoutEffect = (
  key: PropertyKey,
  create: () => (() => void) | void,
  dependencies?: readonly unknown[],
): void => {
  registerEffect(key, "layout-effect", create, dependencies);
};
