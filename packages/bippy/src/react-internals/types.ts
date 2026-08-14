import type { ReactNode } from "react";
import type ReactReconciler from "react-reconciler";
import type { HostWorkTag, ReactWorkTag } from "./generated/react-work-tags.js";

export type WorkTag = ReactReconciler.WorkTag | ReactWorkTag;

export interface Source extends ReactReconciler.Source {}

export interface ReactContext<T> extends ReactReconciler.ReactContext<T> {}

// HACK: React 17 exposes observedBits while React 18+ exposes memoizedValue on context dependencies.
export interface ContextDependency<T> extends Omit<
  ReactReconciler.ContextDependency<T>,
  "observedBits"
> {
  memoizedValue?: T;
  observedBits?: number;
}

export interface DebugThenableState {
  thenables?: unknown[];
}

export interface Dependencies extends Omit<ReactReconciler.Dependencies, "firstContext"> {
  _debugThenableState?: DebugThenableState | unknown[];
  firstContext: ContextDependency<unknown> | null;
}

export interface ServerComponentInfo {
  name?: string;
  env?: string;
  owner?: Fiber | ServerComponentInfo | null;
  debugStack?: Error | null;
}

export interface ReactDebugInfo {
  debugLocation?: unknown;
  env?: string;
  name?: string;
}

export interface ReactMemoCache {
  data: unknown[][];
  index: number;
}

export interface FiberDebugSource extends Source {
  columnNumber?: number;
}

export interface FiberUpdateQueue {
  [key: string]: unknown;
  memoCache?: ReactMemoCache;
}

// HACK: @types/react-reconciler does not yet include React 19 debug fields or recursive server owners.
export interface Fiber<T = unknown> extends Omit<
  ReactReconciler.Fiber,
  | "alternate"
  | "_debugOwner"
  | "_debugSource"
  | "child"
  | "deletions"
  | "dependencies"
  | "memoizedProps"
  | "memoizedState"
  | "pendingProps"
  | "return"
  | "sibling"
  | "stateNode"
  | "tag"
  | "updateQueue"
> {
  _debugInfo?: ReactDebugInfo[];
  _debugOwner?: Fiber | ServerComponentInfo | null;
  _debugSource?: FiberDebugSource | null;
  _debugStack?: Error & { stack: string };
  alternate: Fiber | null;
  child: Fiber | null;
  deletions: Fiber[] | null;
  dependencies: Dependencies | null;
  effectTag?: number;
  memoizedProps: Props;
  memoizedState: MemoizedState | null;
  pendingProps: Props;
  return: Fiber | null;
  sibling: Fiber | null;
  stateNode: T;
  tag: WorkTag;
  updateQueue: FiberUpdateQueue | null;
}

export interface HostFiber<T = unknown> extends Fiber<T> {
  tag: HostWorkTag;
}

export interface FiberRoot {
  current: Fiber;
}

export interface MemoizedState {
  [key: string]: unknown;
  memoizedState: unknown;
  next: MemoizedState | null;
}

export interface Props {
  [key: string]: unknown;
}

export interface ReactDevToolsEventHandler {
  (data: unknown): void;
}

export interface ReactDevToolsGlobalHook {
  _instrumentationIsActive?: boolean;
  _instrumentationSource?: string;
  checkDCE: (fn: unknown) => void;
  emit?: (event: string, data?: unknown) => void;
  getFiberRoots?: (rendererID: number) => Set<FiberRoot>;
  hasUnsupportedRendererAttached: boolean;
  inject: (renderer: ReactRenderer) => number;
  off?: (event: string, handler: ReactDevToolsEventHandler) => void;
  on: (event: string, handler: ReactDevToolsEventHandler) => void;
  onCommitFiberRoot: (
    rendererID: number,
    root: FiberRoot,
    priority: number | void,
    didError?: boolean,
  ) => void;
  onCommitFiberUnmount: (rendererID: number, fiber: Fiber) => void;
  onPostCommitFiberRoot: (rendererID: number, root: FiberRoot) => void;
  onScheduleFiberRoot?: (rendererID: number, root: FiberRoot, children: ReactNode) => void;
  renderers: Map<number, ReactRenderer>;
  sub?: (event: string, handler: ReactDevToolsEventHandler) => () => void;
  supportsFiber: boolean;
  supportsFlight: boolean;
}

export interface LegacyDispatcherRef {
  current: unknown;
}

export interface CurrentDispatcherRef {
  H: unknown;
}

export type RendererDispatcherRef = CurrentDispatcherRef | LegacyDispatcherRef;

export interface ReactRenderer extends Omit<
  ReactReconciler.DevToolsConfig<unknown, unknown, unknown>,
  "findFiberByHostInstance"
> {
  currentDispatcherRef?: RendererDispatcherRef | null;
  findFiberByHostInstance?: (hostInstance: unknown) => Fiber | null;
  getCurrentFiber?: () => Fiber | null;
  overrideContext?: (fiber: Fiber, contextType: unknown, path: string[], value: unknown) => void;

  overrideHookState?: (fiber: Fiber, id: number, path: string[], value: unknown) => void;
  overrideHookStateDeletePath?: (fiber: Fiber, id: number, path: Array<number | string>) => void;
  overrideHookStateRenamePath?: (
    fiber: Fiber,
    id: number,
    oldPath: Array<number | string>,
    newPath: Array<number | string>,
  ) => void;
  overrideProps?: (fiber: Fiber, path: string[], value: unknown) => void;
  overridePropsDeletePath?: (fiber: Fiber, path: Array<number | string>) => void;
  overridePropsRenamePath?: (
    fiber: Fiber,
    oldPath: Array<number | string>,
    newPath: Array<number | string>,
  ) => void;
  reconcilerVersion?: string;
  scheduleRetry?: (fiber: Fiber) => void;
  scheduleRoot?: (root: FiberRoot, element: React.ReactNode) => void;
  scheduleUpdate?: (fiber: Fiber) => void;

  setErrorHandler?: (newShouldErrorImpl: (fiber: Fiber) => boolean | null) => void;
  setSuspenseHandler?: (newShouldSuspendImpl: (fiber: Fiber) => boolean) => void;
}

declare global {
  // eslint-disable-next-line no-var
  var __REACT_DEVTOOLS_GLOBAL_HOOK__: ReactDevToolsGlobalHook | undefined;
}
