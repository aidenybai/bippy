import type * as React from "react";

export interface ReconcilerHookUpdate {
  action: unknown;
  next: ReconcilerHookUpdate | null;
  eagerReducer?: React.Reducer<unknown, unknown>;
  eagerState?: unknown;
}

export interface ReconcilerHookQueue {
  pending: ReconcilerHookUpdate | null;
  lastRenderedReducer: React.Reducer<unknown, unknown>;
  lastRenderedState: unknown;
}

export interface ReconcilerHook {
  memoizedState: unknown;
  queue: ReconcilerHookQueue | null;
  next: ReconcilerHook | null;
}

export interface ReconcilerEffect {
  tag: number;
  create: () => void | (() => void);
  destroy: (() => void) | undefined;
  deps: React.DependencyList | null;
}

export interface ReconcilerFiber {
  tag: number;
  key: React.Key | null;
  ref: unknown;
  index: number;
  type: unknown;
  elementType: unknown;
  pendingProps: Record<string, unknown>;
  memoizedProps: Record<string, unknown> | null;
  memoizedState: unknown;
  stateNode: unknown;
  return: ReconcilerFiber | null;
  child: ReconcilerFiber | null;
  sibling: ReconcilerFiber | null;
  alternate: ReconcilerFiber | null;
  flags: number;
  effects: ReconcilerEffect[] | null;
  siblingNode: unknown;
}

export interface ReconcilerRoot {
  containerInfo: unknown;
  current: ReconcilerFiber;
  pendingChildren: unknown;
  onCommit: ((root: ReconcilerRoot) => void) | null;
}

export interface ReconcilerHostConfig<
  Type = unknown,
  Props = Record<string, unknown>,
  Container = unknown,
  Instance = unknown,
  TextInstance = unknown,
  PublicInstance = unknown,
  HostContext = unknown,
  UpdatePayload = unknown,
> {
  [key: string]: unknown;
  createInstance(
    type: Type,
    props: Props,
    rootContainer: Container,
    hostContext: HostContext | null,
    internalHandle: ReconcilerFiber,
  ): Instance;
  createTextInstance(
    text: string,
    rootContainer: Container,
    hostContext: HostContext | null,
    internalHandle: ReconcilerFiber,
  ): TextInstance;
  finalizeInitialChildren(
    instance: Instance,
    type: Type,
    props: Props,
    rootContainer: Container,
    hostContext: HostContext | null,
  ): boolean;
  getPublicInstance(instance: Instance | TextInstance): PublicInstance;
  preparePortalMount?(containerInfo: Container): void;
  prepareUpdate?(
    instance: Instance,
    type: Type,
    oldProps: Props,
    newProps: Props,
    rootContainer: Container,
    hostContext: HostContext | null,
  ): UpdatePayload | null;
  appendChild?(parent: Instance, child: Instance | TextInstance): void;
  appendInitialChild?(parent: Instance, child: Instance | TextInstance): void;
  appendChildToContainer?(container: Container, child: Instance | TextInstance): void;
  insertBefore?(
    parent: Instance,
    child: Instance | TextInstance,
    beforeChild: Instance | TextInstance,
  ): void;
  insertInContainerBefore?(
    container: Container,
    child: Instance | TextInstance,
    beforeChild: Instance | TextInstance,
  ): void;
  removeChild?(parent: Instance, child: Instance | TextInstance): void;
  removeChildFromContainer?(container: Container, child: Instance | TextInstance): void;
  clearContainer?(container: Container): void;
  commitTextUpdate?(textInstance: TextInstance, oldText: string, newText: string): void;
  commitMount?(instance: Instance, type: Type, props: Props, internalHandle: ReconcilerFiber): void;
  commitUpdate?(
    instance: Instance,
    updatePayloadOrType: UpdatePayload | Type,
    typeOrPrevProps: Type | Props,
    prevPropsOrNextProps: Props,
    nextPropsOrHandle: Props | ReconcilerFiber,
    internalHandle?: ReconcilerFiber,
  ): void;
  NotPendingTransition?: unknown;
}

export interface ReconcilerDevToolsConfig {
  bundleType: 0 | 1;
  version: string;
  rendererPackageName: string;
  findFiberByHostInstance?: (instance: unknown) => ReconcilerFiber | null;
  rendererConfig?: unknown;
}
