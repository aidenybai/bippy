import type { ReactNode } from "react";

// @types/react-reconciler uses `export = ReactReconciler` (CJS namespace),
// which downstream bundlers can't resolve as ESM exports. These types are
// inlined from @types/react-reconciler@0.28 to avoid the dependency.

// Simple type aliases — most are opaque in the original
export type BundleType = 0 | 1;
export type Flags = number;
export type Lanes = number;
export type TypeOfMode = number;
export type RootTag = 0 | 1 | 2;
export type LanePriority =
  | 0
  | 1
  | 2
  | 3
  | 4
  | 5
  | 6
  | 7
  | 8
  | 9
  | 10
  | 11
  | 12
  | 13
  | 14
  | 15
  | 16
  | 17;
export type WorkTag =
  | 0
  | 1
  | 2
  | 3
  | 4
  | 5
  | 6
  | 7
  | 8
  | 9
  | 10
  | 11
  | 12
  | 13
  | 14
  | 15
  | 16
  | 17
  | 18
  | 19
  | 20
  | 21
  | 22
  | 23
  | 24;
export type HookType =
  | "useState"
  | "useReducer"
  | "useContext"
  | "useRef"
  | "useEffect"
  | "useLayoutEffect"
  | "useCallback"
  | "useMemo"
  | "useImperativeHandle"
  | "useDebugValue"
  | "useDeferredValue"
  | "useTransition"
  | "useMutableSource"
  | "useOpaqueIdentifier"
  | "useCacheRefresh";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type FiberRoot = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type MutableSource = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type OpaqueHandle = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type OpaqueRoot = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type React$AbstractComponent<_Config, _Instance = unknown> = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type HostConfig = Record<string, any>;

// Structural interfaces
export interface Source {
  fileName: string;
  lineNumber: number;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface RefObject {
  current: any;
}
export interface Thenable<T> {
  then(resolve: () => T, reject?: () => T): T;
}

export interface ReactContext<T> {
  $$typeof: symbol | number;
  Consumer: ReactContext<T>;
  Provider: ReactProviderType<T>;
  _calculateChangedBits: ((a: T, b: T) => number) | null;
  _currentValue: T;
  _currentValue2: T;
  _threadCount: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _currentRenderer?: Record<string, any> | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _currentRenderer2?: Record<string, any> | null;
  displayName?: string;
}

export interface ReactProviderType<T> {
  $$typeof: symbol | number;
  _context: ReactContext<T>;
}
export interface ReactProvider<T> {
  $$typeof: symbol | number;
  type: ReactProviderType<T>;
  key: null | string;
  ref: null;
  props: { value: T; children?: ReactNode };
}
export interface ReactConsumer<T> {
  $$typeof: symbol | number;
  type: ReactContext<T>;
  key: null | string;
  ref: null;
  props: { children: (value: T) => ReactNode; unstable_observedBits?: number };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface ReactPortal {
  $$typeof: symbol | number;
  key: null | string;
  containerInfo: any;
  children: ReactNode;
  implementation: any;
}

export interface ComponentSelector {
  $$typeof: symbol | number;
  value: React$AbstractComponent<never, unknown>;
}
export interface HasPseudoClassSelector {
  $$typeof: symbol | number;
  value: Selector[];
}
export interface RoleSelector {
  $$typeof: symbol | number;
  value: string;
}
export interface TextSelector {
  $$typeof: symbol | number;
  value: string;
}
export interface TestNameSelector {
  $$typeof: symbol | number;
  value: string;
}
export type Selector =
  | ComponentSelector
  | HasPseudoClassSelector
  | RoleSelector
  | TextSelector
  | TestNameSelector;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface DevToolsConfig<
  Instance = any,
  TextInstance = any,
  RendererInspectionConfig = any,
> {
  bundleType: BundleType;
  version: string;
  rendererPackageName: string;
  findFiberByHostInstance?: (instance: Instance | TextInstance) => ReactFiber | null;
  rendererConfig?: RendererInspectionConfig;
}

export interface SuspenseHydrationCallbacks<SuspenseInstance = unknown> {
  onHydrated?: (suspenseInstance: SuspenseInstance) => void;
  onDeleted?: (suspenseInstance: SuspenseInstance) => void;
}

export interface TransitionTracingCallbacks {
  onTransitionStart?: (transitionName: string, startTime: number) => void;
  onTransitionProgress?: (
    transitionName: string,
    startTime: number,
    currentTime: number,
    pending: Array<{ name: null | string }>,
  ) => void;
  onTransitionIncomplete?: (
    transitionName: string,
    startTime: number,
    deletions: Array<{ type: string; name?: string; newName?: string; endTime: number }>,
  ) => void;
  onTransitionComplete?: (transitionName: string, startTime: number, endTime: number) => void;
  onMarkerProgress?: (
    transitionName: string,
    marker: string,
    startTime: number,
    currentTime: number,
    pending: Array<{ name: null | string }>,
  ) => void;
  onMarkerIncomplete?: (
    transitionName: string,
    marker: string,
    startTime: number,
    deletions: Array<{ type: string; name?: string; newName?: string; endTime: number }>,
  ) => void;
  onMarkerComplete?: (
    transitionName: string,
    marker: string,
    startTime: number,
    endTime: number,
  ) => void;
}

// The base Fiber interface from react-reconciler, used to derive bippy's Fiber below
interface ReactFiber {
  tag: WorkTag;
  key: null | string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  elementType: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  stateNode: any;
  return: ReactFiber | null;
  child: ReactFiber | null;
  sibling: ReactFiber | null;
  index: number;
  ref: null | (((handle: unknown) => void) & { _stringRef?: string | null }) | RefObject;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pendingProps: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  memoizedProps: any;
  updateQueue: unknown;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  memoizedState: any;
  dependencies: Dependencies | null;
  mode: TypeOfMode;
  flags: Flags;
  subtreeFlags: Flags;
  deletions: ReactFiber[] | null;
  nextEffect: ReactFiber | null;
  firstEffect: ReactFiber | null;
  lastEffect: ReactFiber | null;
  lanes: Lanes;
  childLanes: Lanes;
  alternate: ReactFiber | null;
  actualDuration?: number;
  actualStartTime?: number;
  selfBaseDuration?: number;
  treeBaseDuration?: number;
  _debugID?: number;
  _debugSource?: Source | null;
  _debugOwner?: ReactFiber | null;
  _debugIsCurrentlyTiming?: boolean;
  _debugNeedsRemount?: boolean;
  _debugHookTypes?: HookType[] | null;
}

// ── bippy types (not from react-reconciler) ──

export interface ContextDependency<T> {
  context: ReactContext<T>;
  memoizedValue: T;
  next: ContextDependency<unknown> | null;
  observedBits: number;
}

export interface Dependencies {
  firstContext: ContextDependency<unknown> | null;
  lanes: Lanes;
}

export interface Effect {
  [key: string]: unknown;
  create: (...args: unknown[]) => unknown;
  deps: null | unknown[];
  destroy: ((...args: unknown[]) => unknown) | null;
  next: Effect | null;
  tag: number;
}

export interface Family {
  current: unknown;
}

/**
 * Represents a react-internal Fiber node.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Fiber<T = any> = Omit<
  ReactFiber,
  | "alternate"
  | "child"
  | "dependencies"
  | "memoizedProps"
  | "memoizedState"
  | "pendingProps"
  | "return"
  | "sibling"
  | "stateNode"
  | "updateQueue"
> & {
  _debugInfo?: Array<{
    debugLocation?: unknown;
    env?: string;
    name?: string;
  }>;
  _debugOwner?: Fiber;
  // react <19
  _debugSource?: {
    columnNumber?: number;
    fileName: string;
    lineNumber: number;
  };
  // react 19+
  // https://github.com/facebook/react/issues/29092?utm_source=chatgpt.com
  _debugStack?: Error & { stack: string };
  alternate: Fiber | null;
  child: Fiber | null;
  dependencies: Dependencies | null;
  memoizedProps: Props;
  memoizedState: MemoizedState;
  pendingProps: Props;

  return: Fiber | null;
  sibling: Fiber | null;
  stateNode: T;
  updateQueue: {
    [key: string]: unknown;
    lastEffect: Effect | null;
  };
};

export interface MemoizedState {
  [key: string]: unknown;
  memoizedState: unknown;
  next: MemoizedState | null;
}

export interface Props {
  [key: string]: unknown;
}

export interface ReactDevToolsGlobalHook {
  _instrumentationIsActive?: boolean;
  _instrumentationSource?: string;
  checkDCE: (fn: unknown) => void;
  hasUnsupportedRendererAttached: boolean;
  inject: (renderer: ReactRenderer) => number;
  // https://github.com/aidenybai/bippy/issues/43
  on: () => void;
  onCommitFiberRoot: (rendererID: number, root: FiberRoot, priority: number | void) => void;
  onCommitFiberUnmount: (rendererID: number, fiber: Fiber) => void;
  onPostCommitFiberRoot: (rendererID: number, root: FiberRoot) => void;
  renderers: Map<number, ReactRenderer>;
  supportsFiber: boolean;

  supportsFlight: boolean;
}

// https://github.com/facebook/react/blob/6a4b46cd70d2672bc4be59dcb5b8dede22ed0cef/packages/react-devtools-shared/src/backend/types.js
export interface ReactRenderer {
  bundleType: 0 /* PROD */ | 1 /* DEV */;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  currentDispatcherRef: any;
  // dev only: https://github.com/facebook/react/blob/main/packages/react-reconciler/src/ReactFiberReconciler.js#L842
  findFiberByHostInstance?: (hostInstance: unknown) => Fiber | null;
  // react devtools
  getCurrentFiber?: (fiber: Fiber) => Fiber | null;
  overrideContext?: (fiber: Fiber, contextType: unknown, path: string[], value: unknown) => void;

  overrideHookState?: (fiber: Fiber, id: string, path: string[], value: unknown) => void;
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
  reconcilerVersion: string;
  rendererPackageName: string;
  // react refresh
  scheduleRefresh?: (
    root: FiberRoot,
    update: {
      staleFamilies: Set<Family>;
      updatedFamilies: Set<Family>;
    },
  ) => void;
  scheduleRoot?: (root: FiberRoot, element: React.ReactNode) => void;
  scheduleUpdate?: (fiber: Fiber) => void;

  setErrorHandler?: (newShouldErrorImpl: (fiber: Fiber) => boolean) => void;
  setRefreshHandler?: (handler: ((fiber: Fiber) => Family | null) | null) => void;
  setSuspenseHandler?: (newShouldSuspendImpl: (suspenseInstance: unknown) => void) => void;

  version: string;
}

declare global {
  // eslint-disable-next-line no-var
  var __REACT_DEVTOOLS_GLOBAL_HOOK__: ReactDevToolsGlobalHook | undefined;
}
