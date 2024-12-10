/* eslint-disable eqeqeq */
// Note: do not import React in this file
// since it will be executed before the react devtools hook is created

import type * as React from 'react';
import type { Fiber, FiberRoot } from 'react-reconciler';

export const ClassComponentTag = 1;
export const FunctionComponentTag = 0;
export const ContextConsumerTag = 9;
export const SuspenseComponentTag = 13;
export const OffscreenComponentTag = 22;
export const ForwardRefTag = 11;
export const MemoComponentTag = 14;
export const SimpleMemoComponentTag = 15;
export const HostComponentTag = 5;
export const HostHoistableTag = 26;
export const HostSingletonTag = 27;
export const DehydratedSuspenseComponent = 18;
export const HostText = 6;
export const Fragment = 7;
export const LegacyHiddenComponent = 23;
export const OffscreenComponent = 22;
export const HostRoot = 3;
export const CONCURRENT_MODE_NUMBER = 0xeacf;
export const CONCURRENT_MODE_SYMBOL_STRING = 'Symbol(react.concurrent_mode)';
export const DEPRECATED_ASYNC_MODE_SYMBOL_STRING = 'Symbol(react.async_mode)';

// https://github.com/facebook/react/blob/main/packages/react-reconciler/src/ReactFiberFlags.js
export const PerformedWork = 0b1;
export const Placement = 0b10;
export const DidCapture = 0b10000000;
export const Hydrating = 0b1000000000000;
export const Update = 0b100;
export const Cloned = 0b1000;
export const ChildDeletion = 0b10000;
export const ContentReset = 0b100000;
export const Ref = 0b1000000000;
export const Snapshot = 0b10000000000;
export const Visibility = 0b10000000000000;
export const MutationMask =
  Placement |
  Update |
  ChildDeletion |
  ContentReset |
  Hydrating |
  Visibility |
  Snapshot;

export const isValidElement = (element: unknown) =>
  typeof element === 'object' &&
  element !== null &&
  '$$typeof' in element &&
  String(element.$$typeof) === 'Symbol(react.element)';

export const isHostFiber = (fiber: Fiber) =>
  fiber.tag === HostComponentTag ||
  // @ts-expect-error: it exists
  fiber.tag === HostHoistableTag ||
  // @ts-expect-error: it exists
  fiber.tag === HostSingletonTag;

// https://github.com/facebook/react/blob/865d2c418d5ba6fb4546e4b58616cd9b7701af85/packages/react/src/jsx/ReactJSXElement.js#L490
export const isCompositeFiber = (fiber: Fiber) =>
  fiber.tag === FunctionComponentTag ||
  fiber.tag === ClassComponentTag ||
  fiber.tag === SimpleMemoComponentTag ||
  fiber.tag === MemoComponentTag ||
  fiber.tag === ForwardRefTag;

export const traverseContexts = (
  fiber: Fiber,
  selector: (
    prevValue: { context: React.Context<unknown>; memoizedValue: unknown },
    nextValue: { context: React.Context<unknown>; memoizedValue: unknown },
    // eslint-disable-next-line @typescript-eslint/no-invalid-void-type
  ) => boolean | void,
) => {
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
    let nextContext = nextDependencies.firstContext;
    let prevContext = prevDependencies.firstContext;
    while (
      nextContext &&
      typeof nextContext === 'object' &&
      'memoizedValue' in nextContext &&
      prevContext &&
      typeof prevContext === 'object' &&
      'memoizedValue' in prevContext
    ) {
      if (selector(nextContext as any, prevContext as any) === true)
        return true;

      nextContext = nextContext.next;
      prevContext = prevContext.next;
    }
  } catch {
    /**/
  }
  return false;
};

export const traverseState = (
  fiber: Fiber,
  selector: (
    prevValue: { memoizedState: unknown },
    nextValue: { memoizedState: unknown },
    // eslint-disable-next-line @typescript-eslint/no-invalid-void-type
  ) => boolean | void,
) => {
  try {
    let prevState = fiber.memoizedState;
    let nextState = fiber.alternate?.memoizedState;

    while (prevState && nextState) {
      if (selector(prevState, nextState) === true) return true;

      prevState = prevState.next;
      nextState = nextState.next;
    }
  } catch {
    /**/
  }

  return false;
};

export const traverseProps = (
  fiber: Fiber,
  selector: (
    prevValue: unknown,
    nextValue: unknown,
    // eslint-disable-next-line @typescript-eslint/no-invalid-void-type
  ) => boolean | void,
) => {
  try {
    const nextProps = fiber.memoizedProps;
    const prevProps = fiber.alternate?.memoizedProps || {};
    for (const propName in { ...prevProps, ...nextProps }) {
      const prevValue = prevProps?.[propName];
      const nextValue = nextProps?.[propName];

      if (selector(prevValue, nextValue) === true) return true;
    }
  } catch {
    /**/
  }
  return false;
};

export const didFiberRender = (fiber: Fiber): boolean => {
  const nextProps = fiber.memoizedProps;
  const prevProps = fiber.alternate?.memoizedProps || {};
  const flags = fiber.flags ?? (fiber as any).effectTag ?? 0;

  switch (fiber.tag) {
    case ClassComponentTag:
    case FunctionComponentTag:
    case ContextConsumerTag:
    case ForwardRefTag:
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

export const didFiberCommit = (fiber: Fiber): boolean => {
  return Boolean(
    didFiberRender(fiber) &&
      (fiber.subtreeFlags & (MutationMask | Cloned) || fiber.deletions),
  );
};

export const getMutatedHostFibers = (fiber: Fiber): Array<Fiber> => {
  if (!didFiberCommit(fiber)) return [];

  const mutations: Array<Fiber> = [];
  for (let sibling = fiber.sibling; sibling; sibling = sibling.sibling) {
    if (
      isHostFiber(sibling) &&
      didFiberCommit(sibling.return ?? sibling) &&
      didFiberRender(sibling)
    ) {
      mutations.push(sibling);
      mutations.push(...getMutatedHostFibers(sibling));
    }
  }
  if (
    fiber.child &&
    isHostFiber(fiber.child) &&
    didFiberCommit(fiber) &&
    didFiberRender(fiber.child)
  ) {
    mutations.push(fiber.child);
    mutations.push(...getMutatedHostFibers(fiber.child));
  }
  return mutations;
};

export const getFiberStack = (fiber: Fiber) => {
  const stack: Array<Fiber> = [];
  while (fiber.return) {
    stack.unshift(fiber);
    fiber = fiber.return;
  }
  return stack;
};

export const shouldFilterFiber = (fiber: Fiber) => {
  switch (fiber.tag) {
    case DehydratedSuspenseComponent:
      // TODO: ideally we would show dehydrated Suspense immediately.
      // However, it has some special behavior (like disconnecting
      // an alternate and turning into real Suspense) which breaks DevTools.
      // For now, ignore it, and only show it once it gets hydrated.
      // https://github.com/bvaughn/react-devtools-experimental/issues/197
      return true;

    case HostText:
    case Fragment:
    case LegacyHiddenComponent:
    case OffscreenComponent:
      return true;

    case HostRoot:
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

export const getNearestHostFiber = (fiber: Fiber) => {
  let hostFiber = traverseFiber(fiber, isHostFiber);
  if (!hostFiber) {
    hostFiber = traverseFiber(fiber, isHostFiber, true);
  }
  return hostFiber;
};

export const traverseFiber = (
  fiber: Fiber | null,
  // eslint-disable-next-line @typescript-eslint/no-invalid-void-type
  selector: (node: Fiber) => boolean | void,
  ascending = false,
): Fiber | null => {
  if (!fiber) return null;
  if (selector(fiber) === true) return fiber;

  let child = ascending ? fiber.return : fiber.child;
  while (child) {
    const match = traverseFiber(child, selector, ascending);
    if (match) return match;

    child = ascending ? null : child.sibling;
  }
  return null;
};

export const getTimings = (fiber?: Fiber | null | undefined) => {
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

export const hasMemoCache = (fiber: Fiber) => {
  return Boolean((fiber.updateQueue as any)?.memoCache);
};

export const getType = (type: any): any => {
  if (typeof type === 'function') {
    return type;
  }
  if (typeof type === 'object' && type) {
    // memo / forwardRef case
    return getType(type.type || type.render);
  }
  return null;
};

export const getDisplayName = (type: any): string | null => {
  if (typeof type !== 'function' && !(typeof type === 'object' && type)) {
    return null;
  }
  const name = type.displayName || type.name || null;
  if (name) return name;
  type = getType(type);
  if (!type) return null;
  return type.displayName || type.name || null;
};

const NO_OP = () => {
  /**/
};

export const getRDTHook = () => {
  let rdtHook = globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  const renderers = new Map();
  let i = 0;
  rdtHook ??= {
    checkDCE: NO_OP,
    supportsFiber: true,
    supportsFlight: true,
    renderers,
    onCommitFiberRoot: NO_OP,
    onCommitFiberUnmount: NO_OP,
    onPostCommitFiberRoot: NO_OP,
    inject(renderer) {
      const nextID = ++i;
      renderers.set(nextID, renderer);
      return nextID;
    },
  };
  try {
    // sometimes this is a getter
    globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__ = rdtHook;
  } catch {
    /**/
  }
  return rdtHook;
};

// __REACT_DEVTOOLS_GLOBAL_HOOK__ must exist before React is ever executed
// this is the case with the React Devtools extension, but without it, we need
if (typeof window !== 'undefined') {
  getRDTHook();
}

type RenderHandler = (
  fiber: Fiber,
  phase: 'mount' | 'update' | 'unmount',
) => void;

export const mountFiberRecursively = (
  onRender: RenderHandler,
  firstChild: Fiber,
  traverseSiblings: boolean,
) => {
  let fiber: Fiber | null = firstChild;

  while (fiber != null) {
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
) => {
  if (!prevFiber) return;

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

export const unmountFiber = (onRender: RenderHandler, fiber: Fiber) => {
  const isRoot = fiber.tag === HostRoot;

  if (isRoot || !shouldFilterFiber(fiber)) {
    onRender(fiber, 'unmount');
  }
};

export const unmountFiberChildrenRecursively = (
  onRender: RenderHandler,
  fiber: Fiber,
) => {
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
    prevFiber: Fiber | null;
    id: number;
  }
>();

export const createFiberVisitor = ({
  onRender,
  onError,
}: {
  onRender: RenderHandler;
  onError?: (error: unknown) => void;
}) => {
  return (_rendererID: number, root: FiberRoot) => {
    const rootFiber = root.current;

    let rootInstance = rootInstanceMap.get(root);

    if (!rootInstance) {
      rootInstance = { prevFiber: null, id: commitId++ };
      rootInstanceMap.set(root, rootInstance);
    }

    const { prevFiber } = rootInstance;

    try {
      if (prevFiber !== null) {
        const wasMounted =
          prevFiber &&
          prevFiber.memoizedState != null &&
          prevFiber.memoizedState.element != null &&
          // A dehydrated root is not considered mounted
          prevFiber.memoizedState.isDehydrated !== true;
        const isMounted =
          rootFiber.memoizedState != null &&
          rootFiber.memoizedState.element != null &&
          // A dehydrated root is not considered mounted
          rootFiber.memoizedState.isDehydrated !== true;

        if (!wasMounted && isMounted) {
          mountFiberRecursively(onRender, rootFiber, false);
        } else if (wasMounted && isMounted) {
          updateFiberRecursively(
            onRender,
            rootFiber,
            rootFiber.alternate,
            null,
          );
        } else if (wasMounted && !isMounted) {
          unmountFiber(onRender, rootFiber);
        }
      } else {
        mountFiberRecursively(onRender, rootFiber, false);
      }
    } catch (err) {
      if (onError) {
        onError(err);
      } else {
        throw err;
      }
    }
    rootInstance.prevFiber = rootFiber;
  };
};

export const instrument = ({
  onCommitFiberRoot,
  onCommitFiberUnmount,
  onPostCommitFiberRoot,
}: {
  onCommitFiberRoot?: (rendererID: number, root: FiberRoot) => void;
  onCommitFiberUnmount?: (rendererID: number, root: FiberRoot) => void;
  onPostCommitFiberRoot?: (rendererID: number, root: FiberRoot) => void;
}) => {
  const devtoolsHook = getRDTHook();

  const prevOnCommitFiberRoot = devtoolsHook.onCommitFiberRoot;
  if (onCommitFiberRoot) {
    devtoolsHook.onCommitFiberRoot = (rendererID: number, root: FiberRoot) => {
      if (prevOnCommitFiberRoot) prevOnCommitFiberRoot(rendererID, root);
      onCommitFiberRoot(rendererID, root);
    };
  }

  const prevOnCommitFiberUnmount = devtoolsHook.onCommitFiberUnmount;
  if (onCommitFiberUnmount) {
    devtoolsHook.onCommitFiberUnmount = (
      rendererID: number,
      root: FiberRoot,
    ) => {
      if (prevOnCommitFiberUnmount) prevOnCommitFiberUnmount(rendererID, root);
      onCommitFiberUnmount(rendererID, root);
    };
  }

  const prevOnPostCommitFiberRoot = devtoolsHook.onPostCommitFiberRoot;
  if (onPostCommitFiberRoot) {
    devtoolsHook.onPostCommitFiberRoot = (
      rendererID: number,
      root: FiberRoot,
    ) => {
      if (prevOnPostCommitFiberRoot) {
        prevOnPostCommitFiberRoot(rendererID, root);
      }
    };
  }

  return devtoolsHook;
};

let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
const visualizedElements: Array<{ stateNode: HTMLElement }> = [];

// Initialize canvas if not already initialized
if (canvas === null) {
  canvas = document.createElement('canvas');
  canvas.id = 'visualizer-canvas';
  canvas.style.position = 'fixed';
  canvas.style.top = '0';
  canvas.style.left = '0';
  canvas.style.zIndex = '9999999999';
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  canvas.style.pointerEvents = 'none';
  document.body.appendChild(canvas);

  ctx = canvas.getContext('2d')!;

  // Update canvas size on window resize
  window.addEventListener('resize', updateCanvasSize);

  // Update canvas on scroll
  window.addEventListener('scroll', updateCanvas);
} else {
  ctx = (canvas as any).getContext('2d')!;
}

function updateCanvasSize() {
  if (canvas) {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    updateCanvas();
  }
}

function updateCanvas() {
  if (canvas && ctx) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // Re-draw the visualized elements
    visualizedElements.forEach(({ stateNode }) => {
      const rect = stateNode.getBoundingClientRect();

      ctx.strokeStyle = 'red';
      ctx.lineWidth = 2;
      ctx.strokeRect(rect.left, rect.top, rect.width, rect.height);

      // Draw the innerText with white text on red background
      ctx.font = '12px Arial';
      const text = stateNode.innerText;
      const textWidth = ctx.measureText(text).width;
      const textHeight = 16; // approximate height
      ctx.fillStyle = 'red'; // background color
      ctx.fillRect(rect.left, rect.top, textWidth + 10, textHeight);
      ctx.fillStyle = 'white'; // text color
      ctx.fillText(text, rect.left + 5, rect.top + 12);
    });
  }
}

instrument({
  onCommitFiberRoot: (rendererID, root) => {
    // Clear the previous elements array
    visualizedElements.length = 0;

    traverseFiber(root.current, (fiber) => {
      if (
        isHostFiber(fiber) &&
        fiber.memoizedProps &&
        typeof fiber.memoizedProps === 'object' &&
        fiber.stateNode instanceof HTMLElement &&
        typeof fiber.type === 'string'
      ) {
        if ('onClick' in fiber.memoizedProps) {
          const stateNode = fiber.stateNode;

          // Add to visualized elements
          visualizedElements.push({ stateNode });
        }
      }
    });

    updateCanvas();
  },
});
