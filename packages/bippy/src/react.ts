import "./install-hook-only.js";
import * as React from "react";
import { isFiber } from "./core.js";
import type { Fiber } from "./react-internals/index.js";

export type { Fiber } from "./react-internals/index.js";

interface FiberHookEffect {
  create: unknown;
  next: unknown;
}

const preserveState = (state: undefined): undefined => state;
const readEmptySnapshot = (): undefined => undefined;
const unsubscribeFromEmptyStore = (): void => {};
const subscribeToEmptyStore = (): (() => void) => unsubscribeFromEmptyStore;
const useSyncExternalStore: unknown = Reflect.get(React, "useSyncExternalStore");

const captureFiberFromHook = (useCaptureHook: () => void): Fiber | null => {
  const originalBind = Function.prototype.bind;
  let capturedFiber: Fiber | null = null;
  // HACK: React binds hook callbacks to the rendering Fiber in production but exposes no public API for it.
  const bindProxy = new Proxy(originalBind, {
    apply: (bind, functionToBind, boundArguments) => {
      const fiber = boundArguments[1];
      if (!capturedFiber && isFiber(fiber)) {
        capturedFiber = fiber;
      }
      return Reflect.apply(bind, functionToBind, boundArguments);
    },
  });
  Reflect.set(Function.prototype, "bind", bindProxy);

  try {
    useCaptureHook();
  } finally {
    if (Function.prototype.bind === bindProxy) {
      Reflect.set(Function.prototype, "bind", originalBind);
    }
  }

  return capturedFiber;
};

const useExternalStoreCapture = (): void => {
  if (typeof useSyncExternalStore !== "function") return;
  Reflect.apply(useSyncExternalStore, React, [
    subscribeToEmptyStore,
    readEmptySnapshot,
    readEmptySnapshot,
  ]);
};

const useReducerCapture = (): void => {
  React.useReducer(preserveState, undefined);
};

const useFiberWithExternalStore = (): Fiber | undefined =>
  captureFiberFromHook(useExternalStoreCapture) ?? undefined;

const isHookEffect = (value: unknown): value is FiberHookEffect =>
  typeof value === "object" && value !== null && "create" in value && "next" in value;

const hasRenderMarker = (fiber: Fiber, renderMarker: () => void): boolean => {
  const lastEffect = fiber.updateQueue?.lastEffect;
  if (!isHookEffect(lastEffect)) return false;
  let effect = lastEffect;
  do {
    if (effect.create === renderMarker) return true;
    if (!isHookEffect(effect.next)) return false;
    effect = effect.next;
  } while (effect !== lastEffect);
  return false;
};

// HACK: React 17 only binds the rendering Fiber on mount. Later renders are identified through
// the effect list instead: renderWithHooks clears `updateQueue` on the work-in-progress Fiber,
// so only the Fiber that is rendering right now holds this render's marker effect.
const useFiberWithReducer = (): Fiber | undefined => {
  const fiberRef = React.useRef<Fiber | null>(null);
  const renderMarker = (): void => {};
  React.useEffect(renderMarker, []);
  const mountedFiber = captureFiberFromHook(useReducerCapture);
  if (mountedFiber) {
    fiberRef.current = mountedFiber;
    return mountedFiber;
  }
  const knownFiber = fiberRef.current;
  if (!knownFiber) return undefined;
  return (
    [knownFiber, knownFiber.alternate].find(
      (candidate) => candidate !== null && hasRenderMarker(candidate, renderMarker),
    ) ?? undefined
  );
};

export const useFiber =
  typeof useSyncExternalStore === "function" ? useFiberWithExternalStore : useFiberWithReducer;
