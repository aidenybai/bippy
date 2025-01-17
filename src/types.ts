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
    priority: void | number,
  ) => void;
  onCommitFiberUnmount: (rendererID: number, fiber: Fiber) => void;
  onPostCommitFiberRoot: (rendererID: number, root: FiberRoot) => void;
  inject: (renderer: ReactRenderer) => number;
  _instrumentationSource?: string;
  _instrumentationIsActive?: boolean;
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
  findFiberByHostInstance?: (hostInstance: unknown) => Fiber | null;
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
  var __REACT_DEVTOOLS_GLOBAL_HOOK__: ReactDevToolsGlobalHook;
}
