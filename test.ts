import {
  ClassComponentTag,
  getDisplayName,
  getFiberFromHostInstance,
  getFiberId,
  getLatestFiber,
  getNearestHostFiber,
  getRDTHook,
  instrument,
  isCompositeFiber,
  isHostFiber,
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
  domSnapshot: DomSnapshot | null;
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

interface PseudoClassSnapshot {
  focusedElementId: number | null;
  focusVisibleElementId: number | null;
  hoveredElementIds: number[];
  activeElementIds: number[];
}

interface AnimationStateSnapshot {
  id: string | null;
  name: string | null;
  playState: string;
  currentTime: number | null;
  playbackRate: number;
  startTime: number | null;
}

interface ElementAnimationSnapshot {
  elementId: number;
  animations: AnimationStateSnapshot[];
}

interface DomSnapshot {
  pseudoClasses: PseudoClassSnapshot;
  animations: ElementAnimationSnapshot[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isElement = (value: unknown): value is Element =>
  typeof Element !== 'undefined' && value instanceof Element;

const isDocumentAvailable = () => typeof document !== 'undefined';

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

const getAnimationName = (animation: Animation): string | null => {
  const animationName = Reflect.get(animation, 'animationName');
  if (typeof animationName === 'string') {
    return animationName;
  }
  if (typeof animation.id === 'string' && animation.id.length > 0) {
    return animation.id;
  }
  return null;
};

const getDocumentAnimations = (): Animation[] => {
  if (!isDocumentAvailable()) {
    return [];
  }
  const getAnimationsValue = Reflect.get(document, 'getAnimations');
  if (typeof getAnimationsValue !== 'function') {
    return [];
  }
  try {
    const animations = getAnimationsValue.call(document);
    if (Array.isArray(animations)) {
      return animations;
    }
  } catch {}
  return [];
};

const createPointerEvent = (type: string): Event => {
  const eventOptions = { bubbles: true, cancelable: true };
  if (typeof PointerEvent === 'function') {
    return new PointerEvent(type, eventOptions);
  }
  if (typeof MouseEvent === 'function') {
    return new MouseEvent(type, eventOptions);
  }
  return new Event(type, eventOptions);
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
  const hostFibersById = new Map<number, Fiber>();
  const elementIdByElement = new WeakMap<Element, number>();
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
  let isInteractionTrackingInitialized = false;
  let lastInteractionWasKeyboard = false;

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

  const setupInteractionTracking = () => {
    if (isInteractionTrackingInitialized || !isDocumentAvailable()) {
      return;
    }
    isInteractionTrackingInitialized = true;
    document.addEventListener(
      'keydown',
      () => {
        lastInteractionWasKeyboard = true;
      },
      true,
    );
    document.addEventListener(
      'pointerdown',
      () => {
        lastInteractionWasKeyboard = false;
      },
      true,
    );
    document.addEventListener(
      'mousedown',
      () => {
        lastInteractionWasKeyboard = false;
      },
      true,
    );
  };

  const resolveElementId = (element: Element): number | null => {
    const cachedId = elementIdByElement.get(element);
    if (cachedId != null) {
      return cachedId;
    }
    const fiber = getFiberFromHostInstance(element);
    if (!fiber) {
      return null;
    }
    const hostFiber = isHostFiber(fiber)
      ? fiber
      : getNearestHostFiber(fiber);
    if (!hostFiber) {
      return null;
    }
    const fiberId = getFiberId(hostFiber);
    elementIdByElement.set(element, fiberId);
    hostFibersById.set(fiberId, hostFiber);
    return fiberId;
  };

  const getElementForHostFiberId = (fiberId: number): Element | null => {
    const hostFiber = hostFibersById.get(fiberId);
    if (!hostFiber) {
      return null;
    }
    const currentFiber = getLatestFiber(hostFiber);
    const stateNode = currentFiber.stateNode;
    if (!isElement(stateNode)) {
      return null;
    }
    return stateNode;
  };

  const captureSelectorElementIds = (selector: string): number[] => {
    if (!isDocumentAvailable()) {
      return [];
    }
    try {
      const elements = Array.from(document.querySelectorAll(selector));
      const elementIds: number[] = [];
      for (const element of elements) {
        if (!isElement(element)) {
          continue;
        }
        const elementId = resolveElementId(element);
        if (elementId != null) {
          elementIds.push(elementId);
        }
      }
      return elementIds;
    } catch {
      return [];
    }
  };

  const capturePseudoClassSnapshot = (): PseudoClassSnapshot => {
    if (!isDocumentAvailable()) {
      return {
        focusedElementId: null,
        focusVisibleElementId: null,
        hoveredElementIds: [],
        activeElementIds: [],
      };
    }
    const hoveredElementIds = captureSelectorElementIds(':hover');
    const activeElementIds = captureSelectorElementIds(':active');
    const focusVisibleIds = captureSelectorElementIds(':focus-visible');
    const activeElement = document.activeElement;
    const focusedElementId = isElement(activeElement)
      ? resolveElementId(activeElement)
      : null;
    const focusVisibleElementId =
      focusVisibleIds.length > 0 ? focusVisibleIds[0] ?? null : null;
    return {
      focusedElementId,
      focusVisibleElementId,
      hoveredElementIds,
      activeElementIds,
    };
  };

  const captureAnimationSnapshots = (): ElementAnimationSnapshot[] => {
    if (!isDocumentAvailable()) {
      return [];
    }
    const animations = getDocumentAnimations();
    const animationsByElement = new Map<Element, AnimationStateSnapshot[]>();
    for (const animation of animations) {
      const effect = animation.effect;
      const target = isRecord(effect) ? Reflect.get(effect, 'target') : null;
      if (!isElement(target)) {
        continue;
      }
      const animationSnapshot: AnimationStateSnapshot = {
        id: typeof animation.id === 'string' ? animation.id : null,
        name: getAnimationName(animation),
        playState: animation.playState,
        currentTime:
          typeof animation.currentTime === 'number' ? animation.currentTime : null,
        playbackRate: animation.playbackRate,
        startTime:
          typeof animation.startTime === 'number' ? animation.startTime : null,
      };
      const existingSnapshots = animationsByElement.get(target) ?? [];
      existingSnapshots.push(animationSnapshot);
      animationsByElement.set(target, existingSnapshots);
    }
    const elementSnapshots: ElementAnimationSnapshot[] = [];
    for (const [element, animationSnapshots] of animationsByElement) {
      const elementId = resolveElementId(element);
      if (elementId == null) {
        continue;
      }
      elementSnapshots.push({
        elementId,
        animations: animationSnapshots,
      });
    }
    return elementSnapshots;
  };

  const applyPseudoClassSnapshot = (snapshot: PseudoClassSnapshot) => {
    if (!isDocumentAvailable()) {
      return;
    }
    const focusElement =
      snapshot.focusedElementId != null
        ? getElementForHostFiberId(snapshot.focusedElementId)
        : null;
    if (focusElement) {
      if (
        snapshot.focusVisibleElementId === snapshot.focusedElementId &&
        !lastInteractionWasKeyboard
      ) {
        lastInteractionWasKeyboard = true;
        const keyboardEvent =
          typeof KeyboardEvent === 'function'
            ? new KeyboardEvent('keydown', { bubbles: true })
            : new Event('keydown', { bubbles: true });
        document.dispatchEvent(keyboardEvent);
      }
      const focusMethod = Reflect.get(focusElement, 'focus');
      if (typeof focusMethod === 'function') {
        try {
          focusMethod.call(focusElement, { preventScroll: true });
        } catch {
          focusMethod.call(focusElement);
        }
      }
    }
    for (const hoveredElementId of snapshot.hoveredElementIds) {
      const hoveredElement = getElementForHostFiberId(hoveredElementId);
      if (hoveredElement) {
        hoveredElement.dispatchEvent(createPointerEvent('pointerover'));
        hoveredElement.dispatchEvent(createPointerEvent('mouseover'));
      }
    }
    for (const activeElementId of snapshot.activeElementIds) {
      const activeElement = getElementForHostFiberId(activeElementId);
      if (activeElement) {
        activeElement.dispatchEvent(createPointerEvent('pointerdown'));
        activeElement.dispatchEvent(createPointerEvent('mousedown'));
      }
    }
  };

  const applyAnimationSnapshots = (
    animationSnapshots: ElementAnimationSnapshot[],
  ) => {
    if (!isDocumentAvailable()) {
      return;
    }
    for (const elementSnapshot of animationSnapshots) {
      const element = getElementForHostFiberId(elementSnapshot.elementId);
      if (!element) {
        continue;
      }
      const animations = element.getAnimations();
      const usedAnimations = new Set<Animation>();
      elementSnapshot.animations.forEach((snapshot, index) => {
        let matchingAnimation: Animation | null = null;
        if (snapshot.id) {
          matchingAnimation =
            animations.find((animation) => animation.id === snapshot.id) ?? null;
        }
        if (!matchingAnimation && snapshot.name) {
          matchingAnimation =
            animations.find(
              (animation) => getAnimationName(animation) === snapshot.name,
            ) ?? null;
        }
        if (!matchingAnimation) {
          matchingAnimation = animations[index] ?? null;
        }
        if (!matchingAnimation || usedAnimations.has(matchingAnimation)) {
          return;
        }
        usedAnimations.add(matchingAnimation);
        if (snapshot.currentTime !== null) {
          try {
            matchingAnimation.currentTime = snapshot.currentTime;
          } catch {}
        }
        try {
          matchingAnimation.playbackRate = snapshot.playbackRate;
        } catch {}
        switch (snapshot.playState) {
          case 'paused':
            matchingAnimation.pause();
            break;
          case 'running':
            matchingAnimation.play();
            break;
          case 'finished':
            matchingAnimation.finish();
            break;
          case 'idle':
            matchingAnimation.cancel();
            break;
          default:
            break;
        }
      });
    }
  };

  const applyDomSnapshot = (domSnapshot: DomSnapshot | null) => {
    if (!domSnapshot) {
      return;
    }
    applyPseudoClassSnapshot(domSnapshot.pseudoClasses);
    applyAnimationSnapshots(domSnapshot.animations);
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
        if (isHostFiber(fiber) && isElement(fiber.stateNode)) {
          const hostFiberId = getFiberId(fiber);
          hostFibersById.set(hostFiberId, fiber);
          elementIdByElement.set(fiber.stateNode, hostFiberId);
        }
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
      domSnapshot: isDocumentAvailable()
        ? {
            pseudoClasses: capturePseudoClassSnapshot(),
            animations: captureAnimationSnapshots(),
          }
        : null,
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
    applyDomSnapshot(snapshot.domSnapshot);
  };

  const recordCommit = (rendererId: number, root: FiberRoot) => {
    getRenderer(rendererId);
    setupInteractionTracking();
    if (!isRecordingEnabled) {
      return;
    }
    captureSnapshot(rendererId, root);
  };

  const recordUnmount = (rendererId: number, fiber: Fiber) => {
    getRenderer(rendererId);
    const fiberId = getFiberId(fiber);
    latestFibersById.delete(fiberId);
    hostFibersById.delete(fiberId);
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
    hostFibersById.clear();
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
