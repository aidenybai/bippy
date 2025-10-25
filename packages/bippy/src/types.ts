import type {
  BundleType,
  ComponentSelector,
  DevToolsConfig,
  FiberRoot,
  Flags,
  HasPseudoClassSelector,
  HookType,
  HostConfig,
  LanePriority,
  Lanes,
  MutableSource,
  OpaqueHandle,
  OpaqueRoot,
  React$AbstractComponent,
  ReactConsumer,
  ReactContext,
  Fiber as ReactFiber,
  ReactPortal,
  ReactProvider,
  ReactProviderType,
  RefObject,
  RoleSelector,
  RootTag,
  Selector,
  Source,
  SuspenseHydrationCallbacks,
  TestNameSelector,
  TextSelector,
  Thenable,
  TransitionTracingCallbacks,
  TypeOfMode,
  WorkTag,
} from 'react-reconciler';

export type {
  BundleType,
  ComponentSelector,
  DevToolsConfig,
  FiberRoot,
  Flags,
  HasPseudoClassSelector,
  HookType,
  HostConfig,
  LanePriority,
  Lanes,
  MutableSource,
  OpaqueHandle,
  OpaqueRoot,
  React$AbstractComponent,
  ReactConsumer,
  ReactContext,
  ReactPortal,
  ReactProvider,
  ReactProviderType,
  RefObject,
  RoleSelector,
  RootTag,
  Selector,
  Source,
  SuspenseHydrationCallbacks,
  TestNameSelector,
  TextSelector,
  Thenable,
  TransitionTracingCallbacks,
  TypeOfMode,
  WorkTag,
};

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
  | 'alternate'
  | 'child'
  | 'dependencies'
  | 'memoizedProps'
  | 'memoizedState'
  | 'pendingProps'
  | 'return'
  | 'sibling'
  | 'stateNode'
  | 'updateQueue'
> & {
  _debugInfo?: Array<{
    debugLocation?: unknown;
    env?: string;
    name?: string;
  }>;
  _debugOwner?: Fiber;
  // dev only
  _debugSource?: {
    columnNumber?: number;
    fileName: string;
    lineNumber: number;
  };
  _debugStack?: Error;
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
  onCommitFiberRoot: (
    rendererID: number,
    root: FiberRoot,
    priority: number | void
  ) => void;
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
  overrideContext?: (
    fiber: Fiber,
    contextType: unknown,
    path: string[],
    value: unknown
  ) => void;

  overrideHookState?: (
    fiber: Fiber,
    id: string,
    path: string[],
    value: unknown
  ) => void;
  overrideHookStateDeletePath?: (
    fiber: Fiber,
    id: number,
    path: Array<number | string>
  ) => void;
  overrideHookStateRenamePath?: (
    fiber: Fiber,
    id: number,
    oldPath: Array<number | string>,
    newPath: Array<number | string>
  ) => void;
  overrideProps?: (fiber: Fiber, path: string[], value: unknown) => void;
  overridePropsDeletePath?: (
    fiber: Fiber,
    path: Array<number | string>
  ) => void;
  overridePropsRenamePath?: (
    fiber: Fiber,
    oldPath: Array<number | string>,
    newPath: Array<number | string>
  ) => void;
  reconcilerVersion: string;
  rendererPackageName: string;
  // react refresh
  scheduleRefresh?: (
    root: FiberRoot,
    update: {
      staleFamilies: Set<Family>;
      updatedFamilies: Set<Family>;
    }
  ) => void;
  scheduleRoot?: (root: FiberRoot, element: React.ReactNode) => void;
  scheduleUpdate?: (fiber: Fiber) => void;

  setErrorHandler?: (newShouldErrorImpl: (fiber: Fiber) => boolean) => void;
  setRefreshHandler?: (
    handler: ((fiber: Fiber) => Family | null) | null
  ) => void;
  setSuspenseHandler?: (
    newShouldSuspendImpl: (suspenseInstance: unknown) => void
  ) => void;

  version: string;
}

declare global {
  // eslint-disable-next-line no-var
  var __REACT_DEVTOOLS_GLOBAL_HOOK__: ReactDevToolsGlobalHook | undefined;
}
