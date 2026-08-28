import type * as React from "react";
import {
  InsertionHookEffect,
  LayoutHookEffect,
  NoHookEffect,
  PassiveHookEffect,
  REACT_CONSUMER_TYPE,
  REACT_CONTEXT_TYPE,
  REACT_MEMO_CACHE_SENTINEL,
  REACT_SUSPENSE_TYPE,
  currentHostConfig,
  setReactDispatcher,
} from "./constants.js";
import {
  scheduleUpdateOnFiber,
  startTransition,
  suspendedPromises,
} from "./scheduler.js";
import type {
  ReconcilerEffect,
  ReconcilerFiber,
  ReconcilerHook,
  ReconcilerHookQueue,
  ReconcilerHookUpdate,
} from "./types.js";

interface ClassComponentInstance {
  props: Record<string, unknown>;
  state: Record<string, unknown>;
  render(): unknown;
  forceUpdate(callback?: () => void): void;
  setState(state: unknown, callback?: () => void): void;
  componentDidCatch?(error: Error, errorInfo: React.ErrorInfo): void;
}

interface ClassComponentType {
  new (props: Record<string, unknown>): ClassComponentInstance;
  prototype: { isReactComponent?: unknown };
  getDerivedStateFromError?: (error: unknown) => Record<string, unknown> | null;
}

interface ContextWithValue<T> {
  _currentValue: T;
  _context?: ContextWithValue<T>;
}

interface Thenable<T> extends Promise<T> {
  status?: "pending" | "fulfilled" | "rejected";
  value?: T;
  reason?: unknown;
}

interface UsableContext<T> {
  $$typeof: symbol;
  _currentValue: T;
}

let isMounted = false;
let currentlyRenderingFiber: ReconcilerFiber | null = null;
let workInProgressHook: ReconcilerHook | null = null;
let currentHook: ReconcilerHook | null = null;
let effectListIndex = 0;

const areDepsChanged = (
  prevDeps: React.DependencyList | null | undefined,
  nextDeps: React.DependencyList | null | undefined,
): boolean => {
  if (!prevDeps || !nextDeps) return true;
  return (
    prevDeps.length !== nextDeps.length ||
    nextDeps.some((dep, depIndex) => !Object.is(dep, prevDeps[depIndex]))
  );
};

const getWorkInProgressHook = (): ReconcilerHook => {
  const hook: ReconcilerHook = {
    memoizedState: null,
    queue: null,
    next: null,
  };

  if (isMounted) {
    currentHook =
      currentHook?.next ??
      currentHook ??
      (currentlyRenderingFiber!.alternate!.memoizedState as ReconcilerHook);

    if (currentHook) {
      hook.memoizedState = currentHook.memoizedState;
      hook.queue = currentHook.queue;
    }
  }

  if (workInProgressHook === null) {
    currentlyRenderingFiber!.memoizedState = workInProgressHook = hook;
  } else {
    workInProgressHook = workInProgressHook.next = hook;
  }

  return workInProgressHook;
};

const effectImpl = (
  tag: number,
  create: () => void | (() => void),
  deps: React.DependencyList | null = null,
): void => {
  if (isMounted) {
    const effect = currentlyRenderingFiber!.effects![effectListIndex++];
    effect.tag = areDepsChanged(deps, effect.deps) ? tag : NoHookEffect;
    effect.create = create;
    effect.deps = deps;
  } else {
    const effect: ReconcilerEffect = {
      tag,
      create,
      destroy: undefined,
      deps,
    };

    currentlyRenderingFiber!.effects ??= [];
    currentlyRenderingFiber!.effects[effectListIndex++] = effect;
  }
};

const readContext = <T>(context: React.Context<T>): T => {
  let contextFiber = currentlyRenderingFiber!.return;
  while (contextFiber !== null && contextFiber.pendingProps._context !== context) {
    contextFiber = contextFiber.return;
  }

  return contextFiber !== null
    ? (contextFiber.pendingProps.value as T)
    : (context as unknown as ContextWithValue<T>)._currentValue;
};

const useContext = <T>(context: React.Context<T>): T => readContext(context);

const dispatchAction = (
  dispatchFiber: ReconcilerFiber,
  queue: ReconcilerHookQueue,
  action: unknown,
): void => {
  const update: ReconcilerHookUpdate = { action, next: null };
  const pendingUpdate = queue.pending;
  if (pendingUpdate === null) {
    update.next = update;
  } else {
    update.next = pendingUpdate.next;
    pendingUpdate.next = update;
  }
  queue.pending = update;
  const lastRenderedReducer = queue.lastRenderedReducer;
  const lastRenderedState = queue.lastRenderedState;

  const eagerState = lastRenderedReducer(lastRenderedState, action);
  update.eagerReducer = lastRenderedReducer;
  update.eagerState = eagerState;
  if (Object.is(eagerState, lastRenderedState)) return;
  scheduleUpdateOnFiber(dispatchFiber);
};

const useReducer = (
  reducer: React.Reducer<unknown, unknown>,
  initialArg: unknown,
  initializer?: (arg: unknown) => unknown,
): [unknown, React.Dispatch<unknown>] => {
  const hook = getWorkInProgressHook();
  let queue = hook.queue;
  const current = currentHook;
  const pendingQueue = queue?.pending;

  if (!isMounted || queue === null) {
    hook.memoizedState = typeof initializer === "function" ? initializer(initialArg) : initialArg;
    queue = hook.queue = {
      pending: null,
      lastRenderedReducer: reducer,
      lastRenderedState: hook.memoizedState,
    };
  } else if (pendingQueue) {
    const firstUpdate = pendingQueue.next;
    let newState = current!.memoizedState;
    let update = firstUpdate;
    do {
      newState = reducer(newState, update!.action);
      update = update!.next;
    } while (update !== null && update !== firstUpdate);
    queue.pending = null;
    hook.memoizedState = newState;
    queue.lastRenderedState = newState;
  }

  queue.lastRenderedReducer = reducer;
  const dispatch = dispatchAction.bind(null, currentlyRenderingFiber!, queue);
  return [queue.lastRenderedState, dispatch];
};

const basicStateReducer = (state: unknown, action: unknown): unknown =>
  typeof action === "function" ? action(state) : action;

const useState = (
  initialState?: unknown,
): [unknown, React.Dispatch<unknown>] =>
  useReducer(basicStateReducer, initialState, (state) =>
    typeof state === "function" ? state() : state,
  );

interface MemoRecord {
  result: unknown;
  deps: React.DependencyList | undefined;
}

const useMemo = (factory: () => unknown, deps?: React.DependencyList): unknown => {
  const hook = getWorkInProgressHook();
  const memoRecord = hook.memoizedState as MemoRecord | null;

  if (!isMounted || memoRecord === null) {
    hook.memoizedState = { result: factory(), deps } satisfies MemoRecord;
  } else if (areDepsChanged(memoRecord.deps, deps)) {
    memoRecord.result = factory();
    memoRecord.deps = deps;
  }

  return (hook.memoizedState as MemoRecord).result;
};

const useCallback = (callback: unknown, deps?: React.DependencyList): unknown =>
  useMemo(() => callback, deps);

const useRef = (initialValue?: unknown): React.MutableRefObject<unknown> =>
  useMemo(() => ({ current: initialValue }), []) as React.MutableRefObject<unknown>;

const useEffect = (effect: React.EffectCallback, deps?: React.DependencyList): void =>
  effectImpl(PassiveHookEffect, effect, deps ?? null);

const useLayoutEffect = (effect: React.EffectCallback, deps?: React.DependencyList): void =>
  effectImpl(LayoutHookEffect, effect, deps ?? null);

const useInsertionEffect = (effect: React.EffectCallback, deps?: React.DependencyList): void =>
  effectImpl(InsertionHookEffect, effect, deps ?? null);

const useImperativeHandle = (
  ref: React.Ref<unknown> | undefined,
  create: () => unknown,
  deps?: React.DependencyList,
): void =>
  useLayoutEffect(() => {
    if (typeof ref === "function") {
      ref(create());
      return () => {
        ref(null);
      };
    }
    if (ref) {
      const mutableRef = ref as React.MutableRefObject<unknown>;
      mutableRef.current = create();
      return () => {
        mutableRef.current = null;
      };
    }
  }, deps);

const useDebugValue = (): void => {};

const useDeferredValue = (value: unknown): unknown => {
  const [deferredValue, setDeferredValue] = useState(value);

  useEffect(() => startTransition(() => setDeferredValue(value)), [value]);

  return deferredValue;
};

let idCounter = 0;
const useId = (): string => useMemo(() => `:b${idCounter++}:`, []) as string;

interface ExternalStoreRecord {
  value: unknown;
  getSnapshot: () => unknown;
}

const useSyncExternalStore = (
  subscribe: (onStoreChange: () => void) => () => void,
  getSnapshot: () => unknown,
): unknown => {
  const value = getSnapshot();
  const [storeRecord, forceStoreUpdate] = useState(
    () => ({ value, getSnapshot }) satisfies ExternalStoreRecord,
  );
  const record = storeRecord as ExternalStoreRecord;

  const checkForUpdates = useCallback(() => {
    if (!Object.is(record.value, record.getSnapshot())) {
      forceStoreUpdate({ ...record });
    }
  }, []) as () => void;

  useLayoutEffect(() => {
    record.value = value;
    record.getSnapshot = getSnapshot;

    checkForUpdates();
  }, [subscribe, value, getSnapshot]);

  useEffect(() => {
    checkForUpdates();
    return subscribe(checkForUpdates);
  }, [subscribe]);

  return value;
};

const useTransition = (): [boolean, React.TransitionStartFunction] => {
  const [isPending, setIsPending] = useState(false);
  const startHookTransition = useCallback((callback: () => void): void => {
    setIsPending(true);
    startTransition(() => {
      callback();
      setIsPending(false);
    });
  }, []) as React.TransitionStartFunction;
  return [isPending as boolean, startHookTransition];
};

const use = (usable: unknown): unknown => {
  if (typeof usable === "object" && usable !== null) {
    if (typeof (usable as Thenable<unknown>).then === "function") {
      const thenable = usable as Thenable<unknown>;
      if (thenable.status === "fulfilled") return thenable.value;
      if (thenable.status === "rejected") throw thenable.reason;
      thenable.then(
        (resolvedValue) => {
          thenable.status = "fulfilled";
          thenable.value = resolvedValue;
        },
        (reason) => {
          thenable.status = "rejected";
          thenable.reason = reason;
        },
      );
      throw thenable;
    }
    if ((usable as UsableContext<unknown>).$$typeof === REACT_CONTEXT_TYPE) {
      return readContext(usable as unknown as React.Context<unknown>);
    }
  }
  throw new Error("An unsupported type was passed to use()");
};

const useOptimistic = (
  passthrough: unknown,
  reducer?: (state: unknown, action: unknown) => unknown,
): [unknown, (action: unknown) => void] => {
  const [optimisticState, setOptimisticState] = useState(passthrough);
  const previousPassthroughRef = useRef(passthrough);
  if (!Object.is(previousPassthroughRef.current, passthrough)) {
    previousPassthroughRef.current = passthrough;
    setOptimisticState(passthrough);
  }
  const addOptimistic = useCallback((action: unknown) => {
    setOptimisticState((pendingState: unknown) =>
      reducer ? reducer(pendingState, action) : action,
    );
  }, []) as (action: unknown) => void;
  return [optimisticState, addOptimistic];
};

const useActionState = (
  action: (state: unknown, payload: unknown) => unknown,
  initialState: unknown,
): [unknown, (payload: unknown) => void, boolean] => {
  const [state, setState] = useState(initialState);
  const [isPending, setIsPending] = useState(false);
  const dispatch = useCallback((payload: unknown) => {
    const result = action(state, payload);
    if (isThenable(result)) {
      setIsPending(true);
      result.then((resolvedState) => {
        setState(resolvedState);
        setIsPending(false);
      });
    } else {
      setState(result);
    }
  }, [state]) as (payload: unknown) => void;
  return [state, dispatch, isPending as boolean];
};

const useMemoCache = (size: number): unknown[] =>
  useMemo(() => Array.from({ length: size }, () => REACT_MEMO_CACHE_SENTINEL), []) as unknown[];

const useHostTransitionStatus = (): unknown =>
  currentHostConfig.current?.NotPendingTransition ?? null;

const useCacheRefresh = (): (() => void) => useCallback(() => {}, []) as () => void;

const useEffectEvent = (callback: (...args: unknown[]) => unknown) => {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;
  return useCallback(
    (...args: unknown[]) => (callbackRef.current as typeof callback)(...args),
    [],
  ) as typeof callback;
};

const HookDispatcher = {
  readContext,
  use,
  useActionState,
  useCacheRefresh,
  useCallback,
  useContext,
  useDebugValue,
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useHostTransitionStatus,
  useId,
  useImperativeHandle,
  useInsertionEffect,
  useLayoutEffect,
  useMemo,
  useMemoCache,
  useOptimistic,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
};

const isClassComponentType = (type: unknown): type is ClassComponentType =>
  typeof type === "function" &&
  Boolean((type as ClassComponentType).prototype?.isReactComponent);

const isThenable = (value: unknown): value is Thenable<unknown> =>
  typeof (value as Thenable<unknown> | null)?.then === "function";

interface ConsumerType {
  $$typeof: symbol;
  _context: React.Context<unknown>;
}

export const renderWithHooks = (
  current: ReconcilerFiber | null,
  workInProgress: ReconcilerFiber,
  Component: unknown,
): unknown => {
  currentlyRenderingFiber = workInProgress;
  setReactDispatcher(HookDispatcher);

  isMounted = current !== null;

  let children: unknown = currentlyRenderingFiber.pendingProps.children;
  try {
    if (typeof Component === "function") {
      if (isClassComponentType(Component)) {
        const existingInstance = currentlyRenderingFiber.stateNode as
          | ClassComponentInstance
          | null;
        const instance = existingInstance ?? new Component(currentlyRenderingFiber.pendingProps);

        instance.props = currentlyRenderingFiber.pendingProps;
        instance.state ??= {};

        const fiber = currentlyRenderingFiber;
        instance.forceUpdate = (callback?: () => void) => {
          scheduleUpdateOnFiber(fiber);
          if (callback) startTransition(callback);
        };
        instance.setState = (state: unknown, callback?: () => void) => {
          const newState =
            typeof state === "function" ? state(instance.state, instance.props) : state;
          if (newState) {
            Object.assign(instance.state, newState);
            instance.forceUpdate(callback);
          }
        };
        currentlyRenderingFiber.stateNode ??= instance;

        children = instance.render();
      } else {
        children = Component(currentlyRenderingFiber.pendingProps, currentlyRenderingFiber.ref);
      }
    } else if (
      (Component as ConsumerType | null)?.$$typeof === REACT_CONSUMER_TYPE &&
      typeof children === "function"
    ) {
      children = children(readContext((Component as ConsumerType)._context));
    }
  } catch (thrownValue) {
    if (isThenable(thrownValue)) {
      let suspenseFiber: ReconcilerFiber = currentlyRenderingFiber;
      while (suspenseFiber.return !== null && suspenseFiber.type !== REACT_SUSPENSE_TYPE) {
        suspenseFiber = suspenseFiber.return;
      }
      children = suspenseFiber.pendingProps.fallback;

      suspendedPromises.push(thrownValue);

      const suspendedFiber = suspenseFiber;
      thrownValue.then((resolvedValue) => {
        thrownValue.value = resolvedValue;

        const promiseIndex = suspendedPromises.indexOf(thrownValue);
        if (promiseIndex !== -1) suspendedPromises.splice(promiseIndex, 1);

        scheduleUpdateOnFiber(suspendedFiber);
      });
    } else {
      let boundaryFiber: ReconcilerFiber = currentlyRenderingFiber;
      while (boundaryFiber.return !== null && !isClassComponentType(boundaryFiber.type)) {
        boundaryFiber = boundaryFiber.return;
      }

      const instance = boundaryFiber.stateNode as ClassComponentInstance | null;
      const boundaryType = boundaryFiber.type as ClassComponentType | null;
      const getDerivedStateFromError = boundaryType?.getDerivedStateFromError;
      if (getDerivedStateFromError && instance) {
        instance.setState(getDerivedStateFromError(thrownValue));
      }

      const componentDidCatch = instance?.componentDidCatch?.bind(instance);
      if (componentDidCatch) {
        componentDidCatch(thrownValue as Error, { componentStack: "" });
      } else {
        throw thrownValue;
      }
    }
  }

  currentlyRenderingFiber = null;
  setReactDispatcher(null);
  workInProgressHook = null;
  currentHook = null;
  effectListIndex = 0;

  return children;
};
