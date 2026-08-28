import * as React from "react";
import { getRDTHook } from "../rdt-hook.js";
import type { FiberRoot, ReactRenderer } from "../react-internals/index.js";
import { createFiber } from "./child-fibers.js";
import {
  HostRootTag,
  REACT_PORTAL_TYPE,
  isComponentFiber,
  reactDispatcherRef,
} from "./constants.js";
import {
  flushSyncWork,
  scheduleRoot,
  setRootHostConfig,
  startTransition,
} from "./scheduler.js";
import type {
  ReconcilerDevToolsConfig,
  ReconcilerFiber,
  ReconcilerHostConfig,
  ReconcilerRoot,
} from "./types.js";

export { act, flushSyncWork, startTransition } from "./scheduler.js";
export type {
  ReconcilerDevToolsConfig,
  ReconcilerEffect,
  ReconcilerFiber,
  ReconcilerHook,
  ReconcilerHostConfig,
  ReconcilerRoot,
} from "./types.js";

export interface Reconciler {
  createContainer(containerInfo: unknown, ...rest: unknown[]): ReconcilerRoot;
  updateContainer(
    element: React.ReactNode,
    root: ReconcilerRoot,
    parentComponent?: unknown,
    callback?: (() => void) | null,
  ): void;
  updateContainerSync(
    element: React.ReactNode,
    root: ReconcilerRoot,
    parentComponent?: unknown,
    callback?: (() => void) | null,
  ): void;
  createPortal(
    children: React.ReactNode,
    containerInfo: unknown,
    implementation?: unknown,
    key?: string | null,
  ): React.ReactPortal;
  getPublicRootInstance(root: ReconcilerRoot): unknown;
  flushSync<R>(fn?: () => R): R | undefined;
  flushSyncWork(): void;
  flushPassiveEffects(): boolean;
  injectIntoDevTools(devToolsConfig?: Partial<ReconcilerDevToolsConfig>): boolean;
}

const findHostInstance = (fiber: ReconcilerFiber | null): unknown => {
  if (fiber === null) return null;
  if (!isComponentFiber(fiber) && fiber.tag !== HostRootTag && fiber.stateNode !== null) {
    return fiber.stateNode;
  }
  return findHostInstance(fiber.child);
};

export const createReconciler = (config: ReconcilerHostConfig): Reconciler => {
  let rendererId: number | null = null;

  const notifyDevToolsCommit = (root: ReconcilerRoot): void => {
    if (rendererId === null) return;
    getRDTHook().onCommitFiberRoot(rendererId, root as unknown as FiberRoot, undefined, false);
  };

  const updateContainerImpl = (
    element: React.ReactNode,
    root: ReconcilerRoot,
    callback?: (() => void) | null,
  ): void => {
    setRootHostConfig(root, config);
    root.pendingChildren = element;
    root.onCommit = notifyDevToolsCommit;

    const currentRootFiber = root.current;
    const workInProgressRootFiber: ReconcilerFiber =
      currentRootFiber.alternate ?? createFiber({ tag: HostRootTag, stateNode: root });
    workInProgressRootFiber.stateNode = root;
    workInProgressRootFiber.pendingProps = { children: [element] };
    workInProgressRootFiber.memoizedState = currentRootFiber.memoizedState;
    workInProgressRootFiber.child = currentRootFiber.child;
    workInProgressRootFiber.effects = currentRootFiber.effects;
    if (workInProgressRootFiber !== currentRootFiber) {
      workInProgressRootFiber.alternate = currentRootFiber;
      currentRootFiber.alternate = workInProgressRootFiber;
    }

    scheduleRoot(workInProgressRootFiber);

    if (callback) startTransition(callback);
  };

  return {
    createContainer: (containerInfo: unknown): ReconcilerRoot => {
      const hostRootFiber = createFiber({ tag: HostRootTag });
      const root: ReconcilerRoot = {
        containerInfo,
        current: hostRootFiber,
        pendingChildren: null,
        onCommit: null,
      };
      hostRootFiber.stateNode = root;
      setRootHostConfig(root, config);
      return root;
    },
    updateContainer: (element, root, _parentComponent, callback) => {
      updateContainerImpl(element, root, callback);
    },
    updateContainerSync: (element, root, _parentComponent, callback) => {
      updateContainerImpl(element, root, callback);
      flushSyncWork();
    },
    createPortal: (children, containerInfo, implementation, key) =>
      ({
        $$typeof: REACT_PORTAL_TYPE,
        key: key ?? null,
        children,
        containerInfo,
        implementation,
      }) as unknown as React.ReactPortal,
    getPublicRootInstance: (root) => {
      const hostInstance = findHostInstance(root.current.child);
      return hostInstance === null ? null : config.getPublicInstance(hostInstance);
    },
    flushSync: <R>(fn?: () => R): R | undefined => {
      const result = fn?.();
      flushSyncWork();
      return result;
    },
    flushSyncWork,
    flushPassiveEffects: () => {
      flushSyncWork();
      return true;
    },
    injectIntoDevTools: (devToolsConfig) => {
      const rdtHook = getRDTHook();
      const renderer = {
        bundleType: devToolsConfig?.bundleType ?? 0,
        version: devToolsConfig?.version ?? React.version,
        rendererPackageName: devToolsConfig?.rendererPackageName ?? "bippy-reconciler",
        rendererConfig: devToolsConfig?.rendererConfig,
        findFiberByHostInstance: devToolsConfig?.findFiberByHostInstance,
        currentDispatcherRef: reactDispatcherRef,
        reconcilerVersion: React.version,
      };
      rendererId = rdtHook.inject(renderer as unknown as ReactRenderer);
      return rendererId !== null;
    },
  };
};

export const version = React.version;
