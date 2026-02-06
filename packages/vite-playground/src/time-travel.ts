import {
  instrument,
  secure,
  traverseFiber,
  traverseState,
  traverseProps,
  overrideHookState,
  overrideProps,
  getDisplayName,
  isCompositeFiber,
  getFiberId,
  getLatestFiber,
  _fiberRoots,
} from 'bippy';
import type { Fiber, FiberRoot, MemoizedState, Props } from 'bippy';

interface FiberStateSnapshot {
  fiberId: number;
  displayName: string | null;
  hooks: Array<{
    hookIndex: number;
    memoizedState: unknown;
  }>;
  props: Props;
}

interface ApplicationSnapshot {
  id: number;
  timestamp: number;
  fiberSnapshots: Map<number, FiberStateSnapshot>;
  rootFiber: Fiber | null;
}

interface TimeTravelOptions {
  maxHistoryLength?: number;
  captureInterval?: number;
  onSnapshotCapture?: (snapshot: ApplicationSnapshot) => void;
  onTimeTravel?: (snapshot: ApplicationSnapshot) => void;
  includeFilter?: (fiber: Fiber) => boolean;
}

interface TimeTravelInstance {
  getHistory: () => ApplicationSnapshot[];
  getCurrentIndex: () => number;
  goToSnapshot: (index: number) => boolean;
  goBack: () => boolean;
  goForward: () => boolean;
  canGoBack: () => boolean;
  canGoForward: () => boolean;
  captureSnapshot: () => ApplicationSnapshot | null;
  clearHistory: () => void;
  pause: () => void;
  resume: () => void;
  isPaused: () => boolean;
  destroy: () => void;
}

const deepClone = <T>(value: T): T => {
  if (value === null || typeof value !== 'object') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => deepClone(item)) as T;
  }

  if (value instanceof Map) {
    const clonedMap = new Map();
    value.forEach((mapValue, mapKey) => {
      clonedMap.set(deepClone(mapKey), deepClone(mapValue));
    });
    return clonedMap as T;
  }

  if (value instanceof Set) {
    const clonedSet = new Set();
    value.forEach((setValue) => {
      clonedSet.add(deepClone(setValue));
    });
    return clonedSet as T;
  }

  if (value instanceof Date) {
    return new Date(value.getTime()) as T;
  }

  if (value instanceof RegExp) {
    return new RegExp(value.source, value.flags) as T;
  }

  if (typeof value === 'function') {
    return value;
  }

  const clonedObject: Record<string, unknown> = {};
  for (const key in value) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      clonedObject[key] = deepClone((value as Record<string, unknown>)[key]);
    }
  }
  return clonedObject as T;
};

const isSerializableState = (state: unknown): boolean => {
  if (state === null || state === undefined) return true;
  if (typeof state === 'function') return false;
  if (typeof state === 'symbol') return false;

  if (typeof state === 'object') {
    if (state instanceof Promise) return false;
    if (state instanceof WeakMap) return false;
    if (state instanceof WeakSet) return false;
  }

  return true;
};

const extractHooksFromFiber = (
  fiber: Fiber,
): Array<{ hookIndex: number; memoizedState: unknown }> => {
  const hooks: Array<{ hookIndex: number; memoizedState: unknown }> = [];
  let hookIndex = 0;

  traverseState(fiber, (currentState: MemoizedState | null | undefined) => {
    if (currentState && 'memoizedState' in currentState) {
      const stateValue = currentState.memoizedState;
      if (isSerializableState(stateValue)) {
        hooks.push({
          hookIndex,
          memoizedState: deepClone(stateValue),
        });
      }
    }
    hookIndex++;
  });

  return hooks;
};

const extractPropsFromFiber = (fiber: Fiber): Props => {
  const props: Props = {};

  traverseProps(fiber, (propName, nextValue) => {
    if (propName !== 'children' && isSerializableState(nextValue)) {
      props[propName] = deepClone(nextValue);
    }
  });

  return props;
};

const captureFiberSnapshot = (
  fiber: Fiber,
  includeFilter?: (fiber: Fiber) => boolean,
): FiberStateSnapshot | null => {
  if (!isCompositeFiber(fiber)) {
    return null;
  }

  if (includeFilter && !includeFilter(fiber)) {
    return null;
  }

  const fiberId = getFiberId(fiber);
  const displayName = getDisplayName(fiber.type);
  const hooks = extractHooksFromFiber(fiber);
  const props = extractPropsFromFiber(fiber);

  return {
    fiberId,
    displayName,
    hooks,
    props,
  };
};

const captureAllFiberSnapshots = (
  rootFiber: Fiber,
  includeFilter?: (fiber: Fiber) => boolean,
): Map<number, FiberStateSnapshot> => {
  const snapshots = new Map<number, FiberStateSnapshot>();

  traverseFiber(rootFiber, (fiber) => {
    const snapshot = captureFiberSnapshot(fiber, includeFilter);
    if (snapshot) {
      snapshots.set(snapshot.fiberId, snapshot);
    }
  });

  return snapshots;
};

const findFiberById = (rootFiber: Fiber, targetId: number): Fiber | null => {
  let foundFiber: Fiber | null = null;

  traverseFiber(rootFiber, (fiber) => {
    if (getFiberId(fiber) === targetId) {
      foundFiber = fiber;
      return true;
    }
  });

  return foundFiber;
};

const restoreFiberState = (
  fiber: Fiber,
  snapshot: FiberStateSnapshot,
): void => {
  const latestFiber = getLatestFiber(fiber);

  for (const hookSnapshot of snapshot.hooks) {
    try {
      overrideHookState(
        latestFiber,
        hookSnapshot.hookIndex,
        deepClone(hookSnapshot.memoizedState) as Record<string, unknown>,
      );
    } catch {
      // HACK: Some hooks may not be overridable (e.g., effects), silently ignore
    }
  }

  for (const [propName, propValue] of Object.entries(snapshot.props)) {
    try {
      overrideProps(latestFiber, { [propName]: deepClone(propValue) });
    } catch {
      // HACK: Some props may not be overridable, silently ignore
    }
  }
};

export const createTimeTravel = (
  options: TimeTravelOptions = {},
): TimeTravelInstance => {
  const {
    maxHistoryLength = 100,
    captureInterval = 0,
    onSnapshotCapture,
    onTimeTravel,
    includeFilter,
  } = options;

  const history: ApplicationSnapshot[] = [];
  let currentIndex = -1;
  let snapshotIdCounter = 0;
  let isPausedState = false;
  let lastCaptureTime = 0;
  let isRestoring = false;
  let isDestroyed = false;

  const captureSnapshot = (): ApplicationSnapshot | null => {
    if (isDestroyed || _fiberRoots.size === 0) {
      return null;
    }

    const rootFiber = Array.from(_fiberRoots)[0]?.current;
    if (!rootFiber) {
      return null;
    }

    const fiberSnapshots = captureAllFiberSnapshots(rootFiber, includeFilter);

    const snapshot: ApplicationSnapshot = {
      id: snapshotIdCounter++,
      timestamp: Date.now(),
      fiberSnapshots,
      rootFiber,
    };

    return snapshot;
  };

  const addSnapshotToHistory = (snapshot: ApplicationSnapshot): void => {
    if (currentIndex < history.length - 1) {
      history.splice(currentIndex + 1);
    }

    history.push(snapshot);
    currentIndex = history.length - 1;

    if (history.length > maxHistoryLength) {
      history.shift();
      currentIndex--;
    }

    onSnapshotCapture?.(snapshot);
  };

  const goToSnapshot = (index: number): boolean => {
    if (isDestroyed || index < 0 || index >= history.length) {
      return false;
    }

    const snapshot = history[index];
    if (!snapshot || _fiberRoots.size === 0) {
      return false;
    }

    isRestoring = true;

    try {
      const rootFiber = Array.from(_fiberRoots)[0]?.current;
      if (!rootFiber) {
        return false;
      }

      for (const [fiberId, fiberSnapshot] of snapshot.fiberSnapshots) {
        const currentFiber = findFiberById(rootFiber, fiberId);
        if (currentFiber) {
          restoreFiberState(currentFiber, fiberSnapshot);
        }
      }

      currentIndex = index;
      onTimeTravel?.(snapshot);
      return true;
    } finally {
      isRestoring = false;
    }
  };

  const handleCommit = (_rendererID: number, _root: FiberRoot): void => {
    if (isPausedState || isRestoring || isDestroyed) {
      return;
    }

    const now = Date.now();
    if (captureInterval > 0 && now - lastCaptureTime < captureInterval) {
      return;
    }
    lastCaptureTime = now;

    const snapshot = captureSnapshot();
    if (snapshot) {
      addSnapshotToHistory(snapshot);
    }
  };

  instrument(
    secure(
      {
        onCommitFiberRoot: handleCommit,
      },
      { dangerouslyRunInProduction: true },
    ),
  );

  return {
    getHistory: () => [...history],

    getCurrentIndex: () => currentIndex,

    goToSnapshot,

    goBack: () => {
      if (currentIndex > 0) {
        return goToSnapshot(currentIndex - 1);
      }
      return false;
    },

    goForward: () => {
      if (currentIndex < history.length - 1) {
        return goToSnapshot(currentIndex + 1);
      }
      return false;
    },

    canGoBack: () => currentIndex > 0,

    canGoForward: () => currentIndex < history.length - 1,

    captureSnapshot: () => {
      const snapshot = captureSnapshot();
      if (snapshot && !isPausedState) {
        addSnapshotToHistory(snapshot);
      }
      return snapshot;
    },

    clearHistory: () => {
      history.length = 0;
      currentIndex = -1;
    },

    pause: () => {
      isPausedState = true;
    },

    resume: () => {
      isPausedState = false;
    },

    isPaused: () => isPausedState,

    destroy: () => {
      isDestroyed = true;
      history.length = 0;
      currentIndex = -1;
    },
  };
};

export const createComponentTimeTravel = (
  componentName: string,
  options: Omit<TimeTravelOptions, 'includeFilter'> = {},
): TimeTravelInstance => {
  return createTimeTravel({
    ...options,
    includeFilter: (fiber) => getDisplayName(fiber.type) === componentName,
  });
};

export interface StateHistoryEntry<T = unknown> {
  timestamp: number;
  state: T;
  fiber: Fiber;
}

export interface StateWatcher<T = unknown> {
  getHistory: () => StateHistoryEntry<T>[];
  getCurrent: () => T | undefined;
  goTo: (index: number) => boolean;
  destroy: () => void;
}

export const watchComponentState = <T = unknown>(
  componentName: string,
  hookIndex = 0,
): StateWatcher<T> => {
  const stateHistory: StateHistoryEntry<T>[] = [];
  let isDestroyed = false;
  let currentFiber: Fiber | null = null;

  instrument(
    secure(
      {
        onCommitFiberRoot: (_rendererID, fiberRoot) => {
          if (isDestroyed) return;

          const rootFiber = fiberRoot.current;
          traverseFiber(rootFiber, (fiber) => {
            if (
              isCompositeFiber(fiber) &&
              getDisplayName(fiber.type) === componentName
            ) {
              currentFiber = fiber;
              let currentHookIndex = 0;

              traverseState(fiber, (currentState) => {
                if (currentHookIndex === hookIndex && currentState) {
                  const stateValue = currentState.memoizedState as T;
                  if (isSerializableState(stateValue)) {
                    stateHistory.push({
                      timestamp: Date.now(),
                      state: deepClone(stateValue),
                      fiber,
                    });
                  }
                }
                currentHookIndex++;
              });
              return true;
            }
          });
        },
      },
      { dangerouslyRunInProduction: true },
    ),
  );

  return {
    getHistory: () => [...stateHistory],

    getCurrent: () => {
      if (stateHistory.length === 0) return undefined;
      return stateHistory[stateHistory.length - 1].state;
    },

    goTo: (index: number) => {
      if (index < 0 || index >= stateHistory.length || !currentFiber) {
        return false;
      }

      const entry = stateHistory[index];
      const latestFiber = getLatestFiber(currentFiber);

      try {
        overrideHookState(
          latestFiber,
          hookIndex,
          deepClone(entry.state) as Record<string, unknown>,
        );
        return true;
      } catch {
        return false;
      }
    },

    destroy: () => {
      isDestroyed = true;
      stateHistory.length = 0;
      currentFiber = null;
    },
  };
};

export type { ApplicationSnapshot, FiberStateSnapshot, TimeTravelOptions, TimeTravelInstance };
