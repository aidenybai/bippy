import { useSyncExternalStore, useCallback, useRef } from 'react';

type Listener = () => void;
type ActionType = string;

interface Action<T = unknown> {
  type: ActionType;
  payload?: T;
  timestamp: number;
}

interface StateSnapshot<S> {
  id: number;
  state: S;
  action: Action | null;
  timestamp: number;
}

interface TimeTravelStore<S> {
  getState: () => S;
  getHistory: () => StateSnapshot<S>[];
  getCurrentIndex: () => number;
  subscribe: (listener: Listener) => () => void;
  dispatch: <T>(type: ActionType, payload?: T) => void;
  goTo: (index: number) => void;
  goBack: () => boolean;
  goForward: () => boolean;
  canGoBack: () => boolean;
  canGoForward: () => boolean;
  reset: () => void;
  jumpToStart: () => void;
  jumpToEnd: () => void;
  getActions: () => Action[];
  replay: (toIndex?: number) => void;
}

interface TimeTravelStoreOptions<S> {
  maxHistory?: number;
  onChange?: (state: S, action: Action | null) => void;
  serialize?: (state: S) => string;
  deserialize?: (serialized: string) => S;
}

const createTimeTravelStore = <S>(
  reducer: (state: S, action: Action) => S,
  initialState: S,
  options: TimeTravelStoreOptions<S> = {},
): TimeTravelStore<S> => {
  const { maxHistory = 100, onChange, serialize, deserialize } = options;

  let state = initialState;
  let history: StateSnapshot<S>[] = [];
  let currentIndex = -1;
  let snapshotId = 0;
  let listeners: Set<Listener> = new Set();
  let isReplaying = false;

  const cloneState = (stateToClone: S): S => {
    if (serialize && deserialize) {
      return deserialize(serialize(stateToClone));
    }
    return JSON.parse(JSON.stringify(stateToClone));
  };

  const addSnapshot = (newState: S, action: Action | null): void => {
    if (currentIndex < history.length - 1) {
      history = history.slice(0, currentIndex + 1);
    }

    const snapshot: StateSnapshot<S> = {
      id: snapshotId++,
      state: cloneState(newState),
      action,
      timestamp: Date.now(),
    };

    history.push(snapshot);
    currentIndex = history.length - 1;

    if (history.length > maxHistory) {
      history.shift();
      currentIndex--;
    }
  };

  addSnapshot(initialState, null);

  const notify = (): void => {
    listeners.forEach((listener) => listener());
  };

  const store: TimeTravelStore<S> = {
    getState: () => state,

    getHistory: () => [...history],

    getCurrentIndex: () => currentIndex,

    subscribe: (listener: Listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    dispatch: <T>(type: ActionType, payload?: T) => {
      if (isReplaying) return;

      const action: Action<T> = {
        type,
        payload,
        timestamp: Date.now(),
      };

      const newState = reducer(state, action);
      state = newState;

      addSnapshot(newState, action);
      onChange?.(newState, action);
      notify();
    },

    goTo: (index: number) => {
      if (index < 0 || index >= history.length) return;

      currentIndex = index;
      state = cloneState(history[index].state);
      onChange?.(state, null);
      notify();
    },

    goBack: () => {
      if (currentIndex > 0) {
        store.goTo(currentIndex - 1);
        return true;
      }
      return false;
    },

    goForward: () => {
      if (currentIndex < history.length - 1) {
        store.goTo(currentIndex + 1);
        return true;
      }
      return false;
    },

    canGoBack: () => currentIndex > 0,

    canGoForward: () => currentIndex < history.length - 1,

    reset: () => {
      state = initialState;
      history = [];
      currentIndex = -1;
      snapshotId = 0;
      addSnapshot(initialState, null);
      notify();
    },

    jumpToStart: () => {
      if (history.length > 0) {
        store.goTo(0);
      }
    },

    jumpToEnd: () => {
      if (history.length > 0) {
        store.goTo(history.length - 1);
      }
    },

    getActions: () => {
      return history
        .filter((snapshot) => snapshot.action !== null)
        .map((snapshot) => snapshot.action as Action);
    },

    replay: (toIndex?: number) => {
      isReplaying = true;

      const targetIndex = toIndex ?? history.length - 1;
      const actionsToReplay = history
        .slice(0, targetIndex + 1)
        .filter((snapshot) => snapshot.action !== null)
        .map((snapshot) => snapshot.action as Action);

      state = initialState;
      history = [];
      currentIndex = -1;
      snapshotId = 0;
      addSnapshot(initialState, null);

      for (const action of actionsToReplay) {
        state = reducer(state, action);
        addSnapshot(state, action);
      }

      isReplaying = false;
      onChange?.(state, null);
      notify();
    },
  };

  return store;
};

const useTimeTravelStore = <S, R>(
  store: TimeTravelStore<S>,
  selector: (state: S) => R = (s) => s as unknown as R,
): R => {
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.getState()),
    () => selector(store.getState()),
  );
};

const useTimeTravelControls = <S>(store: TimeTravelStore<S>) => {
  const currentIndex = useSyncExternalStore(
    store.subscribe,
    () => store.getCurrentIndex(),
    () => store.getCurrentIndex(),
  );

  const historyLength = useSyncExternalStore(
    store.subscribe,
    () => store.getHistory().length,
    () => store.getHistory().length,
  );

  const canGoBackValue = useSyncExternalStore(
    store.subscribe,
    () => store.canGoBack(),
    () => store.canGoBack(),
  );

  const canGoForwardValue = useSyncExternalStore(
    store.subscribe,
    () => store.canGoForward(),
    () => store.canGoForward(),
  );

  return {
    get history() {
      return store.getHistory();
    },
    currentIndex,
    historyLength,
    canGoBack: canGoBackValue,
    canGoForward: canGoForwardValue,
    goBack: store.goBack,
    goForward: store.goForward,
    goTo: store.goTo,
    reset: store.reset,
    jumpToStart: store.jumpToStart,
    jumpToEnd: store.jumpToEnd,
    replay: store.replay,
    getActions: store.getActions,
  };
};

interface ActionCreator<P = void> {
  type: string;
  (payload: P): { type: string; payload: P };
}

const createAction = <P = void>(type: string): ActionCreator<P> => {
  const actionCreator = (payload: P) => ({ type, payload });
  actionCreator.type = type;
  return actionCreator;
};

interface ImmerLikeProducer<S> {
  (draft: S): void | S;
}

const createReducer = <S>(
  handlers: Record<string, (state: S, payload: unknown) => S>,
): ((state: S, action: Action) => S) => {
  return (state: S, action: Action): S => {
    const handler = handlers[action.type];
    if (handler) {
      return handler(state, action.payload);
    }
    return state;
  };
};

interface PersistConfig<S> {
  key: string;
  storage?: Storage;
  serialize?: (state: S) => string;
  deserialize?: (serialized: string) => S;
}

const createPersistedStore = <S>(
  reducer: (state: S, action: Action) => S,
  initialState: S,
  persistConfig: PersistConfig<S>,
  options: TimeTravelStoreOptions<S> = {},
): TimeTravelStore<S> => {
  const {
    key,
    storage = typeof localStorage !== 'undefined' ? localStorage : undefined,
    serialize = JSON.stringify,
    deserialize = JSON.parse,
  } = persistConfig;

  let hydratedState = initialState;

  if (storage) {
    try {
      const persisted = storage.getItem(key);
      if (persisted) {
        const parsed = deserialize(persisted);
        hydratedState = parsed.state ?? initialState;
      }
    } catch {
      // HACK: Ignore hydration errors, use initial state
    }
  }

  const store = createTimeTravelStore(reducer, hydratedState, {
    ...options,
    serialize,
    deserialize,
    onChange: (state, action) => {
      options.onChange?.(state, action);

      if (storage) {
        try {
          storage.setItem(
            key,
            serialize({
              state,
              timestamp: Date.now(),
            } as unknown as S),
          );
        } catch {
          // HACK: Ignore storage errors
        }
      }
    },
  });

  return store;
};

interface UseLocalStateOptions<S> {
  maxHistory?: number;
  onStateChange?: (state: S) => void;
}

const useLocalTimeTravel = <S>(
  reducer: (state: S, action: Action) => S,
  initialState: S,
  options: UseLocalStateOptions<S> = {},
) => {
  const storeRef = useRef<TimeTravelStore<S> | null>(null);

  if (!storeRef.current) {
    storeRef.current = createTimeTravelStore(reducer, initialState, {
      maxHistory: options.maxHistory,
      onChange: options.onStateChange,
    });
  }

  const state = useTimeTravelStore(storeRef.current);
  const controls = useTimeTravelControls(storeRef.current);
  const dispatch = useCallback(
    <T>(type: ActionType, payload?: T) => {
      storeRef.current?.dispatch(type, payload);
    },
    [],
  );

  return {
    state,
    dispatch,
    ...controls,
  };
};

interface UndoableState<S> {
  present: S;
  past: S[];
  future: S[];
}

const createUndoable = <S>(
  reducer: (state: S, action: Action) => S,
): ((state: UndoableState<S>, action: Action) => UndoableState<S>) => {
  return (undoableState: UndoableState<S>, action: Action): UndoableState<S> => {
    const { past, present, future } = undoableState;

    switch (action.type) {
      case '@@UNDO': {
        if (past.length === 0) return undoableState;
        const previous = past[past.length - 1];
        const newPast = past.slice(0, -1);
        return {
          past: newPast,
          present: previous,
          future: [present, ...future],
        };
      }

      case '@@REDO': {
        if (future.length === 0) return undoableState;
        const next = future[0];
        const newFuture = future.slice(1);
        return {
          past: [...past, present],
          present: next,
          future: newFuture,
        };
      }

      case '@@JUMP_TO_PAST': {
        const index = action.payload as number;
        if (index < 0 || index >= past.length) return undoableState;
        const newPast = past.slice(0, index);
        const newPresent = past[index];
        const newFuture = [...past.slice(index + 1), present, ...future];
        return {
          past: newPast,
          present: newPresent,
          future: newFuture,
        };
      }

      case '@@JUMP_TO_FUTURE': {
        const index = action.payload as number;
        if (index < 0 || index >= future.length) return undoableState;
        const newFuture = future.slice(index + 1);
        const newPresent = future[index];
        const newPast = [...past, present, ...future.slice(0, index)];
        return {
          past: newPast,
          present: newPresent,
          future: newFuture,
        };
      }

      case '@@CLEAR_HISTORY': {
        return {
          past: [],
          present,
          future: [],
        };
      }

      default: {
        const newPresent = reducer(present, action);
        if (newPresent === present) return undoableState;
        return {
          past: [...past, present],
          present: newPresent,
          future: [],
        };
      }
    }
  };
};

const useUndoable = <S>(
  reducer: (state: S, action: Action) => S,
  initialState: S,
  options: { maxHistory?: number } = {},
) => {
  const undoableReducer = createUndoable(reducer);
  const initialUndoableState: UndoableState<S> = {
    past: [],
    present: initialState,
    future: [],
  };

  const store = useRef<TimeTravelStore<UndoableState<S>> | null>(null);

  if (!store.current) {
    store.current = createTimeTravelStore(undoableReducer, initialUndoableState, {
      maxHistory: options.maxHistory,
    });
  }

  const undoableState = useTimeTravelStore<UndoableState<S>, UndoableState<S>>(store.current);

  const dispatch = useCallback(<T>(type: string, payload?: T) => {
    store.current?.dispatch(type, payload);
  }, []);

  const undo = useCallback(() => {
    store.current?.dispatch('@@UNDO');
  }, []);

  const redo = useCallback(() => {
    store.current?.dispatch('@@REDO');
  }, []);

  const clearHistory = useCallback(() => {
    store.current?.dispatch('@@CLEAR_HISTORY');
  }, []);

  const jumpToPast = useCallback((index: number) => {
    store.current?.dispatch('@@JUMP_TO_PAST', index);
  }, []);

  const jumpToFuture = useCallback((index: number) => {
    store.current?.dispatch('@@JUMP_TO_FUTURE', index);
  }, []);

  return {
    state: undoableState.present,
    past: undoableState.past,
    future: undoableState.future,
    canUndo: undoableState.past.length > 0,
    canRedo: undoableState.future.length > 0,
    dispatch,
    undo,
    redo,
    clearHistory,
    jumpToPast,
    jumpToFuture,
  };
};

interface Middleware<S> {
  (store: TimeTravelStore<S>): (
    next: (action: Action) => void,
  ) => (action: Action) => void;
}

const applyMiddleware = <S>(
  store: TimeTravelStore<S>,
  ...middlewares: Middleware<S>[]
): TimeTravelStore<S> => {
  let dispatch = store.dispatch.bind(store);

  const middlewareAPI = {
    ...store,
    dispatch: (type: string, payload?: unknown) => dispatch(type, payload),
  };

  const chain = middlewares.map((middleware) => middleware(middlewareAPI));

  const baseDispatch = (action: Action) => store.dispatch(action.type, action.payload);
  const composedDispatch = chain.reduceRight(
    (next, middleware) => middleware(next),
    baseDispatch,
  );
  
  dispatch = ((type: string, payload?: unknown) => {
    composedDispatch({ type, payload, timestamp: Date.now() });
  }) as typeof dispatch;

  return {
    ...store,
    dispatch,
  };
};

const loggerMiddleware: Middleware<unknown> =
  (store) => (next) => (action) => {
    console.group(`Action: ${action.type}`);
    console.log('Payload:', action.payload);
    console.log('Previous State:', store.getState());
    next(action);
    console.log('Next State:', store.getState());
    console.groupEnd();
  };

const devToolsMiddleware = <S>(
  name = 'TimeTravelStore',
): Middleware<S> => {
  const devTools =
    typeof window !== 'undefined' &&
    (window as unknown as { __REDUX_DEVTOOLS_EXTENSION__?: { connect: (config: { name: string }) => { init: (state: S) => void; send: (action: Action, state: S) => void } } }).__REDUX_DEVTOOLS_EXTENSION__?.connect({
      name,
    });

  return (store) => {
    if (devTools) {
      devTools.init(store.getState());
    }

    return (next) => (action) => {
      next(action);
      if (devTools) {
        devTools.send(action, store.getState());
      }
    };
  };
};

export {
  createTimeTravelStore,
  useTimeTravelStore,
  useTimeTravelControls,
  createAction,
  createReducer,
  createPersistedStore,
  useLocalTimeTravel,
  createUndoable,
  useUndoable,
  applyMiddleware,
  loggerMiddleware,
  devToolsMiddleware,
};

export type {
  Action,
  StateSnapshot,
  TimeTravelStore,
  TimeTravelStoreOptions,
  ActionCreator,
  ImmerLikeProducer,
  PersistConfig,
  UndoableState,
  Middleware,
};
