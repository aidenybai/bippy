// HACK: A runtime React import would load before the DevTools hook can observe the renderer.

import type * as React from "react";

import type {
  ContextDependency,
  Fiber,
  FiberRoot,
  HostFiber,
  MemoizedState,
  ReactDevToolsGlobalHook,
  ReactRenderer,
} from "./react-internals/index.js";

import {
  _onActiveListeners,
  BIPPY_INSTRUMENTATION_STRING,
  createUnsubscribe,
  getRDTHook,
  hasRDTHook,
  isRealReactDevtools,
  onRDTHookReplace,
  onRendererInject,
} from "./rdt-hook.js";
import type { Unsubscribe } from "./rdt-hook.js";
import {
  getReactWorkTagsForFiber,
  MutationMask,
  ReactBuildType,
  ReactFiberFlags,
  ReactSymbols,
  setReactWorkTagsForFiber,
} from "./react-internals/index.js";

export { getReactWorkTags, ReactSymbols } from "./react-internals/index.js";
export type { ReactWorkTagMap, ReactWorkTagVersion } from "./react-internals/index.js";
export {
  BippyError,
  BippyHookInspectionError,
  BippyHookRenderError,
  BippySourceMapError,
  BippyUnsupportedHookError,
} from "./errors.js";

const isComponentType = (value: unknown): value is React.ComponentType<unknown> =>
  typeof value === "function";

const getTypeName = (value: object): string | null => {
  const displayName = "displayName" in value ? value.displayName : null;
  if (typeof displayName === "string" && displayName) return displayName;
  const name = "name" in value ? value.name : null;
  return typeof name === "string" && name ? name : null;
};

interface FiberSelector {
  (node: Fiber): boolean | Promise<boolean | void> | void;
}

interface TraverseFiber {
  (
    fiber: Fiber | null,
    selector: (node: Fiber) => boolean | void,
    ascending?: boolean,
  ): Fiber | null;
  (
    fiber: Fiber | null,
    selector: (node: Fiber) => Promise<boolean | void>,
    ascending?: boolean,
  ): Promise<Fiber | null>;
  (
    fiber: Fiber | null,
    selector: FiberSelector,
    ascending?: boolean,
  ): Fiber | null | Promise<Fiber | null>;
}

export interface FiberTimings {
  selfTime: number;
  totalTime: number;
}

export interface FiberTimingNode {
  actualDuration?: number;
  child?: FiberTimingNode | null;
  sibling?: FiberTimingNode | null;
}

export interface RenderHandler {
  (fiber: Fiber, phase: RenderPhase): unknown;
}

interface ValueWrite {
  path: string[];
  value: unknown;
}

interface RenderedRootState {
  previousFiber: Fiber | null;
}

export interface RenderedFiberRoot {
  current: Fiber | null;
}

/**
 * Returns `true` if object is a React Element.
 *
 * @see https://react.dev/reference/react/isValidElement
 */
export const isValidElement = (element: unknown): element is React.ReactElement =>
  typeof element === "object" &&
  element !== null &&
  "$$typeof" in element &&
  (String(element.$$typeof) === ReactSymbols.LEGACY_ELEMENT_SYMBOL_STRING ||
    String(element.$$typeof) === ReactSymbols.ELEMENT_SYMBOL_STRING);

/**
 * Returns `true` if object is a React Fiber.
 */
export const isValidFiber = (fiber: unknown): fiber is Fiber =>
  typeof fiber === "object" &&
  fiber !== null &&
  "tag" in fiber &&
  "stateNode" in fiber &&
  "return" in fiber &&
  "child" in fiber &&
  "sibling" in fiber &&
  "flags" in fiber;

const isFiberRoot = (fiberRoot: unknown): fiberRoot is FiberRoot =>
  typeof fiberRoot === "object" &&
  fiberRoot !== null &&
  "current" in fiberRoot &&
  isValidFiber(fiberRoot.current);

/**
 * Returns `true` if fiber is a host fiber. Host fibers are DOM nodes in react-dom, `View` in react-native, etc.
 *
 * @see https://reactnative.dev/architecture/glossary#host-view-tree-and-host-view
 */
export const isHostFiber = (fiber: Fiber): fiber is HostFiber => {
  const workTags = getReactWorkTagsForFiber(fiber);
  switch (fiber.tag) {
    case workTags.HostComponent:
    case workTags.HostText:
    case workTags.HostHoistable:
    case workTags.HostSingleton:
      return true;
    default:
      return false;
  }
};

/**
 * Returns `true` if fiber is a composite fiber. Composite fibers are fibers that can render (like functional components, class components, etc.)
 *
 * @see https://reactnative.dev/architecture/glossary#react-composite-components
 */
export const isCompositeFiber = (fiber: Fiber): boolean => {
  const workTags = getReactWorkTagsForFiber(fiber);
  switch (fiber.tag) {
    case workTags.ClassComponent:
    case workTags.ForwardRef:
    case workTags.FunctionComponent:
    case workTags.MemoComponent:
    case workTags.SimpleMemoComponent:
      return true;
    default:
      return false;
  }
};

/**
 * Returns `true` if the object is a {@link Fiber}
 */
export const isFiber = (maybeFiber: unknown): maybeFiber is Fiber => {
  if (!maybeFiber || typeof maybeFiber !== "object") return false;
  return "pendingProps" in maybeFiber && !("containerInfo" in maybeFiber);
};

/**
 * Traverses up or down a {@link Fiber}'s contexts, return `true` to stop and select the current and previous context value.
 */
export const traverseContexts = (
  fiber: Fiber,
  selector: (
    nextValue: ContextDependency<unknown> | null | undefined,
    prevValue: ContextDependency<unknown> | null | undefined,
  ) => boolean | void,
): boolean => {
  try {
    const nextDependencies = fiber.dependencies;
    const prevDependencies = fiber.alternate?.dependencies;

    if (!nextDependencies || !prevDependencies) return false;
    if (
      typeof nextDependencies !== "object" ||
      !("firstContext" in nextDependencies) ||
      typeof prevDependencies !== "object" ||
      !("firstContext" in prevDependencies)
    ) {
      return false;
    }
    let nextContext: ContextDependency<unknown> | null | undefined = nextDependencies.firstContext;
    let prevContext: ContextDependency<unknown> | null | undefined = prevDependencies.firstContext;
    while (
      (nextContext && typeof nextContext === "object" && "memoizedValue" in nextContext) ||
      (prevContext && typeof prevContext === "object" && "memoizedValue" in prevContext)
    ) {
      if (selector(nextContext, prevContext) === true) return true;

      nextContext = nextContext?.next;
      prevContext = prevContext?.next;
    }
  } catch {}
  return false;
};

/**
 * Traverses up or down a {@link Fiber}'s states, return `true` to stop and select the current and previous state value. This stores both state values and effects.
 */
export const traverseState = (
  fiber: Fiber,
  selector: (
    nextValue: MemoizedState | null | undefined,
    prevValue: MemoizedState | null | undefined,
  ) => boolean | void,
): boolean => {
  try {
    let nextState: MemoizedState | null | undefined = fiber.memoizedState;
    let prevState: MemoizedState | null | undefined = fiber.alternate?.memoizedState;

    while (nextState || prevState) {
      if (selector(nextState, prevState) === true) return true;

      nextState = nextState?.next;
      prevState = prevState?.next;
    }
  } catch {}
  return false;
};

/**
 * Traverses up or down a {@link Fiber}'s props, return `true` to stop and select the current and previous props value.
 */
export const traverseProps = (
  fiber: Fiber,
  selector: (propName: string, nextValue: unknown, prevValue: unknown) => boolean | void,
): boolean => {
  try {
    const nextProps = fiber.memoizedProps;
    const prevProps = fiber.alternate?.memoizedProps || {};

    for (const propName of Object.keys(nextProps)) {
      if (selector(propName, nextProps[propName], prevProps[propName]) === true) return true;
    }
    for (const propName of Object.keys(prevProps)) {
      if (propName in nextProps) continue;
      if (selector(propName, nextProps[propName], prevProps[propName]) === true) return true;
    }
  } catch {}
  return false;
};

/**
 * Returns `true` if the {@link Fiber} has rendered. Note that this does not mean the fiber has rendered in the current commit, just that it has rendered in the past.
 */
export const didFiberRender = (fiber: Fiber): boolean => {
  const nextProps = fiber.memoizedProps;
  const prevProps = fiber.alternate?.memoizedProps || {};
  const flags = fiber.flags ?? fiber.effectTag ?? 0;
  const workTags = getReactWorkTagsForFiber(fiber);

  switch (fiber.tag) {
    case workTags.ClassComponent:
    case workTags.ContextConsumer:
    case workTags.ForwardRef:
    case workTags.FunctionComponent:
    case workTags.MemoComponent:
    case workTags.SimpleMemoComponent: {
      return (flags & ReactFiberFlags.PerformedWork) === ReactFiberFlags.PerformedWork;
    }
    default:
      if (!fiber.alternate) return true;
      return (
        prevProps !== nextProps ||
        fiber.alternate.memoizedState !== fiber.memoizedState ||
        fiber.alternate.ref !== fiber.ref
      );
  }
};

/**
 * Returns `true` if the {@link Fiber} has committed. Note that this does not mean the fiber has committed in the current commit, just that it has committed in the past.
 */
export const didFiberCommit = (fiber: Fiber): boolean => {
  return Boolean(
    (fiber.flags & (MutationMask | ReactFiberFlags.Cloned)) !== 0 ||
    (fiber.subtreeFlags & (MutationMask | ReactFiberFlags.Cloned)) !== 0,
  );
};

/**
 * Returns all host {@link Fiber}s that have committed and rendered.
 */
export const getMutatedHostFibers = (fiber: Fiber): Fiber[] => {
  const mutations: Fiber[] = [];
  const stack: Fiber[] = [fiber];

  while (stack.length) {
    const node = stack.pop();
    if (!node) continue;

    if (isHostFiber(node) && didFiberCommit(node) && didFiberRender(node)) {
      mutations.push(node);
    }

    if (node.child) stack.push(node.child);
    if (node.sibling) stack.push(node.sibling);
  }

  return mutations;
};

/**
 * Returns the stack of {@link Fiber}s from the current fiber to the root fiber.
 *
 * @example
 * ```ts
 * [fiber, fiber.return, fiber.return.return, ...]
 * ```
 */
export const getFiberStack = (fiber: Fiber): Fiber[] => {
  const stack: Fiber[] = [];
  let currentFiber = fiber;
  while (currentFiber.return) {
    stack.push(currentFiber);
    currentFiber = currentFiber.return;
  }
  return stack;
};

/**
 * Returns `true` if the {@link Fiber} should be filtered out during reconciliation.
 */
const shouldFilterFiber = (fiber: Fiber): boolean => {
  const workTags = getReactWorkTagsForFiber(fiber);
  switch (fiber.tag) {
    case workTags.DehydratedSuspenseComponent:
      // HACK: Showing dehydrated Suspense before it becomes a real Suspense Fiber breaks DevTools.
      return true;

    case workTags.Fragment:
    case workTags.HostText:
    case workTags.LegacyHiddenComponent:
    case workTags.OffscreenComponent:
      return true;

    case workTags.HostRoot:
      return false;

    default: {
      const symbolOrNumber =
        typeof fiber.type === "object" && fiber.type !== null ? fiber.type.$$typeof : fiber.type;

      if (typeof symbolOrNumber === "symbol") {
        return (
          symbolOrNumber.description === ReactSymbols.CONCURRENT_MODE_SYMBOL_DESCRIPTION ||
          symbolOrNumber.description === ReactSymbols.DEPRECATED_ASYNC_MODE_SYMBOL_DESCRIPTION
        );
      }

      switch (symbolOrNumber) {
        case ReactSymbols.CONCURRENT_MODE_NUMBER:
        case ReactSymbols.CONCURRENT_MODE_SYMBOL_STRING:
        case ReactSymbols.DEPRECATED_ASYNC_MODE_SYMBOL_STRING:
          return true;

        default:
          return false;
      }
    }
  }
};

/**
 * Returns the nearest host {@link Fiber} to the current {@link Fiber}.
 */
export const getNearestHostFiber = (fiber: Fiber, ascending = false): Fiber | null => {
  let hostFiber = traverseFiber(fiber, isHostFiber, ascending);
  if (!hostFiber) {
    hostFiber = traverseFiber(fiber, isHostFiber, !ascending);
  }
  return hostFiber;
};

/**
 * Returns all host {@link Fiber}s in the tree that are associated with the current {@link Fiber}.
 */
export const getNearestHostFibers = (fiber: Fiber): Fiber[] => {
  const hostFibers: Fiber[] = [];
  const stack: Fiber[] = [];

  if (isHostFiber(fiber)) {
    hostFibers.push(fiber);
  } else if (fiber.child) {
    stack.push(fiber.child);
  }

  while (stack.length) {
    const currentNode = stack.pop();
    if (!currentNode) break;
    if (isHostFiber(currentNode)) {
      hostFibers.push(currentNode);
    } else if (currentNode.child) {
      stack.push(currentNode.child);
    }

    if (currentNode.sibling) {
      stack.push(currentNode.sibling);
    }
  }

  return hostFibers;
};

/**
 * Traverses up or down a {@link Fiber}, return `true` to stop and select a node.
 */
const traverseFiberImplementation = (
  fiber: Fiber | null,
  selector: FiberSelector,
  ascending = false,
): Fiber | null | Promise<Fiber | null> => {
  if (!fiber) return null;

  const selection = selector(fiber);
  if (isPromiseLike<boolean | void>(selection)) {
    return Promise.resolve(selection).then((didSelectFiber) =>
      didSelectFiber === true ? fiber : traverseFiberChildren(fiber, selector, ascending),
    );
  }
  if (selection === true) return fiber;

  return traverseFiberChildren(fiber, selector, ascending);
};

export const traverseFiber = traverseFiberImplementation as TraverseFiber;

const isPromiseLike = <Result>(value: unknown): value is PromiseLike<Result> =>
  (typeof value === "object" || typeof value === "function") &&
  value !== null &&
  "then" in value &&
  typeof value.then === "function";

const traverseFiberChildren = (
  fiber: Fiber,
  selector: FiberSelector,
  ascending: boolean,
): Fiber | null | Promise<Fiber | null> => {
  const firstChild = ascending ? fiber.return : fiber.child;
  return traverseFiberSiblings(firstChild, selector, ascending);
};

const traverseFiberSiblings = (
  fiber: Fiber | null,
  selector: FiberSelector,
  ascending: boolean,
): Fiber | null | Promise<Fiber | null> => {
  if (!fiber) return null;

  const nextSibling = ascending ? null : fiber.sibling;
  const match = traverseFiber(fiber, selector, ascending);
  if (isPromiseLike<Fiber | null>(match)) {
    return Promise.resolve(match).then(
      (resolvedMatch) => resolvedMatch ?? traverseFiberSiblings(nextSibling, selector, ascending),
    );
  }
  return match ?? traverseFiberSiblings(nextSibling, selector, ascending);
};

/**
 * Returns the timings of the {@link Fiber}.
 *
 * @example
 * ```ts
 * const { selfTime, totalTime } = getTimings(fiber);
 * console.log(selfTime, totalTime);
 * ```
 */
export const getTimings = (fiber?: FiberTimingNode | null): FiberTimings => {
  const totalTime = fiber?.actualDuration ?? 0;
  let selfTime = totalTime;
  let child = fiber?.child ?? null;
  while (totalTime > 0 && child !== null) {
    selfTime -= child.actualDuration ?? 0;
    child = child.sibling ?? null;
  }
  return { selfTime, totalTime };
};

/**
 * Returns `true` if the {@link Fiber} uses React Compiler's memo cache.
 */
export const hasMemoCache = (fiber: Fiber): boolean => {
  return Boolean(fiber.updateQueue?.memoCache);
};

/**
 * Returns the type (e.g. component definition) of the {@link Fiber}
 */
export const getType = (type: unknown): null | React.ComponentType<unknown> => {
  if (isComponentType(type)) return type;
  if (typeof type !== "object" || type === null) return null;
  return getType(Reflect.get(type, "type") ?? Reflect.get(type, "render"));
};

/**
 * Returns the display name of the {@link Fiber} type.
 */
export const getDisplayName = (type: unknown): null | string => {
  if (typeof type === "string") return type;
  if ((typeof type !== "function" && typeof type !== "object") || type === null) return null;
  const name = getTypeName(type);
  if (name) return name;
  const unwrappedType = getType(type);
  if (!unwrappedType) return null;
  return getTypeName(unwrappedType);
};

/**
 * Returns the build type of the React renderer.
 */
export const detectReactBuildType = (renderer: ReactRenderer): "development" | "production" => {
  try {
    if (
      typeof renderer.version === "string" &&
      renderer.bundleType === ReactBuildType.Development
    ) {
      return "development";
    }
  } catch {}
  return "production";
};

/**
 * Returns `true` if bippy's instrumentation is active.
 */
export const isInstrumentationActive = (): boolean => {
  const rdtHook = globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  return Boolean(rdtHook?._instrumentationIsActive) || isRealReactDevtools(rdtHook);
};

export const _fiberRoots = new Set<FiberRoot>();

/**
 * Returns the latest fiber (since it may be double-buffered).
 */
export const getLatestFiber = (fiber: Fiber): Fiber => {
  const alternate = fiber.alternate;
  if (!alternate) return fiber;
  if (alternate.actualStartTime && fiber.actualStartTime) {
    return alternate.actualStartTime > fiber.actualStartTime ? alternate : fiber;
  }
  for (const root of _fiberRoots) {
    const latestFiber = traverseFiber(root.current, (innerFiber) => {
      if (innerFiber === fiber || innerFiber === alternate) return true;
    });
    if (latestFiber) return latestFiber;
  }
  return fiber;
};

export type RenderPhase = "mount" | "unmount" | "update";

let nextFiberId = 0;
const fiberIdMap = new WeakMap<Fiber, number>();

export const setFiberId = (fiber: Fiber, fiberId: number = nextFiberId++): void => {
  fiberIdMap.set(fiber, fiberId);
  if (Number.isSafeInteger(fiberId) && fiberId >= nextFiberId) {
    nextFiberId = fiberId + 1;
  }
};

export const getFiberId = (fiber: Fiber): number => {
  let currentFiberId = fiberIdMap.get(fiber);
  if (currentFiberId === undefined && fiber.alternate) {
    currentFiberId = fiberIdMap.get(fiber.alternate);
  }
  if (currentFiberId === undefined) {
    currentFiberId = nextFiberId++;
    setFiberId(fiber, currentFiberId);
  }
  return currentFiberId;
};

const mountFiberRecursively = (
  onRender: RenderHandler,
  firstChild: Fiber,
  traverseSiblings: boolean,
): void => {
  let fiber: Fiber | null = firstChild;

  while (fiber !== null) {
    getFiberId(fiber);
    const shouldIncludeInTree = !shouldFilterFiber(fiber);
    if (shouldIncludeInTree && didFiberRender(fiber)) {
      onRender(fiber, "mount");
    }

    const isSuspense = fiber.tag === getReactWorkTagsForFiber(fiber).SuspenseComponent;
    if (!isSuspense && fiber.child !== null) {
      mountFiberRecursively(onRender, fiber.child, true);
    } else if (isSuspense) {
      const isTimedOut = fiber.memoizedState !== null;
      const primaryChild = isTimedOut ? null : (fiber.child?.child ?? null);
      const fallbackChild = isTimedOut ? (fiber.child?.sibling?.child ?? null) : null;
      const visibleChild = primaryChild ?? fallbackChild;
      if (visibleChild !== null) mountFiberRecursively(onRender, visibleChild, false);
    }
    fiber = traverseSiblings ? fiber.sibling : null;
  }
};

const updateFiberChildren = (
  onRender: RenderHandler,
  nextFiber: Fiber,
  previousFiber: Fiber,
): void => {
  if (nextFiber.child === previousFiber.child) return;

  let nextChild = nextFiber.child;
  while (nextChild) {
    if (nextChild.alternate) {
      updateFiberRecursively(onRender, nextChild, nextChild.alternate);
    } else {
      mountFiberRecursively(onRender, nextChild, false);
    }
    nextChild = nextChild.sibling;
  }
};

const updateSuspenseChildren = (
  onRender: RenderHandler,
  nextFiber: Fiber,
  previousFiber: Fiber,
): void => {
  const previousDidTimeOut = previousFiber.memoizedState !== null;
  const nextDidTimeOut = nextFiber.memoizedState !== null;

  if (previousDidTimeOut && nextDidTimeOut) {
    const nextFallbackChildSet = nextFiber.child?.sibling ?? null;
    const previousFallbackChildSet = previousFiber.child?.sibling ?? null;
    if (nextFallbackChildSet && previousFallbackChildSet) {
      updateFiberRecursively(onRender, nextFallbackChildSet, previousFallbackChildSet);
    }
    return;
  }

  if (previousDidTimeOut) {
    if (nextFiber.child) mountFiberRecursively(onRender, nextFiber.child, true);
    return;
  }

  unmountFiberChildrenRecursively(onRender, previousFiber);
  const nextFallbackChildSet = nextFiber.child?.sibling ?? null;
  if (nextFallbackChildSet) mountFiberRecursively(onRender, nextFallbackChildSet, true);
};

const updateFiberRecursively = (
  onRender: RenderHandler,
  nextFiber: Fiber,
  previousFiber: Fiber | null,
): void => {
  getFiberId(nextFiber);
  if (!previousFiber) return;
  getFiberId(previousFiber);

  const shouldIncludeInTree = !shouldFilterFiber(nextFiber);
  if (shouldIncludeInTree && didFiberRender(nextFiber)) {
    onRender(nextFiber, "update");
  }

  const isSuspense = nextFiber.tag === getReactWorkTagsForFiber(nextFiber).SuspenseComponent;
  const stayedOnPrimaryTree =
    !isSuspense || (previousFiber.memoizedState === null && nextFiber.memoizedState === null);
  if (stayedOnPrimaryTree) return updateFiberChildren(onRender, nextFiber, previousFiber);

  updateSuspenseChildren(onRender, nextFiber, previousFiber);
};

const unmountFiber = (onRender: RenderHandler, fiber: Fiber): void => {
  const isRoot = fiber.tag === getReactWorkTagsForFiber(fiber).HostRoot;

  if (isRoot || !shouldFilterFiber(fiber)) {
    onRender(fiber, "unmount");
  }
};

const unmountFiberChildrenRecursively = (onRender: RenderHandler, fiber: Fiber): void => {
  const isTimedOutSuspense =
    fiber.tag === getReactWorkTagsForFiber(fiber).SuspenseComponent && fiber.memoizedState !== null;
  let child = fiber.child;

  if (isTimedOutSuspense) {
    child = fiber.child?.sibling?.child ?? null;
  }

  while (child !== null) {
    if (child.return !== null) {
      unmountFiber(onRender, child);
      unmountFiberChildrenRecursively(onRender, child);
    }

    child = child.sibling;
  }
};

const rootStateMap = new WeakMap<Fiber | RenderedFiberRoot, RenderedRootState>();

const getRenderedRootState = (root: Fiber | RenderedFiberRoot): RenderedRootState => {
  const existingState = rootStateMap.get(root);
  if (existingState) return existingState;
  const newState: RenderedRootState = { previousFiber: null };
  rootStateMap.set(root, newState);
  return newState;
};

const isMountedRootFiber = (fiber: Fiber): boolean =>
  fiber.memoizedState !== null &&
  fiber.memoizedState.element !== null &&
  fiber.memoizedState.element !== undefined &&
  fiber.memoizedState.isDehydrated !== true;

const traverseRootTransition = (
  currentFiber: Fiber | null,
  previousFiber: Fiber | null,
  onRender: RenderHandler,
): void => {
  if (!currentFiber) {
    if (previousFiber) unmountFiber(onRender, previousFiber);
    return;
  }
  if (!previousFiber) return mountFiberRecursively(onRender, currentFiber, true);

  const wasMounted = isMountedRootFiber(previousFiber);
  const isMounted = isMountedRootFiber(currentFiber);
  if (wasMounted && isMounted) {
    updateFiberRecursively(onRender, currentFiber, currentFiber.alternate);
    return;
  }
  if (isMounted) {
    mountFiberRecursively(onRender, currentFiber, false);
    return;
  }
  if (wasMounted) unmountFiber(onRender, currentFiber);
};

/**
 * Creates a fiber visitor function. Must pass a fiber root and a render handler.
 * @example
 * traverseRenderedFibers(root, (fiber, phase) => {
 *   console.log(phase)
 * })
 */
export const traverseRenderedFibers = (
  root: Fiber | RenderedFiberRoot,
  onRender: RenderHandler,
): void => {
  const currentFiber = "current" in root ? root.current : root;
  const rootState = getRenderedRootState(root);
  traverseRootTransition(currentFiber, rootState.previousFiber, onRender);
  rootState.previousFiber = currentFiber;
};

const overrideRenderers = new Set<ReactRenderer>();
let areOverrideRenderersWired = false;

const wireOverrideRenderers = (): void => {
  if (!hasRDTHook()) return;
  const rdtHook = getRDTHook();

  setHookEventDispatchers(rdtHook);
  for (const renderer of rdtHook.renderers.values()) {
    overrideRenderers.add(renderer);
  }
  if (areOverrideRenderersWired) return;
  areOverrideRenderersWired = true;
  onRendererInject((renderer) => {
    overrideRenderers.add(renderer);
  });
};

const getRootRenderer = (fiber: Fiber): ReactRenderer | null => {
  if (!hasRDTHook()) return null;
  let hostRootFiber = fiber;
  while (hostRootFiber.return) {
    hostRootFiber = hostRootFiber.return;
  }
  const fiberRoot = hostRootFiber.stateNode;
  if (!isFiberRoot(fiberRoot)) return null;
  const rendererId = rootRendererIds.get(fiberRoot);
  if (rendererId === undefined) return null;
  return getRDTHook().renderers.get(rendererId) ?? null;
};

const resolveOverrideRenderers = (fiber: Fiber): ReactRenderer[] => {
  wireOverrideRenderers();
  const rootRenderer = getRootRenderer(fiber);
  if (rootRenderer) return [rootRenderer];
  return Array.from(overrideRenderers);
};

const applyPropsOverride = (
  renderers: ReactRenderer[],
  fiber: Fiber,
  path: string[],
  value: unknown,
): void => {
  for (const renderer of renderers) {
    try {
      renderer.overrideProps?.(fiber, path, value);
    } catch {}
  }
};

const getHookStateDispatch = (
  fiber: Fiber,
  hookIndex: number,
): ((value: unknown) => void) | null => {
  let hookState = fiber.memoizedState;
  for (let currentHookIndex = 0; currentHookIndex < hookIndex; currentHookIndex++) {
    if (!hookState?.next) return null;
    hookState = hookState.next;
  }
  const queue = hookState?.queue;
  if (!isPOJO(queue)) return null;
  const dispatch = queue.dispatch;
  return typeof dispatch === "function" ? (value) => dispatch(value) : null;
};

const findContextProviderFiber = (fiber: Fiber, contextType: unknown): Fiber | null => {
  let currentFiber: Fiber | null = fiber;
  while (currentFiber) {
    const fiberType = currentFiber.type;
    if (fiberType === contextType || fiberType?.Provider === contextType) {
      return currentFiber;
    }
    currentFiber = currentFiber.return;
  }
  return null;
};

const isPOJO = (maybePOJO: unknown): maybePOJO is Record<string, unknown> => {
  return (
    Object.prototype.toString.call(maybePOJO) === "[object Object]" &&
    (Object.getPrototypeOf(maybePOJO) === Object.prototype ||
      Object.getPrototypeOf(maybePOJO) === null)
  );
};

const buildPathsFromValue = (
  maybePOJO: Record<string, unknown>,
  basePath: string[] = [],
  ancestors = new WeakSet<object>(),
): ValueWrite[] => {
  if (ancestors.has(maybePOJO)) {
    return [{ path: basePath, value: maybePOJO }];
  }

  ancestors.add(maybePOJO);
  const paths: ValueWrite[] = [];

  for (const [key, value] of Object.entries(maybePOJO)) {
    const path = basePath.concat(key);

    if (isPOJO(value)) {
      paths.push(...buildPathsFromValue(value, path, ancestors));
    } else {
      paths.push({ path, value });
    }
  }

  ancestors.delete(maybePOJO);
  return paths;
};

const buildValueWrites = (partialValue: unknown): ValueWrite[] =>
  isPOJO(partialValue) ? buildPathsFromValue(partialValue) : [{ path: [], value: partialValue }];

export const overrideProps = (fiber: Fiber, partialValue: Record<string, unknown>) => {
  const renderers = resolveOverrideRenderers(fiber);
  for (const { path, value } of buildValueWrites(partialValue)) {
    applyPropsOverride(renderers, fiber, path, value);
  }
};

export const overrideHookState = (fiber: Fiber, id: number, partialValue: unknown) => {
  const renderers = resolveOverrideRenderers(fiber).filter((renderer) =>
    Boolean(renderer.overrideHookState),
  );

  if (renderers.length > 0) {
    const writes = buildValueWrites(partialValue);
    for (const renderer of renderers) {
      for (const { path, value } of writes) {
        try {
          renderer.overrideHookState?.(fiber, id, path, value);
        } catch {}
      }
    }
    return;
  }

  // HACK: Production renderers only support whole-state writes through the hook queue.
  if (isPOJO(partialValue)) return;
  const dispatch = getHookStateDispatch(fiber, id);
  if (!dispatch) return;
  try {
    dispatch(partialValue);
  } catch {}
};

export const overrideContext = (fiber: Fiber, contextType: unknown, partialValue: unknown) => {
  const providerFiber = findContextProviderFiber(fiber, contextType);
  if (!providerFiber) return;
  const renderers = resolveOverrideRenderers(providerFiber);
  for (const { path, value } of buildValueWrites(partialValue)) {
    applyPropsOverride(renderers, providerFiber, ["value", ...path], value);
    if (providerFiber.alternate) {
      applyPropsOverride(renderers, providerFiber.alternate, ["value", ...path], value);
    }
  }
};

export interface InstrumentationOptions {
  name?: string;
  onActive?: () => unknown;
  onCommitFiberRoot?: (
    rendererID: number,
    root: FiberRoot,
    priority: number | void,
    didError?: boolean,
  ) => unknown;
  onCommitFiberUnmount?: (rendererID: number, fiber: Fiber) => unknown;
  onPostCommitFiberRoot?: (rendererID: number, root: FiberRoot) => unknown;
  onScheduleFiberRoot?: (rendererID: number, root: FiberRoot, children: React.ReactNode) => unknown;
}

interface InstrumentationSubscription {
  options: InstrumentationOptions;
}

const instrumentationSubscriptions = new Set<InstrumentationSubscription>();

interface HookDispatchers {
  onCommitFiberRoot: ReactDevToolsGlobalHook["onCommitFiberRoot"];
  onCommitFiberUnmount: ReactDevToolsGlobalHook["onCommitFiberUnmount"];
  onPostCommitFiberRoot: ReactDevToolsGlobalHook["onPostCommitFiberRoot"];
  onScheduleFiberRoot: NonNullable<ReactDevToolsGlobalHook["onScheduleFiberRoot"]>;
}

const hookDispatchers = new WeakMap<ReactDevToolsGlobalHook, Partial<HookDispatchers>>();
let didSubscribeToHookReplacements = false;

const rootRendererIds = new WeakMap<FiberRoot, number>();

// HACK: Reinstallable wrappers preserve overwritten DevTools handlers without firing listeners twice.
const setHookEventDispatchers = (rdtHook: ReactDevToolsGlobalHook): void => {
  const dispatchers = hookDispatchers.get(rdtHook) ?? {};
  hookDispatchers.set(rdtHook, dispatchers);

  if (
    !dispatchers.onCommitFiberRoot ||
    rdtHook.onCommitFiberRoot !== dispatchers.onCommitFiberRoot
  ) {
    const prevOnCommitFiberRoot = rdtHook.onCommitFiberRoot;
    const dispatchCommitFiberRoot: HookDispatchers["onCommitFiberRoot"] = (
      rendererID,
      root,
      priority,
      didError,
    ) => {
      if (prevOnCommitFiberRoot) {
        prevOnCommitFiberRoot.call(rdtHook, rendererID, root, priority, didError);
      }
      if (hookDispatchers.get(rdtHook)?.onCommitFiberRoot !== dispatchCommitFiberRoot) return;
      setReactWorkTagsForFiber(root.current, rdtHook.renderers.get(rendererID));
      const rootMemoizedState = root.current.memoizedState;
      const isUnmounting =
        rootMemoizedState === null ||
        rootMemoizedState.element === null ||
        rootMemoizedState.element === undefined;
      if (isUnmounting) {
        _fiberRoots.delete(root);
        rootRendererIds.delete(root);
      } else {
        _fiberRoots.add(root);
        rootRendererIds.set(root, rendererID);
      }
      for (const { options } of instrumentationSubscriptions) {
        if (options.onCommitFiberRoot) {
          options.onCommitFiberRoot(rendererID, root, priority, didError);
        }
      }
    };
    dispatchers.onCommitFiberRoot = dispatchCommitFiberRoot;
    rdtHook.onCommitFiberRoot = dispatchCommitFiberRoot;
  }

  if (
    !dispatchers.onCommitFiberUnmount ||
    rdtHook.onCommitFiberUnmount !== dispatchers.onCommitFiberUnmount
  ) {
    const prevOnCommitFiberUnmount = rdtHook.onCommitFiberUnmount;
    const dispatchCommitFiberUnmount: HookDispatchers["onCommitFiberUnmount"] = (
      rendererID,
      fiber,
    ) => {
      setReactWorkTagsForFiber(fiber, rdtHook.renderers.get(rendererID));
      if (prevOnCommitFiberUnmount) {
        prevOnCommitFiberUnmount.call(rdtHook, rendererID, fiber);
      }
      if (hookDispatchers.get(rdtHook)?.onCommitFiberUnmount !== dispatchCommitFiberUnmount) {
        return;
      }
      for (const { options } of instrumentationSubscriptions) {
        if (options.onCommitFiberUnmount) {
          options.onCommitFiberUnmount(rendererID, fiber);
        }
      }
    };
    dispatchers.onCommitFiberUnmount = dispatchCommitFiberUnmount;
    rdtHook.onCommitFiberUnmount = dispatchCommitFiberUnmount;
  }

  if (
    !dispatchers.onPostCommitFiberRoot ||
    rdtHook.onPostCommitFiberRoot !== dispatchers.onPostCommitFiberRoot
  ) {
    const prevOnPostCommitFiberRoot = rdtHook.onPostCommitFiberRoot;
    const dispatchPostCommitFiberRoot: HookDispatchers["onPostCommitFiberRoot"] = (
      rendererID,
      root,
    ) => {
      if (prevOnPostCommitFiberRoot) {
        prevOnPostCommitFiberRoot.call(rdtHook, rendererID, root);
      }
      if (hookDispatchers.get(rdtHook)?.onPostCommitFiberRoot !== dispatchPostCommitFiberRoot) {
        return;
      }
      for (const { options } of instrumentationSubscriptions) {
        if (options.onPostCommitFiberRoot) {
          options.onPostCommitFiberRoot(rendererID, root);
        }
      }
    };
    dispatchers.onPostCommitFiberRoot = dispatchPostCommitFiberRoot;
    rdtHook.onPostCommitFiberRoot = dispatchPostCommitFiberRoot;
  }

  if (
    !dispatchers.onScheduleFiberRoot ||
    rdtHook.onScheduleFiberRoot !== dispatchers.onScheduleFiberRoot
  ) {
    const prevOnScheduleFiberRoot = rdtHook.onScheduleFiberRoot;
    const dispatchScheduleFiberRoot: HookDispatchers["onScheduleFiberRoot"] = (
      rendererID,
      root,
      children,
    ) => {
      if (prevOnScheduleFiberRoot) {
        prevOnScheduleFiberRoot.call(rdtHook, rendererID, root, children);
      }
      if (hookDispatchers.get(rdtHook)?.onScheduleFiberRoot !== dispatchScheduleFiberRoot) return;
      for (const { options } of instrumentationSubscriptions) {
        if (options.onScheduleFiberRoot) {
          options.onScheduleFiberRoot(rendererID, root, children);
        }
      }
    };
    dispatchers.onScheduleFiberRoot = dispatchScheduleFiberRoot;
    rdtHook.onScheduleFiberRoot = dispatchScheduleFiberRoot;
  }
};

/**
 * Instruments the DevTools hook. Each hook event is patched once and
 * dispatches to a set of listeners, so multiple `instrument` calls compose
 * without stacking patches. Returns an unsubscribe function that removes
 * exactly the handlers this call registered.
 * The unsubscribe function can also be disposed through `using`.
 * @example
 * const unsubscribe = instrument({
 *   onActive() {
 *     console.log('initialized');
 *   },
 *   onCommitFiberRoot(rendererID, root) {
 *     console.log('fiberRoot', root.current)
 *   },
 * });
 * unsubscribe();
 */
export const instrument = (options: InstrumentationOptions): Unsubscribe => {
  const rdtHook = getRDTHook(options.onActive);

  if (!didSubscribeToHookReplacements) {
    onRDTHookReplace(setHookEventDispatchers);
    didSubscribeToHookReplacements = true;
  }

  rdtHook._instrumentationSource = options.name ?? BIPPY_INSTRUMENTATION_STRING;

  setHookEventDispatchers(rdtHook);
  const subscription: InstrumentationSubscription = { options };
  instrumentationSubscriptions.add(subscription);

  return createUnsubscribe(() => {
    if (options.onActive) _onActiveListeners.delete(options.onActive);
    instrumentationSubscriptions.delete(subscription);
  });
};

const knownFiberPropertyKeys = new Set<string>();

const isFiberPropertyKey = (key: string): boolean =>
  key.startsWith("__reactContainer$") ||
  key.startsWith("__reactInternalInstance$") ||
  key.startsWith("__reactFiber");

const getLegacyRootFiber = (hostInstance: object): Fiber | null => {
  const reactRootContainer = Reflect.get(hostInstance, "_reactRootContainer");
  if (typeof reactRootContainer !== "object" || reactRootContainer === null) return null;
  const internalRoot = Reflect.get(reactRootContainer, "_internalRoot");
  if (typeof internalRoot !== "object" || internalRoot === null) return null;
  const current = Reflect.get(internalRoot, "current");
  if (typeof current !== "object" || current === null) return null;
  const child = Reflect.get(current, "child");
  return isValidFiber(child) ? child : null;
};

const getInternalInstanceHandle = (hostInstance: object): Fiber | null => {
  const internalInstanceHandle =
    Reflect.get(hostInstance, "__internalInstanceHandle") ??
    Reflect.get(hostInstance, "_internalInstanceHandle");
  return isValidFiber(internalInstanceHandle) ? internalInstanceHandle : null;
};

const getPublicHostInstance = (stateNode: unknown): unknown => {
  if (typeof stateNode !== "object" || stateNode === null) return stateNode;
  const canonical = Reflect.get(stateNode, "canonical");
  if (typeof canonical === "object" && canonical !== null) {
    const publicInstance = Reflect.get(canonical, "publicInstance");
    if (typeof publicInstance === "object" && publicInstance !== null) {
      return publicInstance;
    }
  }
  const nativeTag = Reflect.get(stateNode, "_nativeTag");
  return typeof nativeTag === "number" ? nativeTag : stateNode;
};

export const getFiberFromHostInstance = <T>(hostInstance: T): Fiber | null => {
  const rdtHook = globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  if (rdtHook?.renderers) {
    for (const renderer of rdtHook.renderers.values()) {
      try {
        const fiber = renderer.findFiberByHostInstance?.(hostInstance);
        if (fiber) return fiber;
      } catch {}
    }
  }

  if (typeof hostInstance === "object" && hostInstance !== null) {
    const legacyRootFiber = getLegacyRootFiber(hostInstance);
    if (legacyRootFiber) return legacyRootFiber;

    const internalInstanceHandle = getInternalInstanceHandle(hostInstance);
    if (internalInstanceHandle) return internalInstanceHandle;

    for (const knownKey of knownFiberPropertyKeys) {
      const fiber = Reflect.get(hostInstance, knownKey);
      if (isValidFiber(fiber)) return fiber;
    }

    for (const key of Object.keys(hostInstance)) {
      if (isFiberPropertyKey(key)) {
        knownFiberPropertyKeys.add(key);
        const fiber = Reflect.get(hostInstance, key);
        if (isValidFiber(fiber)) return fiber;
      }
    }
  }

  if (
    hostInstance !== null &&
    hostInstance !== undefined &&
    (typeof hostInstance === "object" || typeof hostInstance === "number")
  ) {
    for (const fiberRoot of _fiberRoots) {
      const fiber = traverseFiber(
        fiberRoot.current,
        (candidateFiber) =>
          isHostFiber(candidateFiber) &&
          getPublicHostInstance(candidateFiber.stateNode) === hostInstance,
      );
      if (fiber) return fiber;
    }
  }
  return null;
};

export {
  BIPPY_INSTRUMENTATION_STRING,
  _onActiveListeners,
  _renderers,
  getRDTHook,
  hasRDTHook,
  installRDTHook,
  isRealReactDevtools,
  onRendererInject,
  patchRDTHook,
  version,
} from "./rdt-hook.js";
export type { Unsubscribe } from "./rdt-hook.js";
export type * from "./react-internals/index.js";
