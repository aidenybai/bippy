import {
  ClassComponentTag,
  getDisplayName,
  getFiberId,
  getLatestFiber,
  getRDTHook,
  instrument,
  isCompositeFiber,
  secure,
  traverseFiber,
} from 'bippy';
import type { Fiber, FiberRoot, MemoizedState, ReactRenderer } from 'bippy';

interface DispatchFunction {
  (action: unknown): void;
}

interface ReducerFunction {
  (state: unknown, action: unknown): unknown;
}

interface UpdaterFunction {
  (state: unknown): unknown;
}

interface ValueSnapshot {
  value: unknown;
  isClone: boolean;
}

interface HookStateSnapshot {
  hookIndex: number;
  valueSnapshot: ValueSnapshot;
}

interface HookActionEntry {
  sequence: number;
  action: unknown;
}

interface HookReducer {
  reduce: ReducerFunction;
}

interface HookTimeline {
  hookIndex: number;
  baseSnapshot: ValueSnapshot | null;
  baseSequence: number;
  reducer: HookReducer | null;
  actions: HookActionEntry[];
}

interface FiberSnapshot {
  fiberId: number;
  displayName: string | null;
  hookStates: HookStateSnapshot[];
  classState: ValueSnapshot | null;
}

interface CommitSnapshot {
  commitId: number;
  timestamp: number;
  rendererId: number;
  actionSequence: number;
  fibers: FiberSnapshot[];
}

interface HistoryOptions {
  maxSnapshots?: number;
}

interface HistoryController {
  recordCommit: (rendererId: number, root: FiberRoot) => void;
  recordUnmount: (rendererId: number, fiber: Fiber) => void;
  onPostCommit: () => void;
  rewindBySteps: (rewindSteps: number) => boolean;
  rewindToCommit: (commitId: number) => boolean;
  getSnapshots: () => CommitSnapshot[];
  clearSnapshots: () => void;
  pause: () => void;
  resume: () => void;
}

interface ReplayedStateResult {
  didReplay: boolean;
  value: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isDispatchFunction = (value: unknown): value is DispatchFunction =>
  typeof value === 'function';

const isReducerFunction = (value: unknown): value is ReducerFunction =>
  typeof value === 'function';

const isUpdaterFunction = (value: unknown): value is UpdaterFunction =>
  typeof value === 'function';

const isHookNode = (value: unknown): value is MemoizedState => {
  if (!isRecord(value)) {
    return false;
  }
  return 'memoizedState' in value && 'next' in value;
};

const isClassComponentInstance = (
  value: unknown,
): value is { state: unknown; forceUpdate: () => void } => {
  if (!isRecord(value)) {
    return false;
  }
  const forceUpdateValue = Reflect.get(value, 'forceUpdate');
  return 'state' in value && typeof forceUpdateValue === 'function';
};

const createValueSnapshot = (value: unknown): ValueSnapshot => {
  if (value === null || typeof value !== 'object') {
    return { value, isClone: true };
  }
  const structuredCloneValue = Reflect.get(globalThis, 'structuredClone');
  if (typeof structuredCloneValue === 'function') {
    try {
      return { value: structuredCloneValue(value), isClone: true };
    } catch {}
  }
  try {
    return { value: JSON.parse(JSON.stringify(value)), isClone: true };
  } catch {
    return { value, isClone: false };
  }
};

const getQueueDispatch = (queue: unknown): DispatchFunction | null => {
  if (!isRecord(queue)) {
    return null;
  }
  const dispatchValue = Reflect.get(queue, 'dispatch');
  if (!isDispatchFunction(dispatchValue)) {
    return null;
  }
  return dispatchValue;
};

const basicStateReducer = (state: unknown, action: unknown) => {
  if (isUpdaterFunction(action)) {
    return action(state);
  }
  return action;
};

const getReducerFromQueue = (queue: unknown): HookReducer | null => {
  if (!isRecord(queue)) {
    return null;
  }
  const reducerValue = Reflect.get(queue, 'lastRenderedReducer');
  if (isReducerFunction(reducerValue)) {
    return { reduce: (state, action) => reducerValue(state, action) };
  }
  return { reduce: basicStateReducer };
};

const createHistoryController = (
  options: HistoryOptions = {},
): HistoryController => {
  const maxSnapshots = options.maxSnapshots ?? 30;
  const snapshots: CommitSnapshot[] = [];
  const latestFibersById = new Map<number, Fiber>();
  const hookTimelinesByFiberId = new Map<number, Map<number, HookTimeline>>();
  const rendererById = new Map<number, ReactRenderer>();
  const dispatchWrapperByOriginal = new WeakMap<
    DispatchFunction,
    DispatchFunction
  >();
  const originalDispatchByWrapper = new WeakMap<
    DispatchFunction,
    DispatchFunction
  >();
  let actionSequence = 0;
  let commitCounter = 0;
  let isRecordingEnabled = true;
  let isRewindPending = false;

  const nextActionSequence = () => {
    actionSequence += 1;
    return actionSequence;
  };

  const getRenderer = (rendererId: number): ReactRenderer | null => {
    const cachedRenderer = rendererById.get(rendererId);
    if (cachedRenderer) {
      return cachedRenderer;
    }
    const rdtHook = getRDTHook();
    const renderer = rdtHook.renderers.get(rendererId) ?? null;
    if (renderer) {
      rendererById.set(rendererId, renderer);
    }
    return renderer;
  };

  const getHookTimeline = (
    fiberId: number,
    hookIndex: number,
  ): HookTimeline => {
    let hookTimelineMap = hookTimelinesByFiberId.get(fiberId);
    if (!hookTimelineMap) {
      hookTimelineMap = new Map();
      hookTimelinesByFiberId.set(fiberId, hookTimelineMap);
    }
    let hookTimeline = hookTimelineMap.get(hookIndex);
    if (!hookTimeline) {
      hookTimeline = {
        hookIndex,
        baseSnapshot: null,
        baseSequence: 0,
        reducer: null,
        actions: [],
      };
      hookTimelineMap.set(hookIndex, hookTimeline);
    }
    return hookTimeline;
  };

  const recordAction = (hookTimeline: HookTimeline, action: unknown) => {
    const sequence = nextActionSequence();
    hookTimeline.actions.push({ sequence, action });
  };

  const wrapDispatch = (queue: unknown, hookTimeline: HookTimeline) => {
    if (!isRecord(queue)) {
      return;
    }
    const dispatchValue = getQueueDispatch(queue);
    if (!dispatchValue) {
      return;
    }
    if (originalDispatchByWrapper.has(dispatchValue)) {
      return;
    }
    const existingWrapper = dispatchWrapperByOriginal.get(dispatchValue);
    if (existingWrapper) {
      if (existingWrapper !== dispatchValue) {
        Reflect.set(queue, 'dispatch', existingWrapper);
      }
      return;
    }
    const wrappedDispatch: DispatchFunction = (action) => {
      recordAction(hookTimeline, action);
      dispatchValue(action);
    };
    dispatchWrapperByOriginal.set(dispatchValue, wrappedDispatch);
    originalDispatchByWrapper.set(wrappedDispatch, dispatchValue);
    Reflect.set(queue, 'dispatch', wrappedDispatch);
  };

  const captureHookSnapshots = (
    fiber: Fiber,
    fiberId: number,
  ): HookStateSnapshot[] => {
    const hookSnapshots: HookStateSnapshot[] = [];
    let hookIndex = 0;
    let currentHook = fiber.memoizedState;

    while (isHookNode(currentHook)) {
      const queue = Reflect.get(currentHook, 'queue');
      const dispatchValue = getQueueDispatch(queue);
      if (dispatchValue) {
        const hookTimeline = getHookTimeline(fiberId, hookIndex);
        if (!hookTimeline.reducer) {
          hookTimeline.reducer = getReducerFromQueue(queue);
        }
        if (!hookTimeline.baseSnapshot || !hookTimeline.baseSnapshot.isClone) {
          const baseSnapshot = createValueSnapshot(currentHook.memoizedState);
          if (baseSnapshot.isClone) {
            hookTimeline.baseSnapshot = baseSnapshot;
            hookTimeline.baseSequence = actionSequence;
            hookTimeline.actions = hookTimeline.actions.filter(
              (entry) => entry.sequence > hookTimeline.baseSequence,
            );
          }
        }
        wrapDispatch(queue, hookTimeline);
        hookSnapshots.push({
          hookIndex,
          valueSnapshot: createValueSnapshot(currentHook.memoizedState),
        });
      }
      hookIndex += 1;
      currentHook = currentHook.next;
    }

    return hookSnapshots;
  };

  const captureClassStateSnapshot = (fiber: Fiber): ValueSnapshot | null => {
    if (fiber.tag !== ClassComponentTag) {
      return null;
    }
    const instance = fiber.stateNode;
    if (!isClassComponentInstance(instance)) {
      return null;
    }
    return createValueSnapshot(instance.state);
  };

  const captureSnapshot = (
    rendererId: number,
    root: FiberRoot,
  ): CommitSnapshot => {
    const fiberSnapshots: FiberSnapshot[] = [];

    traverseFiber(root.current, (fiber) => {
      if (!isCompositeFiber(fiber)) {
        return;
      }
      const fiberId = getFiberId(fiber);
      latestFibersById.set(fiberId, fiber);

      const hookStates = captureHookSnapshots(fiber, fiberId);
      const classState = captureClassStateSnapshot(fiber);

      if (hookStates.length === 0 && classState === null) {
        return;
      }

      fiberSnapshots.push({
        fiberId,
        displayName: getDisplayName(fiber.type),
        hookStates,
        classState,
      });
    });

    const snapshot: CommitSnapshot = {
      commitId: commitCounter,
      timestamp: Date.now(),
      rendererId,
      actionSequence,
      fibers: fiberSnapshots,
    };
    commitCounter += 1;
    snapshots.push(snapshot);

    if (snapshots.length > maxSnapshots) {
      snapshots.shift();
    }

    return snapshot;
  };

  const replayHookState = (
    hookTimeline: HookTimeline,
    targetSequence: number,
  ): ReplayedStateResult => {
    if (!hookTimeline.reducer || !hookTimeline.baseSnapshot?.isClone) {
      return { didReplay: false, value: undefined };
    }
    const baseSnapshot = createValueSnapshot(hookTimeline.baseSnapshot.value);
    let currentState = baseSnapshot.value;

    for (const entry of hookTimeline.actions) {
      if (entry.sequence <= hookTimeline.baseSequence) {
        continue;
      }
      if (entry.sequence > targetSequence) {
        break;
      }
      currentState = hookTimeline.reducer.reduce(currentState, entry.action);
    }

    return { didReplay: true, value: currentState };
  };

  const applyHookSnapshots = (
    fiber: Fiber,
    fiberSnapshot: FiberSnapshot,
    snapshot: CommitSnapshot,
    renderer: ReactRenderer | null,
  ) => {
    const overrideHookState = renderer?.overrideHookState;
    if (!overrideHookState) {
      return;
    }
    const hookTimelineMap = hookTimelinesByFiberId.get(fiberSnapshot.fiberId);
    for (const hookSnapshot of fiberSnapshot.hookStates) {
      const hookTimeline = hookTimelineMap?.get(hookSnapshot.hookIndex);
      const replayedState = hookTimeline
        ? replayHookState(hookTimeline, snapshot.actionSequence)
        : null;
      const valueToApply = replayedState?.didReplay
        ? replayedState.value
        : hookSnapshot.valueSnapshot.value;
      overrideHookState(fiber, hookSnapshot.hookIndex, [], valueToApply);
    }
  };

  const applyClassStateSnapshot = (
    fiber: Fiber,
    classStateSnapshot: ValueSnapshot | null,
  ) => {
    if (classStateSnapshot === null) {
      return;
    }
    if (fiber.tag !== ClassComponentTag) {
      return;
    }
    const instance = fiber.stateNode;
    if (!isClassComponentInstance(instance)) {
      return;
    }
    const valueToApply = classStateSnapshot.isClone
      ? createValueSnapshot(classStateSnapshot.value).value
      : classStateSnapshot.value;
    Reflect.set(instance, 'state', valueToApply);
    instance.forceUpdate();
  };

  const applySnapshot = (snapshot: CommitSnapshot) => {
    isRecordingEnabled = false;
    isRewindPending = true;

    const renderer = getRenderer(snapshot.rendererId);

    for (const fiberSnapshot of snapshot.fibers) {
      const latestFiber = latestFibersById.get(fiberSnapshot.fiberId);
      if (!latestFiber) {
        continue;
      }
      const currentFiber = getLatestFiber(latestFiber);
      applyHookSnapshots(currentFiber, fiberSnapshot, snapshot, renderer);
      applyClassStateSnapshot(currentFiber, fiberSnapshot.classState);
    }
  };

  const recordCommit = (rendererId: number, root: FiberRoot) => {
    getRenderer(rendererId);
    if (!isRecordingEnabled) {
      return;
    }
    captureSnapshot(rendererId, root);
  };

  const recordUnmount = (rendererId: number, fiber: Fiber) => {
    getRenderer(rendererId);
    const fiberId = getFiberId(fiber);
    latestFibersById.delete(fiberId);
    const hookTimelineMap = hookTimelinesByFiberId.get(fiberId);
    if (hookTimelineMap) {
      for (const hookTimeline of hookTimelineMap.values()) {
        hookTimeline.actions.length = 0;
      }
    }
  };

  const onPostCommit = () => {
    if (!isRewindPending) {
      return;
    }
    isRewindPending = false;
    isRecordingEnabled = true;
  };

  const rewindBySteps = (rewindSteps: number): boolean => {
    const targetIndex = snapshots.length - 1 - rewindSteps;
    if (targetIndex < 0 || targetIndex >= snapshots.length) {
      return false;
    }
    applySnapshot(snapshots[targetIndex]);
    return true;
  };

  const rewindToCommit = (commitId: number): boolean => {
    const snapshot = snapshots.find((entry) => entry.commitId === commitId);
    if (!snapshot) {
      return false;
    }
    applySnapshot(snapshot);
    return true;
  };

  const getSnapshots = () => snapshots.slice();

  const clearSnapshots = () => {
    snapshots.length = 0;
    actionSequence = 0;
    commitCounter = 0;
    for (const hookTimelineMap of hookTimelinesByFiberId.values()) {
      for (const hookTimeline of hookTimelineMap.values()) {
        hookTimeline.actions.length = 0;
        hookTimeline.baseSnapshot = null;
        hookTimeline.baseSequence = 0;
        hookTimeline.reducer = null;
      }
    }
  };

  const pause = () => {
    isRecordingEnabled = false;
    isRewindPending = false;
  };

  const resume = () => {
    isRecordingEnabled = true;
  };

  return {
    recordCommit,
    recordUnmount,
    onPostCommit,
    rewindBySteps,
    rewindToCommit,
    getSnapshots,
    clearSnapshots,
    pause,
    resume,
  };
};

export const historyController = createHistoryController({ maxSnapshots: 50 });

instrument(
  secure({
    onCommitFiberRoot: (rendererId, root) => {
      historyController.recordCommit(rendererId, root);
    },
    onCommitFiberUnmount: (rendererId, fiber) => {
      historyController.recordUnmount(rendererId, fiber);
    },
    onPostCommitFiberRoot: () => {
      historyController.onPostCommit();
    },
  }),
);

Object.assign(globalThis, {
  __BIPPY_HISTORY__: historyController,
});
