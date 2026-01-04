// [!!!] IMPORTANT: do not import React in this file
// since it will be executed before the react devtools hook is created

import type * as React from 'react';

import type {
  ContextDependency,
  Fiber,
  FiberRoot,
  MemoizedState,
  ReactDevToolsGlobalHook,
  ReactRenderer,
} from './types.js';

import {
  BIPPY_INSTRUMENTATION_STRING,
  getRDTHook,
  hasRDTHook,
  isReactRefresh,
  isRealReactDevtools,
} from './rdt-hook.js';

// https://github.com/facebook/react/blob/main/packages/react-reconciler/src/ReactWorkTags.js
export const FunctionComponentTag = 0;
export const ClassComponentTag = 1;
export const HostRootTag = 3;
export const HostComponentTag = 5;
export const HostTextTag = 6;
export const FragmentTag = 7;
export const ContextConsumerTag = 9;
export const ForwardRefTag = 11;
export const SuspenseComponentTag = 13;
export const MemoComponentTag = 14;
export const SimpleMemoComponentTag = 15;
export const LazyComponentTag = 16;
export const DehydratedSuspenseComponentTag = 18;
export const SuspenseListComponentTag = 19;
export const OffscreenComponentTag = 22;
export const LegacyHiddenComponentTag = 23;
export const HostHoistableTag = 26;
export const HostSingletonTag = 27;
export const ActivityComponentTag = 28;
export const ViewTransitionComponentTag = 30;

export const CONCURRENT_MODE_NUMBER = 0xeacf;
export const ELEMENT_TYPE_SYMBOL_STRING = 'Symbol(react.element)';
export const TRANSITIONAL_ELEMENT_TYPE_SYMBOL_STRING =
  'Symbol(react.transitional.element)';
export const CONCURRENT_MODE_SYMBOL_STRING = 'Symbol(react.concurrent_mode)';
export const DEPRECATED_ASYNC_MODE_SYMBOL_STRING = 'Symbol(react.async_mode)';

// https://github.com/facebook/react/blob/main/packages/react-reconciler/src/ReactFiberFlags.js
const PerformedWork = 0b1;
const Placement = 0b10;
const Hydrating = 0b1000000000000;
const Update = 0b100;
const Cloned = 0b1000;
const ChildDeletion = 0b10000;
const ContentReset = 0b100000;
const Snapshot = 0b10000000000;
const Visibility = 0b10000000000000;
const MutationMask =
  Placement |
  Update |
  ChildDeletion |
  ContentReset |
  Hydrating |
  Visibility |
  Snapshot;

/**
 * Returns `true` if object is a React Element.
 *
 * @see https://react.dev/reference/react/isValidElement
 */
export const isValidElement = (
  element: unknown,
): element is React.ReactElement =>
  typeof element === 'object' &&
  element != null &&
  '$$typeof' in element &&
  // react 18 uses Symbol.for('react.element'), react 19 uses Symbol.for('react.transitional.element')
  [
    ELEMENT_TYPE_SYMBOL_STRING,
    TRANSITIONAL_ELEMENT_TYPE_SYMBOL_STRING,
  ].includes(String(element.$$typeof));

/**
 * Returns `true` if object is a React Fiber.
 */
export const isValidFiber = (fiber: unknown): fiber is Fiber =>
  typeof fiber === 'object' &&
  fiber != null &&
  'tag' in fiber &&
  'stateNode' in fiber &&
  'return' in fiber &&
  'child' in fiber &&
  'sibling' in fiber &&
  'flags' in fiber;

/**
 * Returns `true` if fiber is a host fiber. Host fibers are DOM nodes in react-dom, `View` in react-native, etc.
 *
 * @see https://reactnative.dev/architecture/glossary#host-view-tree-and-host-view
 */
export const isHostFiber = (fiber: Fiber): boolean => {
  switch (fiber.tag) {
    case HostComponentTag:
    // @ts-expect-error: it exists
    case HostHoistableTag:
    // @ts-expect-error: it exists
    case HostSingletonTag:
      return true;
    default:
      return typeof fiber.type === 'string';
  }
};

/**
 * Returns `true` if fiber is a composite fiber. Composite fibers are fibers that can render (like functional components, class components, etc.)
 *
 * @see https://reactnative.dev/architecture/glossary#react-composite-components
 */
export const isCompositeFiber = (fiber: Fiber): boolean => {
  switch (fiber.tag) {
    case ClassComponentTag:
    case ForwardRefTag:
    case FunctionComponentTag:
    case MemoComponentTag:
    case SimpleMemoComponentTag:
      return true;
    default:
      return false;
  }
};

/**
 * Returns `true` if the object is a {@link Fiber}
 */
export const isFiber = (maybeFiber: unknown): maybeFiber is Fiber => {
  if (!maybeFiber || typeof maybeFiber !== 'object') return false;
  // this is a fast check. pendingProps will ALWAYS exist in fiber
  // `containerInfo` is in FiberRootNode, not FiberNode
  return 'pendingProps' in maybeFiber && !('containerInfo' in maybeFiber);
};

/**
 * Returns `true` if the two {@link Fiber}s are the same reference
 */
export const areFiberEqual = (fiberA: Fiber, fiberB: Fiber): boolean => {
  return (
    fiberA === fiberB ||
    fiberA.alternate === fiberB ||
    fiberB.alternate === fiberA
  );
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
      typeof nextDependencies !== 'object' ||
      !('firstContext' in nextDependencies) ||
      typeof prevDependencies !== 'object' ||
      !('firstContext' in prevDependencies)
    ) {
      return false;
    }
    let nextContext: ContextDependency<unknown> | null | undefined =
      nextDependencies.firstContext;
    let prevContext: ContextDependency<unknown> | null | undefined =
      prevDependencies.firstContext;
    while (
      (nextContext &&
        typeof nextContext === 'object' &&
        'memoizedValue' in nextContext) ||
      (prevContext &&
        typeof prevContext === 'object' &&
        'memoizedValue' in prevContext)
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
    let prevState: MemoizedState | null | undefined =
      fiber.alternate?.memoizedState;

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
  selector: (
    propName: string,
    nextValue: unknown,
    prevValue: unknown,
  ) => boolean | void,
): boolean => {
  try {
    const nextProps = fiber.memoizedProps;
    const prevProps = fiber.alternate?.memoizedProps || {};

    const allKeys = new Set([
      ...Object.keys(nextProps),
      ...Object.keys(prevProps),
    ]);

    for (const propName of allKeys) {
      const prevValue = prevProps?.[propName];
      const nextValue = nextProps?.[propName];

      if (selector(propName, nextValue, prevValue) === true) return true;
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
  const flags =
    fiber.flags ?? (fiber as unknown as { effectTag: number }).effectTag ?? 0;

  switch (fiber.tag) {
    case ClassComponentTag:
    case ContextConsumerTag:
    case ForwardRefTag:
    case FunctionComponentTag:
    case MemoComponentTag:
    case SimpleMemoComponentTag: {
      return (flags & PerformedWork) === PerformedWork;
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
    (fiber.flags & (MutationMask | Cloned)) !== 0 ||
      (fiber.subtreeFlags & (MutationMask | Cloned)) !== 0,
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
    currentFiber = currentFiber.return as Fiber;
  }
  return stack;
};

/**
 * Returns `true` if the {@link Fiber} should be filtered out during reconciliation.
 */
export const shouldFilterFiber = (fiber: Fiber): boolean => {
  switch (fiber.tag) {
    case DehydratedSuspenseComponentTag:
      // TODO: ideally we would show dehydrated Suspense immediately.
      // However, it has some special behavior (like disconnecting
      // an alternate and turning into real Suspense) which breaks DevTools.
      // For now, ignore it, and only show it once it gets hydrated.
      // https://github.com/bvaughn/react-devtools-experimental/issues/197
      return true;

    case FragmentTag:
    case HostTextTag:
    case LegacyHiddenComponentTag:
    case OffscreenComponentTag:
      return true;

    case HostRootTag:
      // It is never valid to filter the root element.
      return false;

    default: {
      const symbolOrNumber =
        typeof fiber.type === 'object' && fiber.type !== null
          ? fiber.type.$$typeof
          : fiber.type;

      const typeSymbol =
        typeof symbolOrNumber === 'symbol'
          ? symbolOrNumber.toString()
          : symbolOrNumber;

      switch (typeSymbol) {
        case CONCURRENT_MODE_NUMBER:
        case CONCURRENT_MODE_SYMBOL_STRING:
        case DEPRECATED_ASYNC_MODE_SYMBOL_STRING:
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
export const getNearestHostFiber = (
  fiber: Fiber,
  ascending = false,
): Fiber | null => {
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
  selector: (node: Fiber) => boolean | Promise<boolean | void> | void,
  ascending = false,
): Fiber | null | Promise<Fiber | null> {
  if (!fiber) return null;

  const firstResult = selector(fiber);
  if (firstResult instanceof Promise) {
    return (async () => {
      if ((await firstResult) === true) return fiber;

      let child = ascending ? fiber.return : fiber.child;
      while (child) {
        const match = await traverseFiberAsync(
          child,
          selector as (node: Fiber) => Promise<boolean | void>,
          ascending,
        );
        if (match) return match;
        child = ascending ? null : child.sibling;
      }
      return null;
    })();
  }

  if (firstResult === true) return fiber;

  let child = ascending ? fiber.return : fiber.child;
  while (child) {
    const match = traverseFiberSync(
      child,
      selector as (node: Fiber) => boolean | void,
      ascending,
    );
    if (match) return match;
    child = ascending ? null : child.sibling;
  }
  return null;
}

export const traverseFiberSync = (
  fiber: Fiber | null,
  selector: (node: Fiber) => boolean | void,
  ascending = false,
): Fiber | null => {
  if (!fiber) return null;
  if (selector(fiber) === true) return fiber;

  let child = ascending ? fiber.return : fiber.child;
  while (child) {
    const match = traverseFiberSync(child, selector, ascending);
    if (match) return match;

    child = ascending ? null : child.sibling;
  }
  return null;
};

export const traverseFiberAsync = async (
  fiber: Fiber | null,
  selector: (node: Fiber) => Promise<boolean | void>,
  ascending = false,
): Promise<Fiber | null> => {
  if (!fiber) return null;
  if ((await selector(fiber)) === true) return fiber;

  let child = ascending ? fiber.return : fiber.child;
  while (child) {
    const match = await traverseFiberAsync(child, selector, ascending);
    if (match) return match;

    child = ascending ? null : child.sibling;
  }
  return null;
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
export const getTimings = (
  fiber?: Fiber | null,
): { selfTime: number; totalTime: number } => {
  const totalTime = fiber?.actualDuration ?? 0;
  let selfTime = totalTime;
  // TODO: calculate a DOM time, which is just host component summed up
  let child = fiber?.child ?? null;
  while (totalTime > 0 && child != null) {
    selfTime -= child.actualDuration ?? 0;
    child = child.sibling;
  }
  return { selfTime, totalTime };
};

/**
 * Returns `true` if the {@link Fiber} uses React Compiler's memo cache.
 */
export const hasMemoCache = (fiber: Fiber): boolean => {
  return Boolean(
    (fiber.updateQueue as unknown as { memoCache: unknown })?.memoCache,
  );
};

type FiberType =
  | React.ComponentType<unknown>
  | React.ForwardRefExoticComponent<unknown>
  | React.MemoExoticComponent<React.ComponentType<unknown>>;

/**
 * Returns the type (e.g. component definition) of the {@link Fiber}
 */
export const getType = (type: unknown): null | React.ComponentType<unknown> => {
  const currentType = type as FiberType;
  if (typeof currentType === 'function') {
    return currentType;
  }
  if (typeof currentType === 'object' && currentType) {
    // memo / forwardRef case
    return getType(
      (currentType as React.MemoExoticComponent<React.ComponentType<unknown>>)
        .type ||
        (currentType as { render: React.ComponentType<unknown> }).render,
    );
  }
  return null;
};

/**
 * Returns the display name of the {@link Fiber} type.
 */
export const getDisplayName = (type: unknown): null | string => {
  const currentType = type as FiberType;
  if (typeof currentType === 'string') {
    return currentType;
  }
  if (
    typeof currentType !== 'function' &&
    !(typeof currentType === 'object' && currentType)
  ) {
    return null;
  }
  const name = currentType.displayName || currentType.name || null;
  if (name) return name;
  const unwrappedType = getType(currentType);
  if (!unwrappedType) return null;
  return unwrappedType.displayName || unwrappedType.name || null;
};

/**
 * Returns the build type of the React renderer.
 */
export const detectReactBuildType = (
  renderer: ReactRenderer,
): 'development' | 'production' => {
  try {
    if (typeof renderer.version === 'string' && renderer.bundleType > 0) {
      return 'development';
    }
  } catch {}
  return 'production';
};

/**
 * Returns `true` if bippy's instrumentation is active.
 */
export const isInstrumentationActive = (): boolean => {
  const rdtHook = getRDTHook();
  return (
    Boolean(rdtHook._instrumentationIsActive) ||
    isRealReactDevtools() ||
    isReactRefresh()
  );
};

/**
 * Returns the latest fiber (since it may be double-buffered).
 */
export const getLatestFiber = (fiber: Fiber): Fiber => {
  const alternate = fiber.alternate;
  if (!alternate) return fiber;
  if (alternate.actualStartTime && fiber.actualStartTime) {
    return alternate.actualStartTime > fiber.actualStartTime
      ? alternate
      : fiber;
  }
  for (const root of _fiberRoots) {
    const latestFiber = traverseFiber(root.current, (innerFiber) => {
      if (innerFiber === fiber) return true;
    });
    if (latestFiber) return latestFiber;
  }
  return fiber;
};

export type RenderHandler = <S>(
  fiber: Fiber,
  phase: RenderPhase,
  state?: S,
) => unknown;

export type RenderPhase = 'mount' | 'unmount' | 'update';

let fiberId = 0;
export const fiberIdMap = new WeakMap<Fiber, number>();

export const setFiberId = (fiber: Fiber, id: number = fiberId++): void => {
  fiberIdMap.set(fiber, id);
};

// react fibers are double buffered, so the alternate fiber may
// be switched to the current fiber and vice versa.
// fiber === fiber.alternate.alternate
export const getFiberId = (fiber: Fiber): number => {
  let id = fiberIdMap.get(fiber);
  if (!id && fiber.alternate) {
    id = fiberIdMap.get(fiber.alternate);
  }
  if (!id) {
    id = fiberId++;
    setFiberId(fiber, id);
  }
  return id;
};

export const mountFiberRecursively = (
  onRender: RenderHandler,
  firstChild: Fiber,
  traverseSiblings: boolean,
): void => {
  let fiber: Fiber | null = firstChild;

  while (fiber != null) {
    if (!fiberIdMap.has(fiber)) {
      getFiberId(fiber);
    }
    const shouldIncludeInTree = !shouldFilterFiber(fiber);
    if (shouldIncludeInTree && didFiberRender(fiber)) {
      onRender(fiber, 'mount');
    }

    if (fiber.tag === SuspenseComponentTag) {
      const isTimedOut = fiber.memoizedState !== null;
      if (isTimedOut) {
        // Special case: if Suspense mounts in a timed-out state,
        // get the fallback child from the inner fragment and mount
        // it as if it was our own child. Updates handle this too.
        const primaryChildFragment = fiber.child;
        const fallbackChildFragment = primaryChildFragment
          ? primaryChildFragment.sibling
          : null;
        if (fallbackChildFragment) {
          const fallbackChild = fallbackChildFragment.child;
          if (fallbackChild !== null) {
            mountFiberRecursively(onRender, fallbackChild, false);
          }
        }
      } else {
        let primaryChild: Fiber | null = null;
        const areSuspenseChildrenConditionallyWrapped =
          (OffscreenComponentTag as number) === -1;
        if (areSuspenseChildrenConditionallyWrapped) {
          primaryChild = fiber.child;
        } else if (fiber.child !== null) {
          primaryChild = fiber.child.child;
        }
        if (primaryChild !== null) {
          mountFiberRecursively(onRender, primaryChild, false);
        }
      }
    } else if (fiber.child != null) {
      mountFiberRecursively(onRender, fiber.child, true);
    }
    fiber = traverseSiblings ? fiber.sibling : null;
  }
};

export const updateFiberRecursively = (
  onRender: RenderHandler,
  nextFiber: Fiber,
  prevFiber: Fiber,
  parentFiber: Fiber | null,
): void => {
  if (!fiberIdMap.has(nextFiber)) {
    getFiberId(nextFiber);
  }
  if (!prevFiber) return;
  if (!fiberIdMap.has(prevFiber)) {
    getFiberId(prevFiber);
  }

  const isSuspense = nextFiber.tag === SuspenseComponentTag;

  const shouldIncludeInTree = !shouldFilterFiber(nextFiber);
  if (shouldIncludeInTree && didFiberRender(nextFiber)) {
    onRender(nextFiber, 'update');
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
      updateFiberRecursively(
        onRender,
        nextFallbackChildSet,
        prevFallbackChildSet,
        nextFiber,
      );
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
        const prevChild = nextChild.alternate;

        updateFiberRecursively(
          onRender,
          nextChild,
          prevChild,
          shouldIncludeInTree ? nextFiber : parentFiber,
        );
      } else {
        mountFiberRecursively(onRender, nextChild, false);
      }

      // Try the next child.
      nextChild = nextChild.sibling;
    }
  }
};

export const unmountFiber = (onRender: RenderHandler, fiber: Fiber): void => {
  const isRoot = fiber.tag === HostRootTag;

  if (isRoot || !shouldFilterFiber(fiber)) {
    onRender(fiber, 'unmount');
  }
};

export const unmountFiberChildrenRecursively = (
  onRender: RenderHandler,
  fiber: Fiber,
): void => {
  // We might meet a nested Suspense on our way.
  const isTimedOutSuspense =
    fiber.tag === SuspenseComponentTag && fiber.memoizedState !== null;
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

let commitId = 0;
const rootInstanceMap = new WeakMap<
  FiberRoot,
  {
    id: number;
    prevFiber: Fiber | null;
  }
>();

/**
 * Creates a fiber visitor function. Must pass a fiber root and a render handler.
 * @example
 * traverseRenderedFibers(root, (fiber, phase) => {
 *   console.log(phase)
 * })
 */
export const traverseRenderedFibers = (
  root: FiberRoot,
  onRender: RenderHandler,
): void => {
  const fiber = 'current' in root ? root.current : root;

  let rootInstance = rootInstanceMap.get(root);

  if (!rootInstance) {
    rootInstance = { id: commitId++, prevFiber: null };
    rootInstanceMap.set(root, rootInstance);
  }

  const { prevFiber } = rootInstance;
  // if fiberRoot don't have current instance, means it's been unmounted
  if (!fiber) {
    unmountFiber(onRender, fiber);
  } else if (prevFiber !== null) {
    const wasMounted =
      prevFiber &&
      prevFiber.memoizedState != null &&
      prevFiber.memoizedState.element != null &&
      // A dehydrated root is not considered mounted
      prevFiber.memoizedState.isDehydrated !== true;
    const isMounted =
      fiber.memoizedState != null &&
      fiber.memoizedState.element != null &&
      // A dehydrated root is not considered mounted
      fiber.memoizedState.isDehydrated !== true;

    if (!wasMounted && isMounted) {
      mountFiberRecursively(onRender, fiber, false);
    } else if (wasMounted && isMounted) {
      updateFiberRecursively(onRender, fiber, fiber.alternate, null);
    } else if (wasMounted && !isMounted) {
      unmountFiber(onRender, fiber);
    }
  } else {
    mountFiberRecursively(onRender, fiber, true);
  }

  rootInstance.prevFiber = fiber;
};

let _overrideProps: null | ReactRenderer['overrideProps'] = null;
let _overrideHookState: null | ReactRenderer['overrideHookState'] = null;
let _overrideContext: null | ReactRenderer['overrideContext'] = null;

export const injectOverrideMethods = () => {
  if (!hasRDTHook()) return null;
  const rdtHook = getRDTHook();
  if (!rdtHook?.renderers) return null;

  if (_overrideProps || _overrideHookState || _overrideContext) {
    return {
      overrideContext: _overrideContext,
      overrideHookState: _overrideHookState,
      overrideProps: _overrideProps,
    };
  }

  for (const [, renderer] of Array.from(rdtHook.renderers)) {
    try {
      if (_overrideHookState) {
        const prevOverrideHookState = _overrideHookState;
        _overrideHookState = (
          fiber: Fiber,
          id: string,
          path: string[],
          value: unknown,
        ) => {
          let current = fiber.memoizedState;
          for (let i = 0; i < Number(id); i++) {
            if (!current?.next) break;
            current = current.next;
          }

          if (current?.queue) {
            const queue = current.queue;
            if (isPOJO(queue) && 'dispatch' in queue) {
              const dispatch = queue.dispatch as (value: unknown) => void;
              dispatch(value);
              return;
            }
          }

          prevOverrideHookState(fiber, id, path, value);
          renderer.overrideHookState?.(fiber, id, path, value);
        };
      } else if (renderer.overrideHookState) {
        _overrideHookState = renderer.overrideHookState;
      }

      if (_overrideProps) {
        const prevOverrideProps = _overrideProps;
        _overrideProps = (
          fiber: Fiber,
          path: Array<string>,
          value: unknown,
        ) => {
          prevOverrideProps(fiber, path, value);
          renderer.overrideProps?.(fiber, path, value);
        };
      } else if (renderer.overrideProps) {
        _overrideProps = renderer.overrideProps;
      }

      _overrideContext = (
        fiber: Fiber,
        contextType: unknown,
        path: string[],
        value: unknown,
      ) => {
        let current: Fiber | null = fiber;
        while (current) {
          const type = current.type as { Provider?: unknown };
          if (type === contextType || type?.Provider === contextType) {
            if (_overrideProps) {
              _overrideProps(current, ['value', ...path], value);
              if (current.alternate) {
                _overrideProps(current.alternate, ['value', ...path], value);
              }
            }
            break;
          }
          current = current.return;
        }
      };
    } catch {
      /**/
    }
  }
};

const isPOJO = (maybePOJO: unknown): maybePOJO is Record<string, unknown> => {
  return (
    Object.prototype.toString.call(maybePOJO) === '[object Object]' &&
    (Object.getPrototypeOf(maybePOJO) === Object.prototype ||
      Object.getPrototypeOf(maybePOJO) === null)
  );
};

const buildPathsFromValue = (
  maybePOJO: Record<string, unknown>,
  basePath: string[] = [],
): Array<{ path: string[]; value: unknown }> => {
  if (!isPOJO(maybePOJO)) {
    return [{ path: basePath, value: maybePOJO }];
  }

  const paths: Array<{ path: string[]; value: unknown }> = [];

  for (const key in maybePOJO) {
    const value = maybePOJO[key];
    const path = basePath.concat(key);

    if (isPOJO(value)) {
      paths.push(...buildPathsFromValue(value, path));
    } else {
      paths.push({ path, value });
    }
  }

  return paths;
};

export const overrideProps = (
  fiber: Fiber,
  partialValue: Record<string, unknown>,
) => {
  injectOverrideMethods();

  const paths = buildPathsFromValue(partialValue);

  for (const { path, value } of paths) {
    try {
      _overrideProps?.(fiber, path, value);
    } catch {}
  }
};

export const overrideHookState = (
  fiber: Fiber,
  id: number,
  partialValue: Record<string, unknown>,
) => {
  injectOverrideMethods();

  const hookId = String(id);

  if (isPOJO(partialValue)) {
    const paths = buildPathsFromValue(partialValue);

    for (const { path, value } of paths) {
      try {
        _overrideHookState?.(fiber, hookId, path, value);
      } catch {}
    }
  } else {
    try {
      _overrideHookState?.(fiber, hookId, [], partialValue);
    } catch {}
  }
};

export const overrideContext = (
  fiber: Fiber,
  contextType: unknown,
  partialValue: Record<string, unknown>,
) => {
  injectOverrideMethods();

  if (isPOJO(partialValue)) {
    const paths = buildPathsFromValue(partialValue);

    for (const { path, value } of paths) {
      try {
        _overrideContext?.(fiber, contextType, path, value);
      } catch {}
    }
  } else {
    try {
      _overrideContext?.(fiber, contextType, [], partialValue);
    } catch {}
  }
};

interface DispatcherRef {
  H?: unknown;
  current?: unknown;
}

interface Dispatcher {
  useState: <S>(initialState: S | (() => S)) => [S, (action: S | ((prev: S) => S)) => void];
  useReducer: <S, A>(
    reducer: (state: S, action: A) => S,
    initialArg: S,
    init?: (arg: S) => S,
  ) => [S, (action: A) => void];
  useSyncExternalStore: <T>(
    subscribe: (onStoreChange: () => void) => () => void,
    getSnapshot: () => T,
    getServerSnapshot?: () => T,
  ) => T;
  [key: string]: unknown;
}

interface HookQueue {
  pending?: unknown;
  dispatch?: (...args: unknown[]) => void;
  lastRenderedReducer?: unknown;
  lanes?: number;
  value?: unknown;
  getSnapshot?: () => unknown;
}

interface HookState {
  memoizedState: unknown;
  baseState: unknown;
  baseQueue: unknown;
  queue: HookQueue | null;
  next: HookState | null;
}

interface FrozenQueueData {
  originalPendingDescriptor?: PropertyDescriptor;
  originalGetSnapshot?: () => unknown;
  frozenSnapshotValue?: unknown;
}

let isFrozen = false;
const originalDispatcherRefs = new Map<ReactRenderer, { key: 'H' | 'current'; originalDescriptor: PropertyDescriptor | undefined }>();
const frozenQueues = new WeakMap<HookQueue, FrozenQueueData>();

const freezeStateQueue = (queue: HookQueue): void => {
  if (!queue || frozenQueues.has(queue)) return;

  const data: FrozenQueueData = {};

  if ('pending' in queue) {
    data.originalPendingDescriptor = Object.getOwnPropertyDescriptor(queue, 'pending');
    let storedPending = queue.pending;

    Object.defineProperty(queue, 'pending', {
      configurable: true,
      enumerable: true,
      get() {
        return storedPending;
      },
      set(newValue) {
        if (isFrozen) return;
        storedPending = newValue;
      },
    });
  }

  if ('getSnapshot' in queue && typeof queue.getSnapshot === 'function') {
    data.originalGetSnapshot = queue.getSnapshot;
    data.frozenSnapshotValue = queue.getSnapshot();

    queue.getSnapshot = () => {
      if (isFrozen) {
        return data.frozenSnapshotValue;
      }
      return data.originalGetSnapshot!();
    };
  }

  frozenQueues.set(queue, data);
};

const unfreezeQueue = (queue: HookQueue): void => {
  const stored = frozenQueues.get(queue);
  if (!stored) return;

  if (stored.originalPendingDescriptor) {
    const currentValue = queue.pending;
    Object.defineProperty(queue, 'pending', stored.originalPendingDescriptor);
    if (!stored.originalPendingDescriptor.get && !stored.originalPendingDescriptor.set) {
      queue.pending = currentValue;
    }
  } else if ('pending' in queue) {
    const currentValue = queue.pending;
    delete (queue as Record<string, unknown>).pending;
    queue.pending = currentValue;
  }

  if (stored.originalGetSnapshot) {
    queue.getSnapshot = stored.originalGetSnapshot;
  }

  frozenQueues.delete(queue);
};

const wrapFiberQueues = (fiber: Fiber): void => {
  let hookState = fiber.memoizedState as HookState | null;
  while (hookState) {
    if (hookState.queue && typeof hookState.queue === 'object') {
      freezeStateQueue(hookState.queue);
    }
    hookState = hookState?.next ?? null;
  }
};

const unwrapFiberQueues = (fiber: Fiber): void => {
  let hookState = fiber.memoizedState as HookState | null;
  while (hookState) {
    if (hookState.queue && typeof hookState.queue === 'object') {
      unfreezeQueue(hookState.queue);
    }
    hookState = hookState?.next ?? null;
  }
};

const traverseAndFreezeQueues = (fiber: Fiber | null): void => {
  if (!fiber) return;

  if (isCompositeFiber(fiber)) {
    wrapFiberQueues(fiber);
  }

  traverseAndFreezeQueues(fiber.child);
  traverseAndFreezeQueues(fiber.sibling);
};

const traverseAndUnfreezeQueues = (fiber: Fiber | null): void => {
  if (!fiber) return;

  if (isCompositeFiber(fiber)) {
    unwrapFiberQueues(fiber);
  }

  traverseAndUnfreezeQueues(fiber.child);
  traverseAndUnfreezeQueues(fiber.sibling);
};

const createFrozenDispatcher = (originalDispatcher: Dispatcher): Dispatcher => {
  return new Proxy(originalDispatcher, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);

      if (prop === 'useState') {
        return <S>(initialState: S | (() => S)): [S, (action: S | ((prev: S) => S)) => void] => {
          const result = (value as Dispatcher['useState'])(initialState);
          return result;
        };
      }

      if (prop === 'useReducer') {
        return <S, A>(
          reducer: (state: S, action: A) => S,
          initialArg: S,
          init?: (arg: S) => S,
        ): [S, (action: A) => void] => {
          const result = (value as Dispatcher['useReducer'])(reducer, initialArg, init);
          return result;
        };
      }

      if (prop === 'useSyncExternalStore') {
        return <T>(
          subscribe: (onStoreChange: () => void) => () => void,
          getSnapshot: () => T,
          getServerSnapshot?: () => T,
        ): T => {
          const wrappedSubscribe = (onStoreChange: () => void) => {
            const wrappedCallback = () => {
              if (isFrozen) return;
              onStoreChange();
            };
            return subscribe(wrappedCallback);
          };
          return (value as Dispatcher['useSyncExternalStore'])(wrappedSubscribe, getSnapshot, getServerSnapshot);
        };
      }

      return value;
    },
  });
};

const installDispatcherProxy = (renderer: ReactRenderer): void => {
  const dispatcherRef = renderer.currentDispatcherRef as DispatcherRef | null;
  if (!dispatcherRef || typeof dispatcherRef !== 'object') return;
  if (originalDispatcherRefs.has(renderer)) return;

  const key: 'H' | 'current' = 'H' in dispatcherRef ? 'H' : 'current';
  originalDispatcherRefs.set(renderer, { key, originalDescriptor: Object.getOwnPropertyDescriptor(dispatcherRef, key) });

  let currentDispatcher = dispatcherRef[key];

  Object.defineProperty(dispatcherRef, key, {
    configurable: true,
    enumerable: true,
    get() {
      if (isFrozen && currentDispatcher) {
        return createFrozenDispatcher(currentDispatcher as Dispatcher);
      }
      return currentDispatcher;
    },
    set(newValue) {
      currentDispatcher = newValue;
    },
  });
};

const uninstallDispatcherProxy = (renderer: ReactRenderer): void => {
  const stored = originalDispatcherRefs.get(renderer);
  if (!stored) return;

  const dispatcherRef = renderer.currentDispatcherRef as DispatcherRef | null;
  if (!dispatcherRef) return;

  if (stored.originalDescriptor) {
    Object.defineProperty(dispatcherRef, stored.key, stored.originalDescriptor);
  } else {
    delete (dispatcherRef as Record<string, unknown>)[stored.key];
  }

  originalDispatcherRefs.delete(renderer);
};

/**
 * Freezes all React state updates by patching hook queues and dispatchers.
 * When frozen, all `useState` and `useReducer` dispatch functions become no-ops.
 *
 * This works by:
 * 1. Intercepting the update queue's `pending` property to prevent updates from being enqueued
 * 2. Patching dispatchers so new components also get frozen behavior
 *
 * @returns An unfreeze function to restore normal React behavior.
 *
 * @example
 * ```ts
 * const unfreeze = freeze();
 * // All setState calls are now no-ops
 * unfreeze();
 * // React updates work normally again
 * ```
 */
export const freeze = (): (() => void) => {
  if (isFrozen) {
    return () => {};
  }

  const rdtHook = getRDTHook();

  for (const renderer of rdtHook.renderers.values()) {
    installDispatcherProxy(renderer);
  }

  for (const root of _fiberRoots) {
    traverseAndFreezeQueues(root.current);
  }

  isFrozen = true;

  return () => {
    if (!isFrozen) return;

    isFrozen = false;

    for (const root of _fiberRoots) {
      traverseAndUnfreezeQueues(root.current);
    }

    for (const renderer of rdtHook.renderers.values()) {
      uninstallDispatcherProxy(renderer);
    }
  };
};

/**
 * Returns whether React updates are currently frozen.
 */
export const isFreezeActive = (): boolean => {
  return isFrozen;
};

export interface InstrumentationOptions {
  name?: string;
  onActive?: () => unknown;
  onCommitFiberRoot?: (
    rendererID: number,
    root: FiberRoot,
    priority: number | void,
  ) => unknown;
  onCommitFiberUnmount?: (rendererID: number, fiber: Fiber) => unknown;
  onPostCommitFiberRoot?: (rendererID: number, root: FiberRoot) => unknown;
  onScheduleFiberRoot?: (
    rendererID: number,
    root: FiberRoot,
    children: React.ReactNode,
  ) => unknown;
}

/**
 * Instruments the DevTools hook.
 * @example
 * const hook = instrument({
 *   onActive() {
 *     console.log('initialized');
 *   },
 *   onCommitFiberRoot(rendererID, root) {
 *     console.log('fiberRoot', root.current)
 *   },
 * });
 */
export const instrument = (
  options: InstrumentationOptions,
): ReactDevToolsGlobalHook => {
  const rdtHook = getRDTHook(options.onActive);

  rdtHook._instrumentationSource = options.name ?? BIPPY_INSTRUMENTATION_STRING;

  const prevOnCommitFiberRoot = rdtHook.onCommitFiberRoot;
  if (options.onCommitFiberRoot) {
    const nextOnCommitFiberRoot = (
      rendererID: number,
      root: FiberRoot,
      priority: number | void,
    ) => {
      if (prevOnCommitFiberRoot === nextOnCommitFiberRoot) return;
      // TODO: validate whether the bottom version is more correct here
      // for preventing infinite loops
      // if (rdtHook.onCommitFiberRoot !== handler) return;
      prevOnCommitFiberRoot?.(rendererID, root, priority);
      options.onCommitFiberRoot?.(rendererID, root, priority);
    };
    rdtHook.onCommitFiberRoot = nextOnCommitFiberRoot;
  }

  const prevOnCommitFiberUnmount = rdtHook.onCommitFiberUnmount;
  if (options.onCommitFiberUnmount) {
    const handler = (rendererID: number, root: FiberRoot) => {
      if (rdtHook.onCommitFiberUnmount !== handler) return;
      prevOnCommitFiberUnmount?.(rendererID, root);
      options.onCommitFiberUnmount?.(rendererID, root);
    };
    rdtHook.onCommitFiberUnmount = handler;
  }

  const prevOnPostCommitFiberRoot = rdtHook.onPostCommitFiberRoot;
  if (options.onPostCommitFiberRoot) {
    const handler = (rendererID: number, root: FiberRoot) => {
      if (rdtHook.onPostCommitFiberRoot !== handler) return;
      prevOnPostCommitFiberRoot?.(rendererID, root);
      options.onPostCommitFiberRoot?.(rendererID, root);
    };
    rdtHook.onPostCommitFiberRoot = handler;
  }

  return rdtHook;
};

export const getFiberFromHostInstance = <T>(hostInstance: T): Fiber | null => {
  const rdtHook = getRDTHook();
  for (const renderer of rdtHook.renderers.values()) {
    try {
      const fiber = renderer.findFiberByHostInstance?.(hostInstance);
      if (fiber) return fiber;
    } catch {}
  }

  if (typeof hostInstance === 'object' && hostInstance != null) {
    if ('_reactRootContainer' in hostInstance) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (hostInstance._reactRootContainer as any)?._internalRoot?.current
        ?.child;
    }

    for (const key in hostInstance) {
      if (
        key.startsWith('__reactContainer$') ||
        key.startsWith('__reactInternalInstance$') ||
        key.startsWith('__reactFiber')
      ) {
        return (hostInstance[key] || null) as Fiber | null;
      }
    }
  }
  return null;
};

export const INSTALL_ERROR = new Error();

export const _fiberRoots = new Set<FiberRoot>();

export const secure = (
  options: InstrumentationOptions,
  secureOptions: {
    dangerouslyRunInProduction?: boolean;
    installCheckTimeout?: number;
    isProduction?: boolean;
    minReactMajorVersion?: number;
    onError?: (error?: unknown) => unknown;
  } = {},
): InstrumentationOptions => {
  const onActive = options.onActive;
  const isRDTHookInstalled = hasRDTHook();
  const isUsingRealReactDevtools = isRealReactDevtools();
  const isUsingReactRefresh = isReactRefresh();
  let timeout: number | undefined;
  let isDevelopment = !secureOptions.isProduction;

  options.onActive = () => {
    clearTimeout(timeout);
    let isSecure = true;
    try {
      const rdtHook = getRDTHook();

      for (const renderer of rdtHook.renderers.values()) {
        const [majorVersion] = renderer.version.split('.');
        if (Number(majorVersion) < (secureOptions.minReactMajorVersion ?? 17)) {
          isSecure = false;
        }
        const buildType = detectReactBuildType(renderer);
        if (buildType === 'development') {
          isDevelopment = true;
        } else if (!secureOptions.dangerouslyRunInProduction) {
          isSecure = false;
        }
      }
    } catch (err) {
      secureOptions.onError?.(err);
    }

    if (!isSecure) {
      options.onCommitFiberRoot = undefined;
      options.onCommitFiberUnmount = undefined;
      options.onPostCommitFiberRoot = undefined;
      options.onActive = undefined;
      return;
    }
    onActive?.();

    try {
      const onCommitFiberRoot = options.onCommitFiberRoot;
      if (onCommitFiberRoot) {
        options.onCommitFiberRoot = (rendererID, root, priority) => {
          if (!_fiberRoots.has(root)) {
            _fiberRoots.add(root);
          }
          try {
            onCommitFiberRoot(rendererID, root, priority);
          } catch (err) {
            secureOptions.onError?.(err);
          }
        };
      }

      const onCommitFiberUnmount = options.onCommitFiberUnmount;
      if (onCommitFiberUnmount) {
        options.onCommitFiberUnmount = (rendererID, root) => {
          try {
            onCommitFiberUnmount(rendererID, root);
          } catch (err) {
            secureOptions.onError?.(err);
          }
        };
      }

      const onPostCommitFiberRoot = options.onPostCommitFiberRoot;
      if (onPostCommitFiberRoot) {
        options.onPostCommitFiberRoot = (rendererID, root) => {
          try {
            onPostCommitFiberRoot(rendererID, root);
          } catch (err) {
            secureOptions.onError?.(err);
          }
        };
      }
    } catch (err) {
      secureOptions.onError?.(err);
    }
  };

  if (
    !isRDTHookInstalled &&
    !isUsingRealReactDevtools &&
    !isUsingReactRefresh
  ) {
    timeout = setTimeout(() => {
      if (isDevelopment) {
        secureOptions.onError?.(INSTALL_ERROR);
      }
      stop();
    }, secureOptions.installCheckTimeout ?? 100) as unknown as number;
  }

  return options;
};

export * from './rdt-hook.js';
export type * from './types.js';
