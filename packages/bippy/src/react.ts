import "./install-hook-only.js";
import * as React from "react";
import { isFiber } from "./core.js";
import type { Fiber } from "./react-internals/index.js";

export type { Fiber } from "./react-internals/index.js";

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

const useFiberWithReducer = (): Fiber | undefined => {
  const committedFiberRef = React.useRef<Fiber | null>(null);
  const renderedFiberRef = React.useRef<Fiber | null>(null);
  const hookFiber = captureFiberFromHook(useReducerCapture);
  const fiber =
    hookFiber ??
    (renderedFiberRef.current !== committedFiberRef.current
      ? renderedFiberRef.current
      : committedFiberRef.current?.alternate) ??
    committedFiberRef.current;

  renderedFiberRef.current = fiber;

  React.useEffect(() => {
    committedFiberRef.current = fiber;
  }, [fiber]);

  return fiber ?? undefined;
};

export const useFiber =
  typeof useSyncExternalStore === "function" ? useFiberWithExternalStore : useFiberWithReducer;
