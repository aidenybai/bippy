import type { Fiber, FiberRoot, MemoizedState, Props } from './types.js';
import {
  instrument,
  getDisplayName,
  getFiberId,
  isCompositeFiber,
  overrideHookState,
  overrideProps,
  traverseRenderedFibers,
  secure,
  ClassComponentTag,
  FunctionComponentTag,
  ForwardRefTag,
  MemoComponentTag,
  SimpleMemoComponentTag,
  getLatestFiber,
} from './core.js';

type HookType =
  | 'State'
  | 'Reducer'
  | 'Ref'
  | 'Effect'
  | 'LayoutEffect'
  | 'InsertionEffect'
  | 'Memo'
  | 'Callback'
  | 'Context'
  | 'ImperativeHandle'
  | 'DebugValue'
  | 'DeferredValue'
  | 'Transition'
  | 'SyncExternalStore'
  | 'Id'
  | 'Optimistic'
  | 'FormState'
  | 'ActionState'
  | 'Unknown';

interface HookInfo {
  hookIndex: number;
  hookType: HookType;
  value: unknown;
  isEditable: boolean;
}

interface FiberSnapshot {
  fiberId: number;
  displayName: string | null;
  componentType: 'function' | 'class' | 'forwardRef' | 'memo' | 'unknown';
  props: Props;
  hooks: HookInfo[];
  classState: unknown | null;
  timestamp: number;
}

interface CommitSnapshot {
  commitId: number;
  timestamp: number;
  fibers: Map<number, FiberSnapshot>;
  fibersByName: Map<string, FiberSnapshot[]>;
}

interface ExternalStateEntry {
  key: string;
  value: unknown;
}

interface TimeTravelOptions {
  maxHistoryLength?: number;
  onSnapshot?: (snapshot: CommitSnapshot) => void;
  onRestore?: (snapshot: CommitSnapshot) => void;
  onBeforeRestore?: (snapshot: CommitSnapshot) => boolean | void;
  trackComponents?: string[] | ((displayName: string | null, fiber: Fiber) => boolean);
  dangerouslyRunInProduction?: boolean;
  captureExternalState?: () => ExternalStateEntry[];
  restoreExternalState?: (entries: ExternalStateEntry[]) => void;
}

const safeClone = <T>(value: T): T => {
  if (value === null || value === undefined) return value;
  if (typeof value === 'function') return value;
  if (typeof value !== 'object') return value;
  if (value instanceof Date) return new Date(value.getTime()) as T;
  if (value instanceof RegExp) return new RegExp(value.source, value.flags) as T;
  if (value instanceof Map) return new Map(Array.from(value.entries()).map(([mapKey, mapValue]) => [safeClone(mapKey), safeClone(mapValue)])) as T;
  if (value instanceof Set) return new Set(Array.from(value).map(safeClone)) as T;

  try {
    const serialized = JSON.stringify(value, (_key, innerValue) => {
      if (typeof innerValue === 'function') return '[Function]';
      if (innerValue instanceof Error) return { __error: true, message: innerValue.message, name: innerValue.name };
      if (typeof innerValue === 'symbol') return `[Symbol: ${innerValue.toString()}]`;
      if (typeof innerValue === 'bigint') return `[BigInt: ${innerValue.toString()}]`;
      return innerValue;
    });
    return JSON.parse(serialized) as T;
  } catch {
    return value;
  }
};

const identifyHookType = (
  hookState: MemoizedState,
  hookIndex: number,
  prevHookState?: MemoizedState | null,
): HookType => {
  if (!hookState) return 'Unknown';

  const memoizedState = hookState.memoizedState;
  const queue = hookState.queue;

  if (queue !== null && queue !== undefined && typeof queue === 'object') {
    if ('dispatch' in queue && typeof (queue as { dispatch?: unknown }).dispatch === 'function') {
      if ('lastRenderedReducer' in queue) {
        const reducer = (queue as { lastRenderedReducer?: unknown }).lastRenderedReducer;
        if (typeof reducer === 'function' && reducer.name === 'basicStateReducer') {
          return 'State';
        }
        return 'Reducer';
      }
      return 'State';
    }
  }

  if (memoizedState !== null && typeof memoizedState === 'object') {
    if ('current' in memoizedState && Object.keys(memoizedState).length === 1) {
      return 'Ref';
    }

    if ('tag' in memoizedState && 'destroy' in memoizedState && 'deps' in memoizedState) {
      const tag = memoizedState.tag as number;
      if ((tag & 0b0100) !== 0) return 'LayoutEffect';
      if ((tag & 0b1000) !== 0) return 'InsertionEffect';
      return 'Effect';
    }

    if (Array.isArray(memoizedState) && memoizedState.length === 2) {
      const [first, second] = memoizedState;
      if (Array.isArray(second) || second === null) {
        if (typeof first === 'function') return 'Callback';
        return 'Memo';
      }
    }
  }

  if ('baseState' in hookState && 'baseQueue' in hookState) {
    return 'State';
  }

  return 'Unknown';
};

const extractHooks = (fiber: Fiber): HookInfo[] => {
  const hooks: HookInfo[] = [];

  if (!isCompositeFiber(fiber)) return hooks;
  if (fiber.tag === ClassComponentTag) return hooks;

  let hookState: MemoizedState | null = fiber.memoizedState;
  let prevHookState: MemoizedState | null = fiber.alternate?.memoizedState ?? null;
  let hookIndex = 0;

  while (hookState) {
    const hookType = identifyHookType(hookState, hookIndex, prevHookState);
    const isEditable = hookType === 'State' || hookType === 'Reducer';

    let value: unknown = hookState.memoizedState;

    if (hookType === 'Ref' && value && typeof value === 'object' && 'current' in value) {
      value = (value as { current: unknown }).current;
    }

    if (hookType === 'Memo' || hookType === 'Callback') {
      if (Array.isArray(value) && value.length === 2) {
        value = value[0];
      }
    }

    hooks.push({
      hookIndex,
      hookType,
      value: isEditable ? safeClone(value) : value,
      isEditable,
    });

    hookState = hookState.next ?? null;
    prevHookState = prevHookState?.next ?? null;
    hookIndex++;
  }

  return hooks;
};

const getComponentType = (fiber: Fiber): FiberSnapshot['componentType'] => {
  switch (fiber.tag) {
    case FunctionComponentTag:
      return 'function';
    case ClassComponentTag:
      return 'class';
    case ForwardRefTag:
      return 'forwardRef';
    case MemoComponentTag:
    case SimpleMemoComponentTag:
      return 'memo';
    default:
      return 'unknown';
  }
};

const extractClassState = (fiber: Fiber): unknown | null => {
  if (fiber.tag !== ClassComponentTag) return null;
  if (!fiber.stateNode) return null;

  const instance = fiber.stateNode as { state?: unknown };
  if (instance.state) {
    return safeClone(instance.state);
  }

  return null;
};

const createFiberSnapshot = (fiber: Fiber): FiberSnapshot => {
  const latestFiber = getLatestFiber(fiber);

  return {
    fiberId: getFiberId(latestFiber),
    displayName: getDisplayName(latestFiber.type),
    componentType: getComponentType(latestFiber),
    props: safeClone(latestFiber.memoizedProps ?? {}),
    hooks: extractHooks(latestFiber),
    classState: extractClassState(latestFiber),
    timestamp: Date.now(),
  };
};

export class TimeTravel {
  private history: CommitSnapshot[] = [];
  private currentIndex = -1;
  private commitCounter = 0;
  private maxHistoryLength: number;
  private onSnapshot?: (snapshot: CommitSnapshot) => void;
  private onRestore?: (snapshot: CommitSnapshot) => void;
  private onBeforeRestore?: (snapshot: CommitSnapshot) => boolean | void;
  private trackComponents?: string[] | ((displayName: string | null, fiber: Fiber) => boolean);
  private fiberIdToFiberRef = new Map<number, WeakRef<Fiber>>();
  private isRestoring = false;
  private fiberRoots = new Set<FiberRoot>();
  private captureExternalState?: () => ExternalStateEntry[];
  private restoreExternalState?: (entries: ExternalStateEntry[]) => void;
  private externalStateHistory = new Map<number, ExternalStateEntry[]>();

  constructor(options: TimeTravelOptions = {}) {
    this.maxHistoryLength = options.maxHistoryLength ?? 100;
    this.onSnapshot = options.onSnapshot;
    this.onRestore = options.onRestore;
    this.onBeforeRestore = options.onBeforeRestore;
    this.trackComponents = options.trackComponents;
    this.captureExternalState = options.captureExternalState;
    this.restoreExternalState = options.restoreExternalState;

    const instrumentOptions = {
      onCommitFiberRoot: (_rendererID: number, root: FiberRoot) => {
        if (this.isRestoring) return;

        this.fiberRoots.add(root);
        this.captureSnapshot(root);
      },
    };

    if (options.dangerouslyRunInProduction) {
      instrument(
        secure(instrumentOptions, { dangerouslyRunInProduction: true }),
      );
    } else {
      instrument(secure(instrumentOptions));
    }
  }

  private shouldTrackFiber(fiber: Fiber): boolean {
    if (!isCompositeFiber(fiber)) return false;

    const displayName = getDisplayName(fiber.type);

    if (!this.trackComponents) return true;

    if (Array.isArray(this.trackComponents)) {
      return displayName !== null && this.trackComponents.includes(displayName);
    }

    return this.trackComponents(displayName, fiber);
  }

  private updateFiberRef(fiberId: number, fiber: Fiber): void {
    const existingRef = this.fiberIdToFiberRef.get(fiberId);
    if (!existingRef || !existingRef.deref()) {
      this.fiberIdToFiberRef.set(fiberId, new WeakRef(fiber));
    } else {
      const existingFiber = existingRef.deref();
      if (existingFiber !== fiber && existingFiber !== fiber.alternate) {
        this.fiberIdToFiberRef.set(fiberId, new WeakRef(fiber));
      }
    }
  }

  private getFiberByIdFromRoots(fiberId: number): Fiber | null {
    const weakRef = this.fiberIdToFiberRef.get(fiberId);
    if (weakRef) {
      const fiber = weakRef.deref();
      if (fiber) {
        return getLatestFiber(fiber);
      }
    }
    return null;
  }

  private captureSnapshot(root: FiberRoot): void {
    const snapshot: CommitSnapshot = {
      commitId: this.commitCounter++,
      timestamp: Date.now(),
      fibers: new Map(),
      fibersByName: new Map(),
    };

    traverseRenderedFibers(root, (fiber) => {
      if (this.shouldTrackFiber(fiber)) {
        const fiberSnapshot = createFiberSnapshot(fiber);
        snapshot.fibers.set(fiberSnapshot.fiberId, fiberSnapshot);

        this.updateFiberRef(fiberSnapshot.fiberId, fiber);

        if (fiberSnapshot.displayName) {
          const existing = snapshot.fibersByName.get(fiberSnapshot.displayName) ?? [];
          existing.push(fiberSnapshot);
          snapshot.fibersByName.set(fiberSnapshot.displayName, existing);
        }
      }
    });

    if (snapshot.fibers.size > 0) {
      if (this.currentIndex < this.history.length - 1) {
        this.history = this.history.slice(0, this.currentIndex + 1);
        const commitIdsToRemove: number[] = [];
        for (let historyIndex = this.currentIndex + 1; historyIndex < this.history.length; historyIndex++) {
          commitIdsToRemove.push(this.history[historyIndex].commitId);
        }
        commitIdsToRemove.forEach((commitId) => this.externalStateHistory.delete(commitId));
      }

      if (this.captureExternalState) {
        try {
          const externalState = this.captureExternalState();
          this.externalStateHistory.set(snapshot.commitId, safeClone(externalState));
        } catch {
          // External state capture failed, continue without it
        }
      }

      this.history.push(snapshot);
      this.currentIndex = this.history.length - 1;

      if (this.history.length > this.maxHistoryLength) {
        const removedSnapshot = this.history.shift();
        if (removedSnapshot) {
          this.externalStateHistory.delete(removedSnapshot.commitId);
        }
        this.currentIndex--;
      }

      this.onSnapshot?.(snapshot);
    }
  }

  getHistory(): CommitSnapshot[] {
    return [...this.history];
  }

  getCurrentIndex(): number {
    return this.currentIndex;
  }

  getCurrentSnapshot(): CommitSnapshot | null {
    return this.history[this.currentIndex] ?? null;
  }

  getSnapshotAt(index: number): CommitSnapshot | null {
    return this.history[index] ?? null;
  }

  canGoBack(): boolean {
    return this.currentIndex > 0;
  }

  canGoForward(): boolean {
    return this.currentIndex < this.history.length - 1;
  }

  goBack(): CommitSnapshot | null {
    if (!this.canGoBack()) return null;
    return this.goToIndex(this.currentIndex - 1);
  }

  goForward(): CommitSnapshot | null {
    if (!this.canGoForward()) return null;
    return this.goToIndex(this.currentIndex + 1);
  }

  goToIndex(index: number): CommitSnapshot | null {
    if (index < 0 || index >= this.history.length) return null;

    const snapshot = this.history[index];

    if (this.onBeforeRestore) {
      const shouldProceed = this.onBeforeRestore(snapshot);
      if (shouldProceed === false) return null;
    }

    this.restoreSnapshot(snapshot);
    this.currentIndex = index;

    return snapshot;
  }

  goToCommitId(commitId: number): CommitSnapshot | null {
    const index = this.history.findIndex(
      (snapshot) => snapshot.commitId === commitId,
    );
    if (index === -1) return null;
    return this.goToIndex(index);
  }

  private restoreSnapshot(snapshot: CommitSnapshot): void {
    this.isRestoring = true;

    try {
      const restorationErrors: Array<{ fiberId: number; error: Error }> = [];

      for (const [fiberId, fiberSnapshot] of snapshot.fibers) {
        const fiber = this.getFiberByIdFromRoots(fiberId);
        if (!fiber) {
          continue;
        }

        try {
          if (fiberSnapshot.componentType === 'class' && fiberSnapshot.classState !== null) {
            const instance = fiber.stateNode as { state?: unknown; setState?: (state: unknown) => void };
            if (instance && typeof instance.setState === 'function') {
              instance.setState(safeClone(fiberSnapshot.classState));
            }
          }

          for (const hook of fiberSnapshot.hooks) {
            if (!hook.isEditable) continue;

            const latestFiber = getLatestFiber(fiber);
            const restoredValue = safeClone(hook.value);

            try {
              overrideHookState(latestFiber, hook.hookIndex, restoredValue as Record<string, unknown>);
            } catch (hookError) {
              restorationErrors.push({
                fiberId,
                error: hookError instanceof Error ? hookError : new Error(String(hookError)),
              });
            }
          }

          const currentProps = fiber.memoizedProps ?? {};
          const snapshotProps = fiberSnapshot.props ?? {};

          for (const propName of Object.keys(snapshotProps)) {
            if (propName === 'children') continue;
            if (propName === 'key') continue;
            if (propName === 'ref') continue;
            if (typeof snapshotProps[propName] === 'function') continue;

            if (JSON.stringify(currentProps[propName]) !== JSON.stringify(snapshotProps[propName])) {
              try {
                overrideProps(fiber, { [propName]: safeClone(snapshotProps[propName]) });
              } catch {
                // Props override can fail for various reasons, continue
              }
            }
          }
        } catch (fiberError) {
          restorationErrors.push({
            fiberId,
            error: fiberError instanceof Error ? fiberError : new Error(String(fiberError)),
          });
        }
      }

      if (this.restoreExternalState) {
        const externalState = this.externalStateHistory.get(snapshot.commitId);
        if (externalState) {
          try {
            this.restoreExternalState(safeClone(externalState));
          } catch {
            // External state restore failed, continue
          }
        }
      }

      this.onRestore?.(snapshot);
    } finally {
      this.isRestoring = false;
    }
  }

  getEditableStateCount(fiberId: number): number {
    const snapshot = this.getCurrentSnapshot();
    if (!snapshot) return 0;

    const fiberSnapshot = snapshot.fibers.get(fiberId);
    if (!fiberSnapshot) return 0;

    return fiberSnapshot.hooks.filter((hook) => hook.isEditable).length;
  }

  getFiberSnapshotHistory(fiberId: number): FiberSnapshot[] {
    const snapshots: FiberSnapshot[] = [];
    for (const commit of this.history) {
      const fiberSnapshot = commit.fibers.get(fiberId);
      if (fiberSnapshot) {
        snapshots.push(fiberSnapshot);
      }
    }
    return snapshots;
  }

  getComponentHistory(displayName: string): FiberSnapshot[] {
    const snapshots: FiberSnapshot[] = [];
    for (const commit of this.history) {
      const fiberSnapshots = commit.fibersByName.get(displayName);
      if (fiberSnapshots) {
        snapshots.push(...fiberSnapshots);
      }
    }
    return snapshots;
  }

  clear(): void {
    this.history = [];
    this.currentIndex = -1;
    this.commitCounter = 0;
    this.fiberIdToFiberRef.clear();
    this.externalStateHistory.clear();
  }

  getStateTimeline(
    fiberId: number,
    hookIndex: number,
  ): Array<{ commitId: number; timestamp: number; value: unknown; hookType: HookType }> {
    const timeline: Array<{ commitId: number; timestamp: number; value: unknown; hookType: HookType }> = [];

    for (const commit of this.history) {
      const fiberSnapshot = commit.fibers.get(fiberId);
      if (fiberSnapshot) {
        const hookInfo = fiberSnapshot.hooks.find(
          (hook) => hook.hookIndex === hookIndex,
        );
        if (hookInfo) {
          timeline.push({
            commitId: commit.commitId,
            timestamp: commit.timestamp,
            value: hookInfo.value,
            hookType: hookInfo.hookType,
          });
        }
      }
    }

    return timeline;
  }

  getPropsTimeline(
    fiberId: number,
    propName: string,
  ): Array<{ commitId: number; timestamp: number; value: unknown }> {
    const timeline: Array<{ commitId: number; timestamp: number; value: unknown }> = [];

    for (const commit of this.history) {
      const fiberSnapshot = commit.fibers.get(fiberId);
      if (fiberSnapshot && propName in fiberSnapshot.props) {
        timeline.push({
          commitId: commit.commitId,
          timestamp: commit.timestamp,
          value: fiberSnapshot.props[propName],
        });
      }
    }

    return timeline;
  }

  exportHistory(): string {
    return JSON.stringify(
      {
        version: 1,
        history: this.history.map((commit) => ({
          ...commit,
          fibers: Array.from(commit.fibers.entries()),
          fibersByName: Array.from(commit.fibersByName.entries()),
        })),
        currentIndex: this.currentIndex,
        externalState: Array.from(this.externalStateHistory.entries()),
      },
      null,
      2,
    );
  }

  importHistory(jsonString: string): void {
    const data = JSON.parse(jsonString) as {
      version?: number;
      history: Array<{
        commitId: number;
        timestamp: number;
        fibers: Array<[number, FiberSnapshot]>;
        fibersByName: Array<[string, FiberSnapshot[]]>;
      }>;
      currentIndex: number;
      externalState?: Array<[number, ExternalStateEntry[]]>;
    };

    this.history = data.history.map((commit) => ({
      ...commit,
      fibers: new Map(commit.fibers),
      fibersByName: new Map(commit.fibersByName),
    }));
    this.currentIndex = data.currentIndex;

    if (data.externalState) {
      this.externalStateHistory = new Map(data.externalState);
    }
  }

  diff(
    fromIndex: number,
    toIndex: number,
  ): Map<
    number,
    {
      fiberId: number;
      displayName: string | null;
      propChanges: Array<{ prop: string; from: unknown; to: unknown }>;
      stateChanges: Array<{ hookIndex: number; hookType: HookType; from: unknown; to: unknown }>;
      classStateChange: { from: unknown; to: unknown } | null;
    }
  > {
    const fromSnapshot = this.history[fromIndex];
    const toSnapshot = this.history[toIndex];

    if (!fromSnapshot || !toSnapshot) {
      return new Map();
    }

    const changes = new Map<
      number,
      {
        fiberId: number;
        displayName: string | null;
        propChanges: Array<{ prop: string; from: unknown; to: unknown }>;
        stateChanges: Array<{ hookIndex: number; hookType: HookType; from: unknown; to: unknown }>;
        classStateChange: { from: unknown; to: unknown } | null;
      }
    >();

    const allFiberIds = new Set([
      ...fromSnapshot.fibers.keys(),
      ...toSnapshot.fibers.keys(),
    ]);

    for (const fiberId of allFiberIds) {
      const fromFiber = fromSnapshot.fibers.get(fiberId);
      const toFiber = toSnapshot.fibers.get(fiberId);

      if (!fromFiber || !toFiber) continue;

      const propChanges: Array<{ prop: string; from: unknown; to: unknown }> = [];
      const stateChanges: Array<{ hookIndex: number; hookType: HookType; from: unknown; to: unknown }> = [];
      let classStateChange: { from: unknown; to: unknown } | null = null;

      const allProps = new Set([
        ...Object.keys(fromFiber.props ?? {}),
        ...Object.keys(toFiber.props ?? {}),
      ]);

      for (const prop of allProps) {
        if (prop === 'children') continue;
        const fromValue = fromFiber.props?.[prop];
        const toValue = toFiber.props?.[prop];
        if (JSON.stringify(fromValue) !== JSON.stringify(toValue)) {
          propChanges.push({ prop, from: fromValue, to: toValue });
        }
      }

      for (const toHook of toFiber.hooks) {
        if (!toHook.isEditable) continue;

        const fromHook = fromFiber.hooks.find(
          (hook) => hook.hookIndex === toHook.hookIndex,
        );
        const fromValue = fromHook?.value;
        const toValue = toHook.value;
        if (JSON.stringify(fromValue) !== JSON.stringify(toValue)) {
          stateChanges.push({
            hookIndex: toHook.hookIndex,
            hookType: toHook.hookType,
            from: fromValue,
            to: toValue,
          });
        }
      }

      if (fromFiber.classState !== null || toFiber.classState !== null) {
        if (JSON.stringify(fromFiber.classState) !== JSON.stringify(toFiber.classState)) {
          classStateChange = { from: fromFiber.classState, to: toFiber.classState };
        }
      }

      if (propChanges.length > 0 || stateChanges.length > 0 || classStateChange !== null) {
        changes.set(fiberId, {
          fiberId,
          displayName: toFiber.displayName,
          propChanges,
          stateChanges,
          classStateChange,
        });
      }
    }

    return changes;
  }

  getTrackedFiberIds(): number[] {
    const snapshot = this.getCurrentSnapshot();
    if (!snapshot) return [];
    return Array.from(snapshot.fibers.keys());
  }

  getTrackedComponentNames(): string[] {
    const snapshot = this.getCurrentSnapshot();
    if (!snapshot) return [];
    return Array.from(snapshot.fibersByName.keys());
  }

  isRestoreInProgress(): boolean {
    return this.isRestoring;
  }
}

export const createTimeTravel = (options?: TimeTravelOptions): TimeTravel => {
  return new TimeTravel(options);
};

export type {
  CommitSnapshot,
  ExternalStateEntry,
  FiberSnapshot,
  HookInfo,
  HookType,
  TimeTravelOptions,
};
