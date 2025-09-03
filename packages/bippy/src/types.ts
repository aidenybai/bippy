import type {
  HostConfig,
  Thenable,
  RootTag,
  WorkTag,
  HookType,
  Source,
  LanePriority,
  Lanes,
  Flags,
  TypeOfMode,
  ReactProvider,
  ReactProviderType,
  ReactConsumer,
  ReactContext,
  ReactPortal,
  RefObject,
  Fiber as ReactFiber,
  FiberRoot,
  MutableSource,
  OpaqueHandle,
  OpaqueRoot,
  BundleType,
  DevToolsConfig,
  SuspenseHydrationCallbacks,
  TransitionTracingCallbacks,
  ComponentSelector,
  HasPseudoClassSelector,
  RoleSelector,
  TextSelector,
  TestNameSelector,
  Selector,
  React$AbstractComponent,
} from 'react-reconciler';

export type {
  HostConfig,
  Thenable,
  RootTag,
  WorkTag,
  HookType,
  Source,
  LanePriority,
  Lanes,
  Flags,
  TypeOfMode,
  ReactProvider,
  ReactProviderType,
  ReactConsumer,
  ReactContext,
  ReactPortal,
  RefObject,
  FiberRoot,
  MutableSource,
  OpaqueHandle,
  OpaqueRoot,
  BundleType,
  DevToolsConfig,
  SuspenseHydrationCallbacks,
  TransitionTracingCallbacks,
  ComponentSelector,
  HasPseudoClassSelector,
  RoleSelector,
  TextSelector,
  TestNameSelector,
  Selector,
  React$AbstractComponent,
};

export interface ReactDevToolsGlobalHook {
  checkDCE: (fn: unknown) => void;
  supportsFiber: boolean;
  supportsFlight: boolean;
  renderers: Map<number, ReactRenderer>;
  hasUnsupportedRendererAttached: boolean;
  onCommitFiberRoot: (
    rendererID: number,
    root: FiberRoot,
    priority: void | number
  ) => void;
  onCommitFiberUnmount: (rendererID: number, fiber: Fiber) => void;
  onPostCommitFiberRoot: (rendererID: number, root: FiberRoot) => void;
  inject: (renderer: ReactRenderer) => number;
  _instrumentationSource?: string;
  _instrumentationIsActive?: boolean;

  // https://github.com/aidenybai/bippy/issues/43
  on: () => void;
}

/**
 * Represents a react-internal Fiber node.
 */
// biome-ignore lint/suspicious/noExplicitAny: stateNode is not typed in react-reconciler
export type Fiber<T = any> = Omit<
  ReactFiber,
  | 'stateNode'
  | 'dependencies'
  | 'child'
  | 'sibling'
  | 'return'
  | 'alternate'
  | 'memoizedProps'
  | 'pendingProps'
  | 'memoizedState'
  | 'updateQueue'
> & {
  stateNode: T;
  dependencies: Dependencies | null;
  child: Fiber | null;
  sibling: Fiber | null;
  return: Fiber | null;
  alternate: Fiber | null;
  memoizedProps: Props;
  pendingProps: Props;
  memoizedState: MemoizedState;
  updateQueue: {
    lastEffect: Effect | null;
    [key: string]: unknown;
  };

  // dev only
  _debugSource?: {
    fileName: string;
    lineNumber: number;
    columnNumber?: number;
  };
  _debugStack?: Error;
  _debugOwner?: Fiber;
  _debugInfo?: Array<{
    name?: string;
    env?: string;
    debugLocation?: unknown;
  }>;
};

export interface Family {
  current: unknown;
}

// https://github.com/facebook/react/blob/6a4b46cd70d2672bc4be59dcb5b8dede22ed0cef/packages/react-devtools-shared/src/backend/types.js
export interface ReactRenderer {
  version: string;
  bundleType: 0 /* PROD */ | 1 /* DEV */;
  // biome-ignore lint/suspicious/noExplicitAny: ReactSharedInternals
  currentDispatcherRef: any;
  reconcilerVersion: string;
  rendererPackageName: string;

  // dev only: https://github.com/facebook/react/blob/main/packages/react-reconciler/src/ReactFiberReconciler.js#L842
  findFiberByHostInstance?: (hostInstance: unknown) => Fiber | null;
  overrideHookState?: (
    fiber: Fiber,
    id: string,
    path: string[],
    value: unknown
  ) => void;
  overrideProps?: (fiber: Fiber, path: string[], value: unknown) => void;
  overrideContext?: (
    fiber: Fiber,
    contextType: unknown,
    path: string[],
    value: unknown
  ) => void;
  overrideHookStateDeletePath?: (
    fiber: Fiber,
    id: number,
    path: Array<string | number>
  ) => void;
  overrideHookStateRenamePath?: (
    fiber: Fiber,
    id: number,
    oldPath: Array<string | number>,
    newPath: Array<string | number>
  ) => void;
  overridePropsDeletePath?: (
    fiber: Fiber,
    path: Array<string | number>
  ) => void;
  overridePropsRenamePath?: (
    fiber: Fiber,
    oldPath: Array<string | number>,
    newPath: Array<string | number>
  ) => void;
  scheduleUpdate?: (fiber: Fiber) => void;
  setErrorHandler?: (newShouldErrorImpl: (fiber: Fiber) => boolean) => void;
  setSuspenseHandler?: (
    newShouldSuspendImpl: (suspenseInstance: unknown) => void
  ) => void;

  // react refresh
  scheduleRefresh?: (
    root: FiberRoot,
    update: {
      staleFamilies: Set<Family>;
      updatedFamilies: Set<Family>;
    }
  ) => void;
  scheduleRoot?: (root: FiberRoot, element: React.ReactNode) => void;
  setRefreshHandler?: (
    handler: ((fiber: Fiber) => Family | null) | null
  ) => void;

  // react devtools
  getCurrentFiber?: (fiber: Fiber) => Fiber | null;
}

export interface ContextDependency<T> {
  context: ReactContext<T>;
  memoizedValue: T;
  observedBits: number;
  next: ContextDependency<unknown> | null;
}

export interface Dependencies {
  lanes: Lanes;
  firstContext: ContextDependency<unknown> | null;
}

export interface Effect {
  next: Effect | null;
  create: (...args: unknown[]) => unknown;
  destroy: ((...args: unknown[]) => unknown) | null;
  deps: unknown[] | null;
  tag: number;
  [key: string]: unknown;
}

export interface MemoizedState {
  memoizedState: unknown;
  next: MemoizedState | null;
  [key: string]: unknown;
}

export interface Props {
  [key: string]: unknown;
}

declare global {
  var __REACT_DEVTOOLS_GLOBAL_HOOK__: ReactDevToolsGlobalHook | undefined;
}
