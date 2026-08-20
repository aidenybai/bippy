// React must remain a type-only import because this module loads immediately after the DevTools hook.
import type * as React from "react";

import type {
  Fiber,
  FiberRoot,
  HostFiber,
  ReactDevToolsGlobalHook,
  ReactRenderer,
} from "./react-internals/index.js";

import {
  BIPPY_INSTRUMENTATION_STRING,
  createUnsubscribe,
  getRDTHook,
  hasRDTHook,
  isFiberRootUnmounted,
  isReactRefresh,
  isRealReactDevtools,
  onRDTHookReplace,
  removeActiveListener,
} from "./rdt-hook.js";
import type { ReactDevToolsTarget, Unsubscribe } from "./rdt-hook.js";
import {
  getReactWorkTagsForFiber,
  MutationMask,
  ReactBuildType,
  ReactFiberFlags,
  ReactSymbols,
  setReactWorkTagsForFiber,
} from "./react-internals/index.js";

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

export interface RenderHandler {
  (fiber: Fiber, phase: RenderPhase): unknown;
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
export const isFiber = (fiber: unknown): fiber is Fiber =>
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
  isFiber(fiberRoot.current);

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
      // Host nodes (DOM, root, etc.)
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
 * Returns `true` if the {@link Fiber} should be filtered out during reconciliation.
 */
const shouldFilterFiber = (fiber: Fiber): boolean => {
  const workTags = getReactWorkTagsForFiber(fiber);
  switch (fiber.tag) {
    case workTags.DehydratedSuspenseComponent:
      // TODO: ideally we would show dehydrated Suspense immediately.
      // However, it has some special behavior (like disconnecting
      // an alternate and turning into real Suspense) which breaks DevTools.
      // For now, ignore it, and only show it once it gets hydrated.
      // https://github.com/bvaughn/react-devtools-experimental/issues/197
      return true;

    case workTags.Fragment:
    case workTags.HostText:
    case workTags.LegacyHiddenComponent:
    case workTags.OffscreenComponent:
      return true;

    case workTags.HostRoot:
      // It is never valid to filter the root element.
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
 * Traverses up or down a {@link Fiber}, return `true` to stop and select a node.
 */
export function traverseFiber(
  fiber: Fiber | null,
  selector: (node: Fiber) => boolean | void,
  ascending?: boolean,
): Fiber | null;
export function traverseFiber(
  fiber: Fiber | null,
  selector: (node: Fiber) => Promise<boolean | void>,
  ascending?: boolean,
): Promise<Fiber | null>;
export function traverseFiber(
  fiber: Fiber | null,
  selector: FiberSelector,
  ascending?: boolean,
): Fiber | null | Promise<Fiber | null>;
export function traverseFiber(
  fiber: Fiber | null,
  selector: FiberSelector,
  ascending = false,
): Fiber | null | Promise<Fiber | null> {
  if (!fiber) return null;

  const selection = selector(fiber);
  if (isPromiseLike<boolean | void>(selection)) {
    return Promise.resolve(selection).then((didSelectFiber) =>
      didSelectFiber === true ? fiber : traverseFiberChildren(fiber, selector, ascending),
    );
  }
  if (selection === true) return fiber;

  return traverseFiberChildren(fiber, selector, ascending);
}

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
    if (typeof renderer.version === "string" && renderer.bundleType > ReactBuildType.Production) {
      return "development";
    }
  } catch {}
  return "production";
};

/**
 * Returns `true` if bippy's instrumentation is active.
 */
export const isInstrumentationActive = (target: ReactDevToolsTarget = globalThis): boolean => {
  const rdtHook = target.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  return (
    Boolean(rdtHook?._instrumentationIsActive) ||
    isRealReactDevtools(rdtHook) ||
    isReactRefresh(rdtHook)
  );
};

export const _fiberRoots = new Set<FiberRoot>();
const rootRendererIds = new WeakMap<FiberRoot, number>();
const rootHooks = new WeakMap<FiberRoot, ReactDevToolsGlobalHook>();

/**
 * Returns the latest fiber (since it may be double-buffered).
 */
export const getLatestFiber = (fiber: Fiber): Fiber => {
  const alternate = fiber.alternate;
  if (!alternate) return fiber;

  let rootFiber = fiber;
  while (rootFiber.return) {
    rootFiber = rootFiber.return;
  }
  if (isFiberRoot(rootFiber.stateNode)) {
    const latestFiber = traverseFiber(rootFiber.stateNode.current, (innerFiber) => {
      if (innerFiber === fiber || innerFiber === alternate) return true;
    });
    if (latestFiber) return latestFiber;
  }

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

/**
 * Returns the renderer that owns the {@link Fiber}.
 */
export const getRenderer = (
  fiber: Fiber,
  target: ReactDevToolsTarget = globalThis,
): ReactRenderer | null => {
  let rootFiber = fiber;
  while (rootFiber.return) rootFiber = rootFiber.return;
  const fiberRoot = rootFiber.stateNode;
  if (!isFiberRoot(fiberRoot)) return null;

  const trackedRendererId = rootRendererIds.get(fiberRoot);
  const trackedHook = rootHooks.get(fiberRoot);
  if (trackedRendererId !== undefined && trackedHook) {
    return trackedHook.renderers.get(trackedRendererId) ?? null;
  }

  const rdtHook = target.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  if (!rdtHook?.getFiberRoots) return null;
  for (const [rendererId, renderer] of rdtHook.renderers) {
    if (!rdtHook.getFiberRoots(rendererId).has(fiberRoot)) continue;
    _fiberRoots.add(fiberRoot);
    rootRendererIds.set(fiberRoot, rendererId);
    rootHooks.set(fiberRoot, rdtHook);
    setReactWorkTagsForFiber(fiberRoot.current, renderer);
    return renderer;
  }
  return null;
};

export type RenderPhase = "mount" | "unmount" | "update";

interface FiberReference {
  deref: () => Fiber | undefined;
}

let nextFiberId = 0;
const fiberIdMap = new WeakMap<Fiber, number>();
const fiberByIdMap = new Map<number, FiberReference>();
const fiberIdFinalizationRegistry =
  typeof FinalizationRegistry === "function"
    ? new FinalizationRegistry<number>((fiberId) => {
        if (!fiberByIdMap.get(fiberId)?.deref()) fiberByIdMap.delete(fiberId);
      })
    : null;

const createFiberReference = (fiber: Fiber): FiberReference =>
  typeof WeakRef === "function" ? new WeakRef(fiber) : { deref: () => fiber };

export const setFiberId = (fiber: Fiber, fiberId: number = nextFiberId++): void => {
  const previousFiberId = fiberIdMap.get(fiber);
  if (previousFiberId !== undefined && previousFiberId !== fiberId) {
    fiberByIdMap.delete(previousFiberId);
  }
  fiberIdMap.set(fiber, fiberId);
  fiberByIdMap.set(fiberId, createFiberReference(fiber));
  fiberIdFinalizationRegistry?.register(fiber, fiberId);
  if (Number.isSafeInteger(fiberId) && fiberId >= nextFiberId) {
    nextFiberId = fiberId + 1;
  }
};

export const getFiberId = (fiber: Fiber): number => {
  let currentFiberId = fiberIdMap.get(fiber);
  if (currentFiberId === undefined && fiber.alternate) {
    currentFiberId = fiberIdMap.get(fiber.alternate);
    if (currentFiberId !== undefined) setFiberId(fiber, currentFiberId);
  }
  if (currentFiberId === undefined) {
    currentFiberId = nextFiberId++;
    setFiberId(fiber, currentFiberId);
  }
  return currentFiberId;
};

export const getFiberById = (fiberId: number): Fiber | null => {
  const fiber = fiberByIdMap.get(fiberId)?.deref();
  if (!fiber) {
    fiberByIdMap.delete(fiberId);
    return null;
  }
  return getLatestFiber(fiber);
};

const releaseFiberId = (fiber: Fiber): void => {
  const relatedFibers = fiber.alternate ? [fiber, fiber.alternate] : [fiber];
  const fiberIds = new Set<number>();

  for (const relatedFiber of relatedFibers) {
    const fiberId = fiberIdMap.get(relatedFiber);
    if (fiberId !== undefined) fiberIds.add(fiberId);
    fiberIdMap.delete(relatedFiber);
  }

  for (const fiberId of fiberIds) {
    const assignedFiber = fiberByIdMap.get(fiberId)?.deref();
    if (!assignedFiber || relatedFibers.includes(assignedFiber)) {
      fiberByIdMap.delete(fiberId);
    }
  }
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

    if (fiber.tag === getReactWorkTagsForFiber(fiber).SuspenseComponent) {
      const isTimedOut = fiber.memoizedState !== null;
      if (isTimedOut) {
        // Special case: if Suspense mounts in a timed-out state,
        // get the fallback child from the inner fragment and mount
        // it as if it was our own child. Updates handle this too.
        const primaryChildFragment = fiber.child;
        const fallbackChildFragment = primaryChildFragment ? primaryChildFragment.sibling : null;
        if (fallbackChildFragment) {
          const fallbackChild = fallbackChildFragment.child;
          if (fallbackChild !== null) {
            mountFiberRecursively(onRender, fallbackChild, false);
          }
        }
      } else {
        const primaryChild = fiber.child?.child ?? null;
        if (primaryChild !== null) {
          mountFiberRecursively(onRender, primaryChild, false);
        }
      }
    } else if (fiber.child !== null) {
      mountFiberRecursively(onRender, fiber.child, true);
    }
    fiber = traverseSiblings ? fiber.sibling : null;
  }
};

const updateFiberRecursively = (
  onRender: RenderHandler,
  nextFiber: Fiber,
  prevFiber: Fiber | null,
): void => {
  getFiberId(nextFiber);
  if (!prevFiber) return;
  getFiberId(prevFiber);

  const isSuspense = nextFiber.tag === getReactWorkTagsForFiber(nextFiber).SuspenseComponent;

  const shouldIncludeInTree = !shouldFilterFiber(nextFiber);
  if (shouldIncludeInTree && didFiberRender(nextFiber)) {
    onRender(nextFiber, "update");
  }

  // The behavior of timed-out Suspense trees is unique.
  // Rather than unmount the timed out content (and possibly lose important state),
  // React re-parents this content within a hidden Fragment while the fallback is showing.
  // This behavior doesn't need to be observable in the DevTools though.
  // It might even result in a bad user experience for e.g. node selection in the Elements panel.
  // The easiest fix is to strip out the intermediate Fragment fibers,
  // so the Elements panel and Profiler don't need to special case them.
  // Suspense components only have a non-null memoizedState if they're timed-out.
  const prevDidTimeout = isSuspense && prevFiber.memoizedState !== null;
  const nextDidTimeOut = isSuspense && nextFiber.memoizedState !== null;

  // The logic below is inspired by the code paths in updateSuspenseComponent()
  // inside ReactFiberBeginWork in the React source code.
  if (prevDidTimeout && nextDidTimeOut) {
    // Fallback -> Fallback:
    // 1. Reconcile fallback set.
    const nextFallbackChildSet = nextFiber.child?.sibling ?? null;
    // Note: We can't use nextFiber.child.sibling.alternate
    // because the set is special and alternate may not exist.
    const prevFallbackChildSet = prevFiber.child?.sibling ?? null;

    if (nextFallbackChildSet !== null && prevFallbackChildSet !== null) {
      updateFiberRecursively(onRender, nextFallbackChildSet, prevFallbackChildSet);
    }
  } else if (prevDidTimeout && !nextDidTimeOut) {
    // Fallback -> Primary:
    // 1. Unmount fallback set
    // Note: don't emulate fallback unmount because React actually did it.
    // 2. Mount primary set
    const nextPrimaryChildSet = nextFiber.child;

    if (nextPrimaryChildSet !== null) {
      mountFiberRecursively(onRender, nextPrimaryChildSet, true);
    }
  } else if (!prevDidTimeout && nextDidTimeOut) {
    // Primary -> Fallback:
    // 1. Hide primary set
    // This is not a real unmount, so it won't get reported by React.
    // We need to manually walk the previous tree and record unmounts.
    unmountFiberChildrenRecursively(onRender, prevFiber);

    // 2. Mount fallback set
    const nextFallbackChildSet = nextFiber.child?.sibling ?? null;

    if (nextFallbackChildSet !== null) {
      mountFiberRecursively(onRender, nextFallbackChildSet, true);
    }
  } else if (nextFiber.child !== prevFiber.child) {
    // Common case: Primary -> Primary.
    // This is the same code path as for non-Suspense fibers.

    // If the first child is different, we need to traverse them.
    // Each next child will be either a new child (mount) or an alternate (update).
    let nextChild = nextFiber.child;

    while (nextChild) {
      // We already know children will be referentially different because
      // they are either new mounts or alternates of previous children.
      // Schedule updates and mounts depending on whether alternates exist.
      // We don't track deletions here because they are reported separately.
      if (nextChild.alternate) {
        updateFiberRecursively(onRender, nextChild, nextChild.alternate);
      } else {
        mountFiberRecursively(onRender, nextChild, false);
      }

      // Try the next child.
      nextChild = nextChild.sibling;
    }
  }
};

const unmountFiber = (onRender: RenderHandler, fiber: Fiber): void => {
  const isRoot = fiber.tag === getReactWorkTagsForFiber(fiber).HostRoot;

  if (isRoot || !shouldFilterFiber(fiber)) {
    onRender(fiber, "unmount");
  }
};

const unmountFiberChildrenRecursively = (onRender: RenderHandler, fiber: Fiber): void => {
  // We might meet a nested Suspense on our way.
  const isTimedOutSuspense =
    fiber.tag === getReactWorkTagsForFiber(fiber).SuspenseComponent && fiber.memoizedState !== null;
  let child = fiber.child;

  if (isTimedOutSuspense) {
    // If it's showing fallback tree, let's traverse it instead.
    const primaryChildFragment = fiber.child;
    const fallbackChildFragment = primaryChildFragment?.sibling ?? null;

    // Skip over to the real Fiber child.
    child = fallbackChildFragment?.child ?? null;
  }

  while (child !== null) {
    // Record simulated unmounts children-first.
    // We skip nodes without return because those are real unmounts.
    if (child.return !== null) {
      unmountFiber(onRender, child);
      unmountFiberChildrenRecursively(onRender, child);
    }

    child = child.sibling;
  }
};

const rootInstanceMap = new WeakMap<
  Fiber | FiberRoot,
  {
    prevFiber: Fiber | null;
  }
>();

// Roots from custom renderers may not have a memoizedState at all.
const isRootFiberMounted = (fiber: Fiber): boolean => {
  const rootState = fiber.memoizedState;
  if (rootState === null || rootState === undefined) return false;
  return (
    rootState.element !== null &&
    rootState.element !== undefined &&
    // A dehydrated root is not considered mounted
    rootState.isDehydrated !== true
  );
};

/**
 * Creates a fiber visitor function. Must pass a fiber root and a render handler.
 * @example
 * traverseRenderedFibers(root, (fiber, phase) => {
 *   console.log(phase)
 * })
 */
export const traverseRenderedFibers = (root: Fiber | FiberRoot, onRender: RenderHandler): void => {
  const fiber = "current" in root ? root.current : root;

  let rootInstance = rootInstanceMap.get(root);

  if (!rootInstance) {
    rootInstance = { prevFiber: null };
    rootInstanceMap.set(root, rootInstance);
  }

  const { prevFiber } = rootInstance;
  if (!fiber) {
    if (prevFiber) {
      unmountFiber(onRender, prevFiber);
    }
  } else if (prevFiber !== null) {
    const wasMounted = isRootFiberMounted(prevFiber);
    const isMounted = isRootFiberMounted(fiber);

    if (!wasMounted && isMounted) {
      mountFiberRecursively(onRender, fiber, false);
    } else if (wasMounted && isMounted) {
      updateFiberRecursively(onRender, fiber, fiber.alternate);
    } else if (wasMounted && !isMounted) {
      unmountFiber(onRender, fiber);
    }
  } else {
    mountFiberRecursively(onRender, fiber, true);
  }

  rootInstance.prevFiber = fiber;
};

export interface InstrumentationOptions {
  name?: string;
  target?: ReactDevToolsTarget;
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
  target: ReactDevToolsTarget;
}

const instrumentationSubscriptions = new Set<InstrumentationSubscription>();

interface HookDispatchers {
  onCommitFiberRoot: ReactDevToolsGlobalHook["onCommitFiberRoot"];
  onCommitFiberUnmount: ReactDevToolsGlobalHook["onCommitFiberUnmount"];
  onPostCommitFiberRoot: ReactDevToolsGlobalHook["onPostCommitFiberRoot"];
  onScheduleFiberRoot: NonNullable<ReactDevToolsGlobalHook["onScheduleFiberRoot"]>;
}

const hookDispatchers = new WeakMap<ReactDevToolsGlobalHook, Partial<HookDispatchers>>();
const hookTargets = new WeakMap<ReactDevToolsGlobalHook, ReactDevToolsTarget>();
let didSubscribeToHookReplacements = false;

// each hook event is dispatched from a single re-installable wrapper. If
// something overwrites the hook method (devtools, direct assignment), the
// next instrument() call installs a fresh wrapper over it; a superseded
// wrapper still forwards the previous chain but skips the listeners so
// they never fire twice.
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
      // Custom renderers and test harnesses commit roots without a memoizedState;
      // those must stay tracked, so only explicit unmount evidence removes a root.
      if (isFiberRootUnmounted(root)) {
        _fiberRoots.delete(root);
        rootRendererIds.delete(root);
        rootHooks.delete(root);
      } else {
        _fiberRoots.add(root);
        rootRendererIds.set(root, rendererID);
        rootHooks.set(root, rdtHook);
      }
      for (const { options, target } of instrumentationSubscriptions) {
        if (target === hookTargets.get(rdtHook) && options.onCommitFiberRoot) {
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
      try {
        for (const { options, target } of instrumentationSubscriptions) {
          if (target === hookTargets.get(rdtHook) && options.onCommitFiberUnmount) {
            options.onCommitFiberUnmount(rendererID, fiber);
          }
        }
      } finally {
        releaseFiberId(fiber);
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
      for (const { options, target } of instrumentationSubscriptions) {
        if (target === hookTargets.get(rdtHook) && options.onPostCommitFiberRoot) {
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
      for (const { options, target } of instrumentationSubscriptions) {
        if (target === hookTargets.get(rdtHook) && options.onScheduleFiberRoot) {
          options.onScheduleFiberRoot(rendererID, root, children);
        }
      }
    };
    dispatchers.onScheduleFiberRoot = dispatchScheduleFiberRoot;
    rdtHook.onScheduleFiberRoot = dispatchScheduleFiberRoot;
  }
};

const handleHookReplacement = (
  rdtHook: ReactDevToolsGlobalHook,
  target: ReactDevToolsTarget,
): void => {
  hookTargets.set(rdtHook, target);
  setHookEventDispatchers(rdtHook);
};

const wireHookEventDispatchers = (
  rdtHook: ReactDevToolsGlobalHook,
  target: ReactDevToolsTarget = globalThis,
): void => {
  if (!didSubscribeToHookReplacements) {
    onRDTHookReplace(handleHookReplacement);
    didSubscribeToHookReplacements = true;
  }
  hookTargets.set(rdtHook, target);
  setHookEventDispatchers(rdtHook);
};

// Importing bippy must never crash module evaluation, even when a foreign
// hook is frozen or otherwise rejects patching.
try {
  if (hasRDTHook()) {
    wireHookEventDispatchers(getRDTHook());
  }
} catch {}

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
  const target = options.target ?? globalThis;
  const rdtHook = getRDTHook(options.onActive, target);
  rdtHook._instrumentationSource = options.name ?? BIPPY_INSTRUMENTATION_STRING;

  wireHookEventDispatchers(rdtHook, target);
  const subscription: InstrumentationSubscription = { options, target };
  instrumentationSubscriptions.add(subscription);

  return createUnsubscribe(() => {
    if (options.onActive) removeActiveListener(options.onActive, target);
    instrumentationSubscriptions.delete(subscription);
  });
};

// React uses per-renderer suffixes for host-instance Fiber keys, so discovered keys are cached.
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
  return isFiber(child) ? child : null;
};

const getInternalInstanceHandle = (hostInstance: object): Fiber | null => {
  const internalInstanceHandle =
    Reflect.get(hostInstance, "__internalInstanceHandle") ??
    Reflect.get(hostInstance, "_internalInstanceHandle");
  return isFiber(internalInstanceHandle) ? internalInstanceHandle : null;
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

export const getFiber = <HostInstance>(
  hostInstance: HostInstance,
  target: ReactDevToolsTarget = globalThis,
): Fiber | null => {
  const rdtHook = target.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  if (rdtHook) {
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
      if (isFiber(fiber)) return fiber;
    }

    for (const key of Object.keys(hostInstance)) {
      if (isFiberPropertyKey(key)) {
        knownFiberPropertyKeys.add(key);
        const fiber = Reflect.get(hostInstance, key);
        if (isFiber(fiber)) return fiber;
      }
    }
  }

  if (
    hostInstance !== null &&
    hostInstance !== undefined &&
    (typeof hostInstance === "object" || typeof hostInstance === "number")
  ) {
    const targetFiberRoots = new Set<FiberRoot>();
    if (rdtHook?.getFiberRoots) {
      for (const rendererId of rdtHook.renderers.keys()) {
        for (const fiberRoot of rdtHook.getFiberRoots(rendererId)) {
          targetFiberRoots.add(fiberRoot);
        }
      }
    }
    for (const fiberRoot of _fiberRoots) {
      if (rootHooks.get(fiberRoot) === rdtHook) targetFiberRoots.add(fiberRoot);
    }
    for (const fiberRoot of targetFiberRoots) {
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

export const getFiberFromHostInstance = getFiber;

export {
  BIPPY_INSTRUMENTATION_STRING,
  _onActiveListeners,
  _renderers,
  getRDTHook,
  hasRDTHook,
  installRDTHook,
  isFiberRootUnmounted,
  isReactRefresh,
  isRealReactDevtools,
  onRendererInject,
  patchRDTHook,
  version,
} from "./rdt-hook.js";
export type { ReactDevToolsTarget, Unsubscribe } from "./rdt-hook.js";
export * from "./react-internals/index.js";
