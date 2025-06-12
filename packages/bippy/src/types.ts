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
    // biome-ignore lint/suspicious/noConfusingVoidType: may or may not exist
    priority: void | number
  ) => void;
  onCommitFiberUnmount: (rendererID: number, fiber: Fiber) => void;
  onPostCommitFiberRoot: (rendererID: number, root: FiberRoot) => void;
  inject: (renderer: ReactRenderer) => number;
  _instrumentationSource?: string;
  _instrumentationIsActive?: boolean;
  _sw?: boolean;
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
};

// https://github.com/facebook/react/blob/6a4b46cd70d2672bc4be59dcb5b8dede22ed0cef/packages/react-devtools-shared/src/backend/types.js
export interface ReactRenderer {
  version: string;
  bundleType: 0 /* PROD */ | 1 /* DEV */;
  currentDispatcherRef: React.RefObject<unknown>;

  // dev only
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
