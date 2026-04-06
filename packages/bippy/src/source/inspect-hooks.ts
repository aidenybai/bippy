import type { Fiber, ContextDependency, MemoizedState, ReactContext } from "../types.js";
import { parseStack, type StackFrame } from "./parse-stack.js";
import { getRDTHook, _renderers } from "../rdt-hook.js";

const REACT_CONTEXT_TYPE = Symbol.for("react.context");
const REACT_MEMO_CACHE_SENTINEL = Symbol.for("react.memo_cache_sentinel");

const FUNCTION_COMPONENT_TAG = 0;
const CONTEXT_PROVIDER_TAG = 10;
const FORWARD_REF_TAG = 11;
const SIMPLE_MEMO_COMPONENT_TAG = 15;

export interface HookSource {
  lineNumber: number | null;
  columnNumber: number | null;
  fileName: string | null;
  functionName: string | null;
}

export interface HooksNode {
  id: number | null;
  isStateEditable: boolean;
  name: string;
  value: unknown;
  subHooks: HooksNode[];
  hookSource: HookSource | null;
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface HooksTree extends Array<HooksNode> {}

interface HookLogEntry {
  displayName: string | null;
  primitive: string;
  stackError: Error;
  value: unknown;
  dispatcherHookName: string;
}

interface DispatcherRefContainer {
  H?: unknown;
  current?: unknown;
  [key: string]: unknown;
}

let hookLog: HookLogEntry[] = [];
let primitiveStackCache: Map<string, StackFrame[]> | null = null;
let currentFiber: Fiber | null = null;
let currentHook: MemoizedState | null = null;
let currentContextDependency: ContextDependency<unknown> | null = null;
let currentThenableIndex = 0;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let currentThenableState: any[] | null = null;

const SuspenseException: unknown = new Error(
  "Suspense Exception: This is not a real error! It's an implementation detail of `use` to interrupt the current render.",
);

const parseErrorStack = (error: Error): StackFrame[] =>
  parseStack(error.stack || "", { includeInElement: false });

const nextHook = (): MemoizedState | null => {
  const hook = currentHook;
  if (hook !== null) currentHook = hook.next;
  return hook;
};

const readContext = <T>(context: ReactContext<T>): T => {
  if (currentFiber === null) return context._currentValue;
  if (currentContextDependency === null) {
    throw new Error("Context reads do not line up with context dependencies.");
  }
  if (Object.prototype.hasOwnProperty.call(currentContextDependency, "memoizedValue")) {
    const value = currentContextDependency.memoizedValue as T;
    currentContextDependency = currentContextDependency.next;
    return value;
  }
  return context._currentValue;
};

const getDispatcherRef = (): DispatcherRefContainer | null => {
  const rdtHook = getRDTHook();
  const allRenderers = [..._renderers, ...rdtHook.renderers.values()];
  for (const renderer of allRenderers) {
    const ref = renderer.currentDispatcherRef;
    if (ref && typeof ref === "object") return ref as DispatcherRefContainer;
  }
  return null;
};

const getDispatcherFromRef = (ref: DispatcherRefContainer): unknown =>
  "H" in ref ? ref.H : ref.current;

const setDispatcherOnRef = (ref: DispatcherRefContainer, dispatcher: unknown): void => {
  if ("H" in ref) {
    ref.H = dispatcher;
  } else {
    ref.current = dispatcher;
  }
};

const pushHookLogEntry = (
  primitive: string,
  value: unknown,
  dispatcherHookName: string,
  displayName: string | null = null,
): void => {
  hookLog.push({
    displayName,
    primitive,
    stackError: new Error(),
    value,
    dispatcherHookName,
  });
};

const dispatcherUse = (usable: unknown): unknown => {
  if (usable !== null && typeof usable === "object") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const asThenable = usable as any;
    if (typeof asThenable.then === "function") {
      const thenable =
        currentThenableState !== null && currentThenableIndex < currentThenableState.length
          ? currentThenableState[currentThenableIndex++]
          : asThenable;

      switch (thenable.status) {
        case "fulfilled": {
          pushHookLogEntry("Promise", thenable.value, "Use");
          return thenable.value;
        }
        case "rejected":
          throw thenable.reason;
      }
      pushHookLogEntry("Unresolved", thenable, "Use");
      throw SuspenseException;
    }
    if (asThenable.$$typeof === REACT_CONTEXT_TYPE && "_currentValue" in asThenable) {
      const context: ReactContext<unknown> = asThenable;
      const value = readContext(context);
      pushHookLogEntry("Context (use)", value, "Use", context.displayName || "Context");
      return value;
    }
  }
  throw new Error("An unsupported type was passed to use(): " + String(usable));
};

const dispatcherUseContext = (context: ReactContext<unknown>): unknown => {
  const value = readContext(context);
  pushHookLogEntry("Context", value, "Context", context.displayName || null);
  return value;
};

const dispatcherUseState = (initialState: unknown): [unknown, () => void] => {
  const hook = nextHook();
  const state =
    hook !== null
      ? hook.memoizedState
      : typeof initialState === "function"
        ? (initialState as () => unknown)()
        : initialState;
  pushHookLogEntry("State", state, "State");
  return [state, () => {}];
};

const dispatcherUseReducer = (
  _reducer: unknown,
  initialArg: unknown,
  init?: (arg: unknown) => unknown,
): [unknown, () => void] => {
  const hook = nextHook();
  const state =
    hook !== null ? hook.memoizedState : init !== undefined ? init(initialArg) : initialArg;
  pushHookLogEntry("Reducer", state, "Reducer");
  return [state, () => {}];
};

const dispatcherUseRef = (initialValue: unknown): { current: unknown } => {
  const hook = nextHook();
  const ref = hook !== null ? hook.memoizedState : { current: initialValue };
  pushHookLogEntry("Ref", (ref as { current: unknown }).current, "Ref");
  return ref as { current: unknown };
};

const dispatcherUseCacheRefresh = (): (() => void) => {
  const hook = nextHook();
  pushHookLogEntry("CacheRefresh", hook !== null ? hook.memoizedState : () => {}, "CacheRefresh");
  return () => {};
};

const dispatcherUseLayoutEffect = (create: () => void): void => {
  nextHook();
  pushHookLogEntry("LayoutEffect", create, "LayoutEffect");
};

const dispatcherUseInsertionEffect = (create: () => unknown): void => {
  nextHook();
  pushHookLogEntry("InsertionEffect", create, "InsertionEffect");
};

const dispatcherUseEffect = (create: () => void): void => {
  nextHook();
  pushHookLogEntry("Effect", create, "Effect");
};

const dispatcherUseImperativeHandle = (ref: unknown): void => {
  nextHook();
  let instance: unknown;
  if (ref !== null && typeof ref === "object" && "current" in ref) {
    instance = ref.current;
  }
  pushHookLogEntry("ImperativeHandle", instance, "ImperativeHandle");
};

const dispatcherUseDebugValue = (
  value: unknown,
  formatterFn?: (value: unknown) => unknown,
): void => {
  pushHookLogEntry(
    "DebugValue",
    typeof formatterFn === "function" ? formatterFn(value) : value,
    "DebugValue",
  );
};

const dispatcherUseCallback = (callback: unknown): unknown => {
  const hook = nextHook();
  pushHookLogEntry(
    "Callback",
    hook !== null ? (hook.memoizedState as unknown[])[0] : callback,
    "Callback",
  );
  return callback;
};

const dispatcherUseMemo = (nextCreate: () => unknown): unknown => {
  const hook = nextHook();
  const value = hook !== null ? (hook.memoizedState as unknown[])[0] : nextCreate();
  pushHookLogEntry("Memo", value, "Memo");
  return value;
};

const dispatcherUseSyncExternalStore = (
  _subscribe: unknown,
  getSnapshot: () => unknown,
): unknown => {
  const hook = nextHook();
  nextHook();
  const value = hook !== null ? hook.memoizedState : getSnapshot();
  pushHookLogEntry("SyncExternalStore", value, "SyncExternalStore");
  return value;
};

const dispatcherUseTransition = (): [boolean, () => void] => {
  const stateHook = nextHook();
  nextHook();
  const isPending = stateHook !== null ? (stateHook.memoizedState as boolean) : false;
  pushHookLogEntry("Transition", isPending, "Transition");
  return [isPending, () => {}];
};

const dispatcherUseDeferredValue = (value: unknown): unknown => {
  const hook = nextHook();
  const previousValue = hook !== null ? hook.memoizedState : value;
  pushHookLogEntry("DeferredValue", previousValue, "DeferredValue");
  return previousValue;
};

const dispatcherUseId = (): string => {
  const hook = nextHook();
  const identifier = hook !== null ? (hook.memoizedState as string) : "";
  pushHookLogEntry("Id", identifier, "Id");
  return identifier;
};

const dispatcherUseMemoCache = (size: number): unknown[] => {
  const fiber = currentFiber;
  if (fiber === null || fiber === undefined) return [];

  const memoCache = (
    fiber.updateQueue as { memoCache?: { data: unknown[][]; index: number } } | null
  )?.memoCache;
  if (memoCache === null || memoCache === undefined) return [];

  let data = memoCache.data[memoCache.index];
  if (data === undefined) {
    data = memoCache.data[memoCache.index] = Array.from(
      { length: size },
      () => REACT_MEMO_CACHE_SENTINEL,
    );
  }

  memoCache.index++;
  return data;
};

const dispatcherUseOptimistic = (passthrough: unknown): [unknown, () => void] => {
  const hook = nextHook();
  const state = hook !== null ? hook.memoizedState : passthrough;
  pushHookLogEntry("Optimistic", state, "Optimistic");
  return [state, () => {}];
};

const inspectActionStateHook = (
  hook: MemoizedState | null,
  initialState: unknown,
): { value: unknown; error: unknown } => {
  let value: unknown;
  let error: unknown = null;
  if (hook !== null) {
    const actionResult = hook.memoizedState;
    if (
      typeof actionResult === "object" &&
      actionResult !== null &&
      "then" in actionResult &&
      typeof actionResult.then === "function"
    ) {
      const thenable = actionResult as { status?: string; value?: unknown; reason?: unknown };
      switch (thenable.status) {
        case "fulfilled":
          value = thenable.value;
          break;
        case "rejected":
          error = thenable.reason;
          break;
        default:
          error = SuspenseException;
          value = thenable;
      }
    } else {
      value = actionResult;
    }
  } else {
    value = initialState;
  }
  return { value, error };
};

const createActionStateDispatcher =
  (primitive: string) =>
  (_action: unknown, initialState: unknown): [unknown, () => void, boolean] => {
    const hook = nextHook();
    nextHook();
    nextHook();
    const stackError = new Error();
    const { value, error } = inspectActionStateHook(hook, initialState);
    hookLog.push({
      displayName: null,
      primitive,
      stackError,
      value,
      dispatcherHookName: primitive,
    });
    if (error !== null) throw error;
    return [value, () => {}, false];
  };

const dispatcherUseActionState = createActionStateDispatcher("ActionState");
const dispatcherUseFormState = createActionStateDispatcher("FormState");

const dispatcherUseHostTransitionStatus = (): unknown => {
  // HACK: creating a minimal fake context because useHostTransitionStatus reads from an internal context not available outside React
  const status = readContext({ _currentValue: null } as unknown as ReactContext<unknown>);
  pushHookLogEntry("HostTransitionStatus", status, "HostTransitionStatus");
  return status;
};

const dispatcherUseEffectEvent = (callback: (...args: unknown[]) => unknown): typeof callback => {
  nextHook();
  pushHookLogEntry("EffectEvent", callback, "EffectEvent");
  return callback;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Dispatcher: Record<string, (...args: any[]) => any> = {
  readContext,
  use: dispatcherUse,
  useCallback: dispatcherUseCallback,
  useContext: dispatcherUseContext,
  useEffect: dispatcherUseEffect,
  useImperativeHandle: dispatcherUseImperativeHandle,
  useLayoutEffect: dispatcherUseLayoutEffect,
  useInsertionEffect: dispatcherUseInsertionEffect,
  useMemo: dispatcherUseMemo,
  useReducer: dispatcherUseReducer,
  useRef: dispatcherUseRef,
  useState: dispatcherUseState,
  useDebugValue: dispatcherUseDebugValue,
  useDeferredValue: dispatcherUseDeferredValue,
  useTransition: dispatcherUseTransition,
  useSyncExternalStore: dispatcherUseSyncExternalStore,
  useId: dispatcherUseId,
  useHostTransitionStatus: dispatcherUseHostTransitionStatus,
  useFormState: dispatcherUseFormState,
  useActionState: dispatcherUseActionState,
  useOptimistic: dispatcherUseOptimistic,
  useMemoCache: dispatcherUseMemoCache,
  useCacheRefresh: dispatcherUseCacheRefresh,
  useEffectEvent: dispatcherUseEffectEvent,
};

const DispatcherProxy =
  typeof Proxy === "undefined"
    ? Dispatcher
    : new Proxy(Dispatcher, {
        get(target, prop: string) {
          if (Object.prototype.hasOwnProperty.call(target, prop)) return target[prop];
          const error = new Error("Missing method in Dispatcher: " + prop);
          error.name = "ReactDebugToolsUnsupportedHookError";
          throw error;
        },
      });

const getPrimitiveStackCache = (): Map<string, StackFrame[]> => {
  if (primitiveStackCache !== null) return primitiveStackCache;

  const cache = new Map<string, StackFrame[]>();
  let capturedHookLog: HookLogEntry[];

  try {
    Dispatcher.useContext({ _currentValue: null });
    Dispatcher.useState(null);
    Dispatcher.useReducer((state: unknown) => state, null);
    Dispatcher.useRef(null);
    if (typeof Dispatcher.useCacheRefresh === "function") Dispatcher.useCacheRefresh();
    Dispatcher.useLayoutEffect(() => {});
    Dispatcher.useInsertionEffect(() => {});
    Dispatcher.useEffect(() => {});
    Dispatcher.useImperativeHandle(undefined, () => null);
    Dispatcher.useDebugValue(null);
    Dispatcher.useCallback(() => {});
    Dispatcher.useTransition();
    Dispatcher.useSyncExternalStore(
      () => () => {},
      () => null,
      () => null,
    );
    Dispatcher.useDeferredValue(null);
    Dispatcher.useMemo(() => null);
    Dispatcher.useOptimistic(null, (state: unknown) => state);
    Dispatcher.useFormState((state: unknown) => state, null);
    Dispatcher.useActionState((state: unknown) => state, null);
    Dispatcher.useHostTransitionStatus();
    if (typeof Dispatcher.useMemoCache === "function") Dispatcher.useMemoCache(0);
    if (typeof Dispatcher.use === "function") {
      Dispatcher.use({ $$typeof: REACT_CONTEXT_TYPE, _currentValue: null });
      Dispatcher.use({ then() {}, status: "fulfilled", value: null });
      try {
        Dispatcher.use({ then() {} });
      } catch {
        /* noop */
      }
    }
    Dispatcher.useId();
    if (typeof Dispatcher.useEffectEvent === "function") Dispatcher.useEffectEvent(() => {});
  } finally {
    capturedHookLog = hookLog;
    hookLog = [];
  }

  for (const hook of capturedHookLog) {
    cache.set(hook.primitive, parseErrorStack(hook.stackError));
  }

  primitiveStackCache = cache;
  return primitiveStackCache;
};

let mostLikelyAncestorIndex = 0;

const findSharedIndex = (
  hookStack: StackFrame[],
  rootStack: StackFrame[],
  rootIndex: number,
): number => {
  const source = rootStack[rootIndex].source;
  hookSearch: for (let hookIndex = 0; hookIndex < hookStack.length; hookIndex++) {
    if (hookStack[hookIndex].source === source) {
      for (
        let rootOffset = rootIndex + 1, hookOffset = hookIndex + 1;
        rootOffset < rootStack.length && hookOffset < hookStack.length;
        rootOffset++, hookOffset++
      ) {
        if (hookStack[hookOffset].source !== rootStack[rootOffset].source) continue hookSearch;
      }
      return hookIndex;
    }
  }
  return -1;
};

const findCommonAncestorIndex = (rootStack: StackFrame[], hookStack: StackFrame[]): number => {
  let rootIndex = findSharedIndex(hookStack, rootStack, mostLikelyAncestorIndex);
  if (rootIndex !== -1) return rootIndex;
  for (
    let candidateIndex = 0;
    candidateIndex < rootStack.length && candidateIndex < 5;
    candidateIndex++
  ) {
    rootIndex = findSharedIndex(hookStack, rootStack, candidateIndex);
    if (rootIndex !== -1) {
      mostLikelyAncestorIndex = candidateIndex;
      return rootIndex;
    }
  }
  return -1;
};

const parseHookName = (functionName: string | undefined): string => {
  if (!functionName) return "";
  let startIndex = functionName.lastIndexOf("[as ");
  if (startIndex !== -1) {
    return parseHookName(functionName.slice(startIndex + "[as ".length, -1));
  }
  startIndex = functionName.lastIndexOf(".");
  startIndex = startIndex === -1 ? 0 : startIndex + 1;
  if (functionName.slice(startIndex).startsWith("unstable_")) startIndex += "unstable_".length;
  if (functionName.slice(startIndex).startsWith("experimental_"))
    startIndex += "experimental_".length;
  if (functionName.slice(startIndex, startIndex + 3) === "use") {
    if (functionName.length - startIndex === 3) return "Use";
    startIndex += 3;
  }
  return functionName.slice(startIndex);
};

const isReactWrapper = (functionName: string | undefined, wrapperName: string): boolean => {
  const hookName = parseHookName(functionName);
  if (wrapperName === "HostTransitionStatus") {
    return hookName === wrapperName || hookName === "FormStatus";
  }
  return hookName === wrapperName;
};

const findPrimitiveIndex = (hookStack: StackFrame[], hook: HookLogEntry): number => {
  const stackCache = getPrimitiveStackCache();
  const primitiveStack = stackCache.get(hook.primitive);
  if (primitiveStack === undefined) return -1;
  for (
    let frameIndex = 0;
    frameIndex < primitiveStack.length && frameIndex < hookStack.length;
    frameIndex++
  ) {
    if (primitiveStack[frameIndex].source !== hookStack[frameIndex].source) {
      if (
        frameIndex < hookStack.length - 1 &&
        isReactWrapper(hookStack[frameIndex].functionName, hook.dispatcherHookName)
      ) {
        frameIndex++;
      }
      if (
        frameIndex < hookStack.length - 1 &&
        isReactWrapper(hookStack[frameIndex].functionName, hook.dispatcherHookName)
      ) {
        frameIndex++;
      }
      return frameIndex;
    }
  }
  return -1;
};

const parseTrimmedStack = (
  rootStack: StackFrame[],
  hook: HookLogEntry,
): [StackFrame | null, StackFrame[] | null] => {
  const hookStack = parseErrorStack(hook.stackError);
  const rootIndex = findCommonAncestorIndex(rootStack, hookStack);
  const primitiveIndex = findPrimitiveIndex(hookStack, hook);
  if (rootIndex === -1 || primitiveIndex === -1 || rootIndex - primitiveIndex < 2) {
    if (primitiveIndex === -1) return [null, null];
    return [hookStack[primitiveIndex - 1] ?? null, null];
  }
  return [hookStack[primitiveIndex - 1] ?? null, hookStack.slice(primitiveIndex, rootIndex - 1)];
};

const NON_ID_HOOK_PRIMITIVES = new Set([
  "Context",
  "Context (use)",
  "DebugValue",
  "Promise",
  "Unresolved",
  "HostTransitionStatus",
]);

const buildTree = (rootStack: StackFrame[], capturedHookLog: HookLogEntry[]): HooksTree => {
  const rootChildren: HooksNode[] = [];
  let previousStack: StackFrame[] | null = null;
  let levelChildren = rootChildren;
  let nativeHookID = 0;
  const childrenStack: HooksNode[][] = [];

  for (const hook of capturedHookLog) {
    const [primitiveFrame, stack] = parseTrimmedStack(rootStack, hook);
    let displayName = hook.displayName;
    if (displayName === null && primitiveFrame !== null) {
      displayName =
        parseHookName(primitiveFrame.functionName) || parseHookName(hook.dispatcherHookName);
    }

    if (stack !== null) {
      let commonSteps = 0;
      if (previousStack !== null) {
        while (commonSteps < stack.length && commonSteps < previousStack.length) {
          const stackSource = stack[stack.length - commonSteps - 1].source;
          const previousSource = previousStack[previousStack.length - commonSteps - 1].source;
          if (stackSource !== previousSource) break;
          commonSteps++;
        }
        for (let popIndex = previousStack.length - 1; popIndex > commonSteps; popIndex--) {
          levelChildren = childrenStack.pop() ?? rootChildren;
        }
      }
      for (let stackIndex = stack.length - commonSteps - 1; stackIndex >= 1; stackIndex--) {
        const children: HooksNode[] = [];
        const stackFrame = stack[stackIndex];
        const levelChild: HooksNode = {
          id: null,
          isStateEditable: false,
          name: parseHookName(stack[stackIndex - 1].functionName),
          value: undefined,
          subHooks: children,
          hookSource: {
            lineNumber: stackFrame.lineNumber ?? null,
            columnNumber: stackFrame.columnNumber ?? null,
            functionName: stackFrame.functionName ?? null,
            fileName: stackFrame.fileName ?? null,
          },
        };
        levelChildren.push(levelChild);
        childrenStack.push(levelChildren);
        levelChildren = children;
      }
      previousStack = stack;
    }

    const { primitive } = hook;
    const id = NON_ID_HOOK_PRIMITIVES.has(primitive) ? null : nativeHookID++;
    const isStateEditable = primitive === "Reducer" || primitive === "State";
    const name = displayName || primitive;

    const firstStackFrame = stack?.[0];
    const hookSource: HookSource = {
      lineNumber: firstStackFrame?.lineNumber ?? null,
      columnNumber: firstStackFrame?.columnNumber ?? null,
      functionName: firstStackFrame?.functionName ?? null,
      fileName: firstStackFrame?.fileName ?? null,
    };

    levelChildren.push({ id, isStateEditable, name, value: hook.value, subHooks: [], hookSource });
  }

  processDebugValues(rootChildren, null);
  return rootChildren;
};

const processDebugValues = (hooksTree: HooksTree, parentHooksNode: HooksNode | null): void => {
  const debugValueNodes: HooksNode[] = [];
  for (let nodeIndex = 0; nodeIndex < hooksTree.length; nodeIndex++) {
    const hooksNode = hooksTree[nodeIndex];
    if (hooksNode.name === "DebugValue" && hooksNode.subHooks.length === 0) {
      hooksTree.splice(nodeIndex, 1);
      nodeIndex--;
      debugValueNodes.push(hooksNode);
    } else {
      processDebugValues(hooksNode.subHooks, hooksNode);
    }
  }
  if (parentHooksNode !== null) {
    if (debugValueNodes.length === 1) {
      parentHooksNode.value = debugValueNodes[0].value;
    } else if (debugValueNodes.length > 1) {
      parentHooksNode.value = debugValueNodes.map(({ value }) => value);
    }
  }
};

const setupContexts = (contextMap: Map<ReactContext<unknown>, unknown>, fiber: Fiber): void => {
  let current: Fiber | null = fiber;
  while (current) {
    if (current.tag === CONTEXT_PROVIDER_TAG) {
      let context = current.type as ReactContext<unknown>;
      if ("_context" in context && context._context !== undefined) {
        context = context._context as ReactContext<unknown>;
      }
      if (!contextMap.has(context)) {
        contextMap.set(context, context._currentValue);
        context._currentValue = (current.memoizedProps as { value: unknown }).value;
      }
    }
    current = current.return;
  }
};

const restoreContexts = (contextMap: Map<ReactContext<unknown>, unknown>): void => {
  contextMap.forEach((value, context) => {
    context._currentValue = value;
  });
};

const handleRenderFunctionError = (error: unknown): void => {
  if (error === SuspenseException) return;
  if (error instanceof Error && error.name === "ReactDebugToolsUnsupportedHookError") throw error;
  const wrapperError = new Error("Error rendering inspected component", { cause: error });
  wrapperError.name = "ReactDebugToolsRenderError";
  (wrapperError as { cause: unknown }).cause = error;
  throw wrapperError;
};

const resolveDefaultProps = (
  Component: unknown,
  baseProps: Record<string, unknown>,
): Record<string, unknown> => {
  if (
    Component &&
    typeof Component === "object" &&
    "defaultProps" in Component &&
    Component.defaultProps
  ) {
    const props = { ...baseProps };
    const defaultProps = Component.defaultProps as Record<string, unknown>;
    for (const propName in defaultProps) {
      if (props[propName] === undefined) {
        props[propName] = defaultProps[propName];
      }
    }
    return props;
  }
  return baseProps;
};

const suppressConsole = (): Record<string, unknown> => {
  const originalMethods: Record<string, unknown> = {};
  for (const method in console) {
    try {
      originalMethods[method] = (console as Record<string, unknown>)[method];
      (console as Record<string, unknown>)[method] = () => {};
    } catch {
      /* noop */
    }
  }
  return originalMethods;
};

const restoreConsole = (originalMethods: Record<string, unknown>): void => {
  for (const method in originalMethods) {
    try {
      (console as Record<string, unknown>)[method] = originalMethods[method];
    } catch {
      /* noop */
    }
  }
};

const performDispatcherInspection = (
  dispatcherRef: DispatcherRefContainer,
  renderFn: () => void,
): HooksTree => {
  const previousDispatcher = getDispatcherFromRef(dispatcherRef);
  setDispatcherOnRef(dispatcherRef, DispatcherProxy);

  let capturedHookLog: HookLogEntry[] = [];
  let ancestorStackError: Error | undefined;

  try {
    ancestorStackError = new Error();
    renderFn();
  } catch (renderError) {
    handleRenderFunctionError(renderError);
  } finally {
    capturedHookLog = hookLog;
    hookLog = [];
    setDispatcherOnRef(dispatcherRef, previousDispatcher);
  }

  const rootStack = ancestorStackError !== undefined ? parseErrorStack(ancestorStackError) : [];
  return buildTree(rootStack, capturedHookLog);
};

const requireDispatcherRef = (): DispatcherRefContainer => {
  const dispatcherRef = getDispatcherRef();
  if (!dispatcherRef) {
    throw new Error(
      "No React renderer found. Make sure React is loaded and bippy's hook is installed.",
    );
  }
  return dispatcherRef;
};

const resolveContextDependency = (fiber: Fiber): void => {
  if (Object.prototype.hasOwnProperty.call(fiber, "dependencies")) {
    const dependencies = fiber.dependencies;
    currentContextDependency = dependencies !== null ? dependencies.firstContext : null;
  } else if (Object.prototype.hasOwnProperty.call(fiber, "dependencies_old")) {
    const dependencies = (fiber as unknown as { dependencies_old: typeof fiber.dependencies })
      .dependencies_old;
    currentContextDependency = dependencies !== null ? dependencies!.firstContext : null;
  } else if (Object.prototype.hasOwnProperty.call(fiber, "dependencies_new")) {
    const dependencies = (fiber as unknown as { dependencies_new: typeof fiber.dependencies })
      .dependencies_new;
    currentContextDependency = dependencies !== null ? dependencies!.firstContext : null;
  } else if (Object.prototype.hasOwnProperty.call(fiber, "contextDependencies")) {
    const contextDependencies = (
      fiber as unknown as {
        contextDependencies: { first: ContextDependency<unknown> | null } | null;
      }
    ).contextDependencies;
    currentContextDependency = contextDependencies !== null ? contextDependencies.first : null;
  } else {
    throw new Error("Unsupported React version.");
  }
};

export const getFiberHooks = (fiber: Fiber): HooksTree => {
  const dispatcherRef = requireDispatcherRef();

  if (
    fiber.tag !== FUNCTION_COMPONENT_TAG &&
    fiber.tag !== SIMPLE_MEMO_COMPONENT_TAG &&
    fiber.tag !== FORWARD_REF_TAG
  ) {
    throw new Error("Unknown Fiber. Needs to be a function component to inspect hooks.");
  }

  getPrimitiveStackCache();

  currentHook = fiber.memoizedState;
  currentFiber = fiber;

  const debugThenableState =
    fiber.dependencies &&
    (fiber.dependencies as { _debugThenableState?: { thenables?: unknown[] } })._debugThenableState;
  const usedThenables = debugThenableState
    ? debugThenableState.thenables || debugThenableState
    : null;
  currentThenableState = Array.isArray(usedThenables) ? usedThenables : null;
  currentThenableIndex = 0;

  resolveContextDependency(fiber);

  const type = fiber.type;
  let props = fiber.memoizedProps as Record<string, unknown>;
  if (type !== fiber.elementType) {
    props = resolveDefaultProps(type, props);
  }

  const originalConsoleMethods = suppressConsole();
  const contextMap = new Map<ReactContext<unknown>, unknown>();

  try {
    if (
      currentContextDependency !== null &&
      !Object.prototype.hasOwnProperty.call(currentContextDependency, "memoizedValue")
    ) {
      setupContexts(contextMap, fiber);
    }

    if (fiber.tag === FORWARD_REF_TAG) {
      return performDispatcherInspection(dispatcherRef, () => {
        (type as { render: (props: Record<string, unknown>, ref: unknown) => unknown }).render(
          props,
          fiber.ref,
        );
      });
    }

    return performDispatcherInspection(dispatcherRef, () => {
      (type as (props: Record<string, unknown>) => unknown)(props);
    });
  } finally {
    currentFiber = null;
    currentHook = null;
    currentContextDependency = null;
    currentThenableState = null;
    currentThenableIndex = 0;
    restoreContexts(contextMap);
    restoreConsole(originalConsoleMethods);
  }
};
