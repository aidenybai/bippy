import { commitRoot } from "./commit.js";
import {
  HostComponentTag,
  HostPortalTag,
  HostTextTag,
  currentHostConfig,
  currentRootFiber,
  isComponentFiber,
} from "./constants.js";
import { renderWithHooks } from "./hooks.js";
import { mountChildFibers, reconcileChildFibers } from "./child-fibers.js";
import type { ReconcilerFiber, ReconcilerHostConfig, ReconcilerRoot } from "./types.js";

interface IdleDeadlineLike {
  didTimeout: boolean;
  timeRemaining(): number;
}

interface ScheduledWork {
  (deadline: IdleDeadlineLike): void;
}

interface ActPromise extends Promise<void> {
  resolve?: () => void;
}

export const suspendedPromises: Promise<unknown>[] = [];
let actPromise: ActPromise | null = null;

export const act = async <T>(scope: () => T | Promise<T>): Promise<T> => {
  let resolveActPromise: (() => void) | undefined;
  const pendingActPromise: ActPromise = new Promise((resolve) => {
    resolveActPromise = resolve;
  });
  pendingActPromise.resolve = resolveActPromise;
  actPromise = pendingActPromise;

  const value = await scope();
  flushSyncWork();
  await pendingActPromise;

  return value;
};

const workQueue: ScheduledWork[] = [];
let isFlushPending = false;

const requestHostCallback: (callback: (deadline: IdleDeadlineLike) => void) => void =
  typeof requestIdleCallback === "function"
    ? requestIdleCallback
    : (callback) =>
        setTimeout(() =>
          callback({ didTimeout: false, timeRemaining: () => Number.MAX_VALUE }),
        );

const finishIfIdle = (): void => {
  if (workQueue.length === 0 && suspendedPromises.length === 0 && actPromise?.resolve) {
    actPromise.resolve();
    actPromise.resolve = undefined;
  }
};

const flushQueue = (deadline: IdleDeadlineLike): void => {
  isFlushPending = true;
  while (deadline.timeRemaining() > 0 && workQueue.length > 0) {
    const work = workQueue.shift();
    work?.(deadline);
  }
  if (workQueue.length > 0) {
    requestHostCallback(flushQueue);
  } else {
    isFlushPending = false;
    finishIfIdle();
  }
};

const infiniteDeadline: IdleDeadlineLike = {
  didTimeout: false,
  timeRemaining: () => Number.MAX_VALUE,
};

export const flushSyncWork = (): void => {
  isFlushPending = true;
  while (workQueue.length > 0) {
    const work = workQueue.shift();
    work?.(infiniteDeadline);
  }
  isFlushPending = false;
  finishIfIdle();
};

export const startTransition = (work: ScheduledWork): void => {
  workQueue.push(work);
  if (!isFlushPending) requestHostCallback(flushQueue);
};

export const deletions: ReconcilerFiber[] = [];

let workInProgressRoot: ReconcilerFiber | null = null;
let nextUnitOfWork: ReconcilerFiber | null = null;

export const getRootFiber = (fiber: ReconcilerFiber): ReconcilerFiber => {
  let rootFiber = fiber;
  while (rootFiber.return !== null) rootFiber = rootFiber.return;
  return rootFiber;
};

export const scheduleUpdateOnFiber = (oldFiber: ReconcilerFiber): void => {
  startTransition((deadline: IdleDeadlineLike) => {
    const rootFiber = getRootFiber(oldFiber);
    const root = rootFiber.stateNode as ReconcilerRoot;
    const rootConfig = rootHostConfigs.get(root);
    if (rootConfig) {
      currentRootFiber.current = rootFiber;
      currentHostConfig.current = rootConfig;
    }
    const newFiber: ReconcilerFiber = {
      ...oldFiber,
      alternate: oldFiber,
    };
    nextUnitOfWork = newFiber;
    workInProgressRoot = newFiber;

    performWorkUntilDeadline(deadline);
  });
};

const beginWork = (current: ReconcilerFiber | null, workInProgress: ReconcilerFiber): void => {
  const containerInfo = (currentRootFiber.current.stateNode as ReconcilerRoot).containerInfo;
  if (workInProgress.tag === HostComponentTag) {
    workInProgress.stateNode ??= currentHostConfig.current.createInstance(
      workInProgress.type,
      workInProgress.pendingProps,
      containerInfo,
      null,
      workInProgress,
    );
  } else if (workInProgress.tag === HostTextTag) {
    workInProgress.stateNode ??= currentHostConfig.current.createTextInstance(
      String(workInProgress.pendingProps.text),
      containerInfo,
      null,
      workInProgress,
    );
  } else if (workInProgress.tag === HostPortalTag) {
    const portalContainerInfo = (workInProgress.stateNode ??=
      workInProgress.pendingProps.containerInfo);
    if (current === null) currentHostConfig.current.preparePortalMount?.(portalContainerInfo);
  }

  const children = isComponentFiber(workInProgress)
    ? renderWithHooks(current, workInProgress, workInProgress.type)
    : workInProgress.pendingProps.children;

  if (current === null) mountChildFibers(current, workInProgress, children);
  else reconcileChildFibers(current, workInProgress, children);
};

const performUnitOfWork = (unitOfWork: ReconcilerFiber): ReconcilerFiber | null => {
  beginWork(unitOfWork.alternate, unitOfWork);
  if (unitOfWork.child !== null) {
    return unitOfWork.child;
  }

  let completedWork: ReconcilerFiber | null = unitOfWork;
  while (completedWork !== null) {
    if (completedWork.sibling !== null) {
      return completedWork.sibling;
    }
    completedWork = completedWork.return;
  }
  return null;
};

const pendingRootFibers: ReconcilerFiber[] = [];
const rootHostConfigs = new Map<ReconcilerRoot, ReconcilerHostConfig>();

export const setRootHostConfig = (
  root: ReconcilerRoot,
  config: ReconcilerHostConfig,
): void => {
  rootHostConfigs.set(root, config);
};

const performWorkUntilDeadline = (deadline: IdleDeadlineLike): void => {
  while (nextUnitOfWork !== null && deadline.timeRemaining() > 0) {
    nextUnitOfWork = performUnitOfWork(nextUnitOfWork);
  }

  if (nextUnitOfWork !== null) return startTransition(performWorkUntilDeadline);

  if (workInProgressRoot !== null) {
    commitRoot(workInProgressRoot, deletions);
    workInProgressRoot = null;
  } else {
    const nextRootFiber = pendingRootFibers.shift();
    if (nextRootFiber === undefined) return;
    currentRootFiber.current = nextRootFiber;

    currentHostConfig.current = rootHostConfigs.get(nextRootFiber.stateNode as ReconcilerRoot)!;
    nextUnitOfWork = nextRootFiber;
    workInProgressRoot = nextRootFiber;

    return startTransition(performWorkUntilDeadline);
  }
};

export const scheduleRoot = (rootFiber: ReconcilerFiber): void => {
  pendingRootFibers.push(rootFiber);
  startTransition(performWorkUntilDeadline);
};
