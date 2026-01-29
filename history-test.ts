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

interface HookStateSnapshot {
  hookIndex: number;
  value: unknown;
}

interface FiberSnapshot {
  fiberId: number;
  displayName: string | null;
  hookStates: HookStateSnapshot[];
  classState: unknown | null;
}

interface CommitSnapshot {
  commitId: number;
  timestamp: number;
  rendererId: number;
  fibers: FiberSnapshot[];
}

interface HistoryOptions {
  maxSnapshots?: number;
}

interface HistoryController {
  recordCommit: (rendererId: number, root: FiberRoot) => void;
  recordUnmount: (fiber: Fiber) => void;
  onPostCommit: () => void;
  rewind: (rewindSteps: number) => boolean;
  getSnapshots: () => CommitSnapshot[];
  clearSnapshots: () => void;
}

const isHookNode = (value: unknown): value is MemoizedState => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  return 'memoizedState' in value && 'next' in value;
};

const isQueueWithDispatch = (
  value: unknown,
): value is { dispatch: (action: unknown) => void } => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const dispatchValue = Reflect.get(value, 'dispatch');
  return typeof dispatchValue === 'function';
};

const isClassComponentInstance = (
  value: unknown,
): value is { state: unknown; forceUpdate: () => void } => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  if (!('state' in value)) {
    return false;
  }
  const forceUpdateValue = Reflect.get(value, 'forceUpdate');
  return typeof forceUpdateValue === 'function';
};

const deepCloneValue = (value: unknown): unknown => {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  const structuredCloneValue = Reflect.get(globalThis, 'structuredClone');
  if (typeof structuredCloneValue === 'function') {
    try {
      return structuredCloneValue(value);
    } catch {}
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
};

const collectHookSnapshots = (fiber: Fiber): HookStateSnapshot[] => {
  const hookSnapshots: HookStateSnapshot[] = [];
  let hookIndex = 0;
  let currentHook = fiber.memoizedState;

  while (isHookNode(currentHook)) {
    if (isQueueWithDispatch(currentHook.queue)) {
      hookSnapshots.push({
        hookIndex,
        value: deepCloneValue(currentHook.memoizedState),
      });
    }
    hookIndex += 1;
    currentHook = currentHook.next;
  }

  return hookSnapshots;
};

const collectClassStateSnapshot = (fiber: Fiber): unknown | null => {
  if (fiber.tag !== ClassComponentTag) {
    return null;
  }
  const instance = fiber.stateNode;
  if (!isClassComponentInstance(instance)) {
    return null;
  }
  return deepCloneValue(instance.state);
};

const applyClassStateSnapshot = (fiber: Fiber, classState: unknown | null) => {
  if (classState == null || fiber.tag !== ClassComponentTag) {
    return;
  }
  const instance = fiber.stateNode;
  if (!isClassComponentInstance(instance)) {
    return;
  }
  Reflect.set(instance, 'state', deepCloneValue(classState));
  instance.forceUpdate();
};

const applyHookSnapshots = (
  fiber: Fiber,
  hookSnapshots: HookStateSnapshot[],
  renderer: ReactRenderer | null,
) => {
  const overrideHookState = renderer?.overrideHookState;
  if (!overrideHookState) {
    return;
  }
  for (const hookSnapshot of hookSnapshots) {
    overrideHookState(
      fiber,
      hookSnapshot.hookIndex,
      [],
      deepCloneValue(hookSnapshot.value),
    );
  }
};

const createHistoryController = (
  options: HistoryOptions = {},
): HistoryController => {
  const maxSnapshots = options.maxSnapshots ?? 30;
  const snapshots: CommitSnapshot[] = [];
  const latestFibersById = new Map<number, Fiber>();
  const rendererById = new Map<number, ReactRenderer>();
  let commitCounter = 0;
  let isRecordingEnabled = true;
  let isRewindPending = false;

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

      const hookStates = collectHookSnapshots(fiber);
      const classState = collectClassStateSnapshot(fiber);

      if (hookStates.length === 0 && classState == null) {
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
      fibers: fiberSnapshots,
    };
    commitCounter += 1;
    snapshots.push(snapshot);

    if (snapshots.length > maxSnapshots) {
      snapshots.shift();
    }

    return snapshot;
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

      applyHookSnapshots(currentFiber, fiberSnapshot.hookStates, renderer);
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

  const recordUnmount = (fiber: Fiber) => {
    const fiberId = getFiberId(fiber);
    latestFibersById.delete(fiberId);
  };

  const onPostCommit = () => {
    if (!isRewindPending) {
      return;
    }
    isRewindPending = false;
    isRecordingEnabled = true;
  };

  const rewind = (rewindSteps: number): boolean => {
    const targetIndex = snapshots.length - 1 - rewindSteps;
    if (targetIndex < 0 || targetIndex >= snapshots.length) {
      return false;
    }
    applySnapshot(snapshots[targetIndex]);
    return true;
  };

  const getSnapshots = () => snapshots.slice();
  const clearSnapshots = () => {
    snapshots.length = 0;
  };

  return {
    recordCommit,
    recordUnmount,
    onPostCommit,
    rewind,
    getSnapshots,
    clearSnapshots,
  };
};

export const historyController = createHistoryController({ maxSnapshots: 50 });

instrument(
  secure({
    onCommitFiberRoot: (rendererId, root) => {
      historyController.recordCommit(rendererId, root);
    },
    onCommitFiberUnmount: (rendererId, fiber) => {
      historyController.recordUnmount(fiber);
    },
    onPostCommitFiberRoot: () => {
      historyController.onPostCommit();
    },
  }),
);

Object.assign(globalThis, {
  __BIPPY_HISTORY__: historyController,
});
