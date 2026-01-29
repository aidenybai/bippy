import type { Fiber, FiberRoot, MemoizedState, Props } from './types.js';
import {
  instrument,
  traverseFiber,
  traverseState,
  getDisplayName,
  getFiberId,
  isCompositeFiber,
  overrideHookState,
  overrideProps,
  traverseRenderedFibers,
  secure,
} from './core.js';

interface HookState {
  hookIndex: number;
  value: unknown;
}

interface FiberSnapshot {
  fiberId: number;
  displayName: string | null;
  props: Props;
  hookStates: HookState[];
  timestamp: number;
}

interface CommitSnapshot {
  commitId: number;
  timestamp: number;
  fibers: Map<number, FiberSnapshot>;
}

interface TimeTravelOptions {
  maxHistoryLength?: number;
  onSnapshot?: (snapshot: CommitSnapshot) => void;
  onRestore?: (snapshot: CommitSnapshot) => void;
  trackComponents?: string[] | ((displayName: string | null) => boolean);
  dangerouslyRunInProduction?: boolean;
}

const cloneValue = <T>(value: T): T => {
  if (value === null || value === undefined) return value;
  if (typeof value === 'function') return value;
  if (typeof value !== 'object') return value;

  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    return value;
  }
};

const extractHookStates = (fiber: Fiber): HookState[] => {
  const hookStates: HookState[] = [];
  let hookIndex = 0;

  traverseState(fiber, (nextState) => {
    if (nextState && 'memoizedState' in nextState) {
      const stateValue = nextState.memoizedState;
      if (
        nextState.queue !== undefined &&
        nextState.queue !== null &&
        typeof nextState.queue === 'object' &&
        'dispatch' in nextState.queue
      ) {
        hookStates.push({
          hookIndex,
          value: cloneValue(stateValue),
        });
      }
    }
    hookIndex++;
  });

  return hookStates;
};

const createFiberSnapshot = (fiber: Fiber): FiberSnapshot => {
  return {
    fiberId: getFiberId(fiber),
    displayName: getDisplayName(fiber.type),
    props: cloneValue(fiber.memoizedProps),
    hookStates: extractHookStates(fiber),
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
  private trackComponents?: string[] | ((displayName: string | null) => boolean);
  private fiberMap = new WeakMap<object, Fiber>();
  private fiberIdToFiberMap = new Map<number, Fiber>();
  private isRestoring = false;
  private fiberRoots = new Set<FiberRoot>();

  constructor(options: TimeTravelOptions = {}) {
    this.maxHistoryLength = options.maxHistoryLength ?? 100;
    this.onSnapshot = options.onSnapshot;
    this.onRestore = options.onRestore;
    this.trackComponents = options.trackComponents;

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

    return this.trackComponents(displayName);
  }

  private captureSnapshot(root: FiberRoot): void {
    const snapshot: CommitSnapshot = {
      commitId: this.commitCounter++,
      timestamp: Date.now(),
      fibers: new Map(),
    };

    traverseRenderedFibers(root, (fiber) => {
      if (this.shouldTrackFiber(fiber)) {
        const fiberSnapshot = createFiberSnapshot(fiber);
        snapshot.fibers.set(fiberSnapshot.fiberId, fiberSnapshot);
        this.fiberIdToFiberMap.set(fiberSnapshot.fiberId, fiber);
      }
    });

    if (snapshot.fibers.size > 0) {
      if (this.currentIndex < this.history.length - 1) {
        this.history = this.history.slice(0, this.currentIndex + 1);
      }

      this.history.push(snapshot);
      this.currentIndex = this.history.length - 1;

      if (this.history.length > this.maxHistoryLength) {
        this.history.shift();
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
      for (const [fiberId, fiberSnapshot] of snapshot.fibers) {
        const fiber = this.fiberIdToFiberMap.get(fiberId);
        if (!fiber) continue;

        for (const hookState of fiberSnapshot.hookStates) {
          const restoredValue = cloneValue(hookState.value);
          overrideHookState(fiber, hookState.hookIndex, restoredValue as Record<string, unknown>);
        }

        const currentProps = fiber.memoizedProps ?? {};
        const snapshotProps = fiberSnapshot.props ?? {};

        for (const propName of Object.keys(snapshotProps)) {
          if (propName === 'children') continue;
          if (currentProps[propName] !== snapshotProps[propName]) {
            overrideProps(fiber, { [propName]: cloneValue(snapshotProps[propName]) });
          }
        }
      }

      this.onRestore?.(snapshot);
    } finally {
      this.isRestoring = false;
    }
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
      for (const fiberSnapshot of commit.fibers.values()) {
        if (fiberSnapshot.displayName === displayName) {
          snapshots.push(fiberSnapshot);
        }
      }
    }
    return snapshots;
  }

  clear(): void {
    this.history = [];
    this.currentIndex = -1;
    this.commitCounter = 0;
    this.fiberIdToFiberMap.clear();
  }

  getStateTimeline(
    fiberId: number,
    hookIndex: number,
  ): Array<{ commitId: number; timestamp: number; value: unknown }> {
    const timeline: Array<{ commitId: number; timestamp: number; value: unknown }> = [];

    for (const commit of this.history) {
      const fiberSnapshot = commit.fibers.get(fiberId);
      if (fiberSnapshot) {
        const hookState = fiberSnapshot.hookStates.find(
          (hookStateItem) => hookStateItem.hookIndex === hookIndex,
        );
        if (hookState) {
          timeline.push({
            commitId: commit.commitId,
            timestamp: commit.timestamp,
            value: hookState.value,
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
        history: this.history.map((commit) => ({
          ...commit,
          fibers: Array.from(commit.fibers.entries()),
        })),
        currentIndex: this.currentIndex,
      },
      null,
      2,
    );
  }

  importHistory(jsonString: string): void {
    const data = JSON.parse(jsonString) as {
      history: Array<{
        commitId: number;
        timestamp: number;
        fibers: Array<[number, FiberSnapshot]>;
      }>;
      currentIndex: number;
    };

    this.history = data.history.map((commit) => ({
      ...commit,
      fibers: new Map(commit.fibers),
    }));
    this.currentIndex = data.currentIndex;
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
      stateChanges: Array<{ hookIndex: number; from: unknown; to: unknown }>;
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
        stateChanges: Array<{ hookIndex: number; from: unknown; to: unknown }>;
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
      const stateChanges: Array<{ hookIndex: number; from: unknown; to: unknown }> = [];

      const allProps = new Set([
        ...Object.keys(fromFiber.props ?? {}),
        ...Object.keys(toFiber.props ?? {}),
      ]);

      for (const prop of allProps) {
        const fromValue = fromFiber.props?.[prop];
        const toValue = toFiber.props?.[prop];
        if (JSON.stringify(fromValue) !== JSON.stringify(toValue)) {
          propChanges.push({ prop, from: fromValue, to: toValue });
        }
      }

      for (const toState of toFiber.hookStates) {
        const fromState = fromFiber.hookStates.find(
          (hookStateItem) => hookStateItem.hookIndex === toState.hookIndex,
        );
        const fromValue = fromState?.value;
        const toValue = toState.value;
        if (JSON.stringify(fromValue) !== JSON.stringify(toValue)) {
          stateChanges.push({ hookIndex: toState.hookIndex, from: fromValue, to: toValue });
        }
      }

      if (propChanges.length > 0 || stateChanges.length > 0) {
        changes.set(fiberId, {
          fiberId,
          displayName: toFiber.displayName,
          propChanges,
          stateChanges,
        });
      }
    }

    return changes;
  }
}

export const createTimeTravel = (options?: TimeTravelOptions): TimeTravel => {
  return new TimeTravel(options);
};

export type { CommitSnapshot, FiberSnapshot, HookState, TimeTravelOptions };
