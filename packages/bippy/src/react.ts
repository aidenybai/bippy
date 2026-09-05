import "./install-hook-only.js";
import React from "react";
import { isFiber, traverseFiber } from "./core.js";
import { _renderers } from "./rdt-hook.js";
import type { Fiber } from "./react-internals/index.js";

export type { Fiber } from "./react-internals/index.js";

interface RenderMarker {
  (state: undefined): undefined;
}

interface ReducerQueue {
  lastRenderedReducer: unknown;
}

interface FiberCapture {
  fiber: Fiber;
  queue: ReducerQueue | null;
}

const isReducerQueue = (value: unknown): value is ReducerQueue =>
  typeof value === "object" && value !== null && "lastRenderedReducer" in value;

const hasRenderMarker = (fiber: Fiber, renderMarker: RenderMarker): boolean => {
  for (let hook = fiber.memoizedState; hook; hook = hook.next) {
    if (Array.isArray(hook.memoizedState) && hook.memoizedState[0] === renderMarker) return true;
  }
  return false;
};

const getReducerQueue = (fiber: Fiber, renderMarker: RenderMarker): ReducerQueue | null => {
  for (let hook = fiber.memoizedState; hook; hook = hook.next) {
    if (isReducerQueue(hook.queue) && hook.queue.lastRenderedReducer === renderMarker)
      return hook.queue;
  }
  return null;
};

const getDevToolsFiber = (renderMarker: RenderMarker): Fiber | null => {
  for (const renderer of _renderers) {
    try {
      const fiber = renderer.getCurrentFiber?.();
      if (fiber && isFiber(fiber) && hasRenderMarker(fiber, renderMarker)) return fiber;
    } catch {}
  }
  return null;
};

const captureReducerFiber = (
  renderMarker: RenderMarker,
  shouldCapture: boolean,
): FiberCapture | null => {
  let originalBind: typeof Function.prototype.bind | undefined;
  if (shouldCapture) {
    try {
      originalBind = Function.prototype.bind;
    } catch {}
  }
  if (!originalBind) {
    React.useReducer(renderMarker, undefined);
    return null;
  }

  let capture: FiberCapture | null = null;
  let isCapturing = true;
  // HACK: Production React binds a new reducer's Fiber and queue; validate the private reducer marker, not argument positions.
  const bindProxy = new Proxy(originalBind, {
    apply: (bind, callback, boundArguments) => {
      if (isCapturing && !capture) {
        try {
          const queue = boundArguments.find(
            (argument): argument is ReducerQueue =>
              isReducerQueue(argument) && argument.lastRenderedReducer === renderMarker,
          );
          if (queue) {
            const fiber = boundArguments.find(
              (argument): argument is Fiber => isFiber(argument) && isFiber(argument.return),
            );
            if (fiber) capture = { fiber, queue };
          }
        } catch {}
      }
      return Reflect.apply(bind, callback, boundArguments);
    },
  });

  try {
    try {
      Reflect.set(Function.prototype, "bind", bindProxy);
    } catch {}
    React.useReducer(renderMarker, undefined);
    return capture;
  } finally {
    isCapturing = false;
    capture = null;
    try {
      if (Function.prototype.bind === bindProxy) {
        Reflect.set(Function.prototype, "bind", originalBind);
      }
    } catch {}
  }
};

// HACK: React <16.13 attaches hooks after render; the shared reducer queue validates the root-walk fallback.
const getRenderingFiberFromRoot = (
  { fiber, queue }: FiberCapture,
  renderMarker: RenderMarker,
): Fiber | null => {
  if (queue?.lastRenderedReducer !== renderMarker) return null;
  let rootFiber = fiber;
  while (rootFiber.return) rootFiber = rootFiber.return;
  const root = rootFiber.stateNode;
  if (typeof root !== "object" || root === null || !("current" in root) || !isFiber(root.current)) {
    return null;
  }
  const renderingRoot = root.current.alternate;
  return traverseFiber(renderingRoot, (candidate) => {
    if (candidate !== fiber && candidate !== fiber.alternate) return false;
    let parent = candidate;
    while (parent.return) parent = parent.return;
    return parent === renderingRoot;
  });
};

export const useFiber = (): Fiber | undefined => {
  "use no memo";
  const fiberRef = React.useRef<FiberCapture | null>(null);
  const renderMarker: RenderMarker = (state) => state;
  React.useMemo(() => renderMarker, [renderMarker]);
  const devToolsFiber = fiberRef.current ? null : getDevToolsFiber(renderMarker);
  const capture = captureReducerFiber(renderMarker, !fiberRef.current && !devToolsFiber);
  if (devToolsFiber) {
    fiberRef.current = {
      fiber: devToolsFiber,
      queue: getReducerQueue(devToolsFiber, renderMarker),
    };
    return devToolsFiber;
  }
  const knownCapture = capture ?? fiberRef.current;
  if (!knownCapture) return undefined;
  const knownFiber = knownCapture.fiber;
  const fiber =
    capture?.fiber ??
    (hasRenderMarker(knownFiber, renderMarker)
      ? knownFiber
      : knownFiber.alternate && hasRenderMarker(knownFiber.alternate, renderMarker)
        ? knownFiber.alternate
        : getRenderingFiberFromRoot(knownCapture, renderMarker));
  if (fiber) fiberRef.current = { fiber, queue: knownCapture.queue };
  return fiber ?? undefined;
};
