// This module must load before React so renderers can inject into the hook.

import {
  BippyHookInstallationError,
  BippyHookListenerError,
  BippyReactBuildError,
  runWithBippyError,
} from "./errors.js";
import type { ReactDevToolsGlobalHook, ReactRenderer } from "./types.js";
import { toUnsubscribe, type Unsubscribe } from "./unsubscribe.js";

interface ActiveListener {
  (): unknown;
}

interface RendererInjectListener {
  (renderer: ReactRenderer): void;
}

interface RDTHookReplaceListener {
  (rdtHook: ReactDevToolsGlobalHook): void;
}

export const version = process.env.VERSION;
export const BIPPY_INSTRUMENTATION_STRING = `bippy-${version}`;

const objectDefineProperty = Object.defineProperty;

const noOp = (): void => {};

const runHookListener = (listenerName: string, callback: () => unknown): void =>
  runWithBippyError(callback, (cause) => new BippyHookListenerError(listenerName, cause));

const checkDCE = (functionToCheck: unknown): void => {
  try {
    const code = Function.prototype.toString.call(functionToCheck);
    if (code.includes("^_^")) {
      // HACK: React DevTools reports failed dead-code elimination asynchronously.
      setTimeout(() => {
        throw new BippyReactBuildError(
          "React is running in production mode, but dead code " +
            "elimination has not been applied. Read how to correctly " +
            "configure React for production: " +
            "https://reactjs.org/link/perf-use-production-build",
        );
      });
    }
  } catch {}
};

export const isRealReactDevtools = (
  rdtHook: ReactDevToolsGlobalHook | undefined | null = globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__,
): boolean => {
  return Boolean(rdtHook && "getFiberRoots" in rdtHook);
};

export const _onActiveListeners = new Set<ActiveListener>();

export const _renderers = new Set<ReactRenderer>();

const rendererInjectListeners = new Set<RendererInjectListener>();
const rdtHookReplaceListeners = new Set<RDTHookReplaceListener>();
// HACK: Hook replacement can leave an old inject wrapper in the call chain, so notifications must be deduplicated.
const notifiedRenderers = new WeakSet<ReactRenderer>();
const notifyingInjectByHook = new WeakMap<
  ReactDevToolsGlobalHook,
  ReactDevToolsGlobalHook["inject"]
>();

const notifyActiveListeners = (): void => {
  for (const listener of _onActiveListeners) {
    runHookListener("onActive", listener);
  }
};

const notifyRendererInjectListeners = (renderer: ReactRenderer): void => {
  for (const listener of rendererInjectListeners) {
    runHookListener("onRendererInject", () => listener(renderer));
  }
};

const notifyRDTHookReplaceListeners = (rdtHook: ReactDevToolsGlobalHook): void => {
  for (const listener of rdtHookReplaceListeners) {
    runHookListener("onRDTHookReplace", () => listener(rdtHook));
  }
};

const setRendererInjectDispatcher = (rdtHook: ReactDevToolsGlobalHook): void => {
  if (rdtHook.inject === notifyingInjectByHook.get(rdtHook)) return;
  const previousInject = rdtHook.inject;
  const nextInject = (renderer: ReactRenderer) => {
    const rendererId = previousInject.call(rdtHook, renderer);
    if (!notifiedRenderers.has(renderer)) {
      notifiedRenderers.add(renderer);
      notifyRendererInjectListeners(renderer);
    }
    return rendererId;
  };
  rdtHook.inject = nextInject;
  notifyingInjectByHook.set(rdtHook, nextInject);
};

export const onRendererInject = (listener: RendererInjectListener): Unsubscribe => {
  setRendererInjectDispatcher(getRDTHook());
  rendererInjectListeners.add(listener);
  return toUnsubscribe(() => {
    rendererInjectListeners.delete(listener);
  });
};

export const onRDTHookReplace = (listener: RDTHookReplaceListener): Unsubscribe => {
  rdtHookReplaceListeners.add(listener);
  return toUnsubscribe(() => {
    rdtHookReplaceListeners.delete(listener);
  });
};

const getRendererMap = (rdtHook: ReactDevToolsGlobalHook): Map<number, ReactRenderer> => {
  if (!(rdtHook.renderers instanceof Map)) {
    rdtHook.renderers = new Map();
  }
  return rdtHook.renderers;
};

export const installRDTHook = (onActive?: ActiveListener): ReactDevToolsGlobalHook => {
  if (onActive) {
    _onActiveListeners.add(onActive);
  }
  const renderers = new Map<number, ReactRenderer>();
  let rendererIdCounter = 0;
  let rdtHook: ReactDevToolsGlobalHook = {
    _instrumentationIsActive: false,
    _instrumentationSource: BIPPY_INSTRUMENTATION_STRING,
    checkDCE,
    hasUnsupportedRendererAttached: false,
    inject: (renderer) => {
      const nextRendererId = ++rendererIdCounter;
      renderers.set(nextRendererId, renderer);
      _renderers.add(renderer);
      if (!rdtHook._instrumentationIsActive) {
        rdtHook._instrumentationIsActive = true;
        notifyActiveListeners();
      }
      return nextRendererId;
    },
    on: noOp,
    onCommitFiberRoot: noOp,
    onCommitFiberUnmount: noOp,
    onPostCommitFiberRoot: noOp,
    renderers,
    supportsFiber: true,
    supportsFlight: true,
  };
  try {
    objectDefineProperty(globalThis, "__REACT_DEVTOOLS_GLOBAL_HOOK__", {
      configurable: true,
      enumerable: true,
      get() {
        return rdtHook;
      },
      set(newHook) {
        if (newHook && typeof newHook === "object") {
          const ourRenderers = rdtHook.renderers;
          rdtHook = newHook;
          const nextRenderers = getRendererMap(rdtHook);
          if (ourRenderers.size > 0) {
            ourRenderers.forEach((renderer, rendererId) => {
              _renderers.add(renderer);
              nextRenderers.set(rendererId, renderer);
            });
          }
          if (ourRenderers.size > 0 || rdtHookReplaceListeners.size > 0) {
            patchRDTHook(onActive);
          }
          notifyRDTHookReplaceListeners(rdtHook);
        }
      },
    });
    if (typeof window !== "undefined") {
      // HACK: The DevTools extension uses hasOwnProperty to decide whether it may replace an earlier hook.
      const originalWindowHasOwnProperty = window.hasOwnProperty.bind(window);
      const originalHasOwnPropertyDescriptor = Object.getOwnPropertyDescriptor(
        window,
        "hasOwnProperty",
      );
      let didRunHasOwnPropertyHack = false;
      const restoreWindowHasOwnProperty = (): void => {
        if (originalHasOwnPropertyDescriptor) {
          objectDefineProperty(window, "hasOwnProperty", originalHasOwnPropertyDescriptor);
        } else {
          Reflect.deleteProperty(window, "hasOwnProperty");
        }
      };
      objectDefineProperty(window, "hasOwnProperty", {
        configurable: true,
        value: (...propertyKeys: [PropertyKey]) => {
          if (!didRunHasOwnPropertyHack && propertyKeys[0] === "__REACT_DEVTOOLS_GLOBAL_HOOK__") {
            didRunHasOwnPropertyHack = true;
            restoreWindowHasOwnProperty();
            globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__ = undefined;
            return false;
          }
          return originalWindowHasOwnProperty(...propertyKeys);
        },
        writable: true,
      });
    }
  } catch {
    patchRDTHook(onActive);
  }
  return rdtHook;
};

export const patchRDTHook = (onActive?: ActiveListener): void => {
  if (onActive) {
    _onActiveListeners.add(onActive);
  }
  let didNotifyActiveListeners = false;
  const rdtHook = globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  if (!rdtHook) return;
  const renderers = getRendererMap(rdtHook);
  if (!rdtHook._instrumentationSource) {
    rdtHook.checkDCE = checkDCE;
    rdtHook.supportsFiber = true;
    rdtHook.supportsFlight = true;
    rdtHook.hasUnsupportedRendererAttached = false;
    rdtHook._instrumentationSource = BIPPY_INSTRUMENTATION_STRING;
    rdtHook._instrumentationIsActive = false;
    // HACK: DevTools detection must happen after setting the source to avoid recursive patching.
    const isReactDevtools = isRealReactDevtools(rdtHook);
    if (!isReactDevtools) {
      rdtHook.on = noOp;
    }
    if (renderers.size) {
      renderers.forEach((renderer) => _renderers.add(renderer));
      rdtHook._instrumentationIsActive = true;
      notifyActiveListeners();
      didNotifyActiveListeners = true;
    }
    const previousInject = rdtHook.inject;
    rdtHook.inject = (renderer) => {
      const rendererId = previousInject.call(rdtHook, renderer);
      _renderers.add(renderer);
      renderers.set(rendererId, renderer);
      if (!rdtHook._instrumentationIsActive) {
        rdtHook._instrumentationIsActive = true;
        notifyActiveListeners();
      }
      return rendererId;
    };
  }
  if (!didNotifyActiveListeners && (renderers.size || rdtHook._instrumentationIsActive)) {
    if (onActive) runHookListener("onActive", onActive);
  }
};

export const hasRDTHook = (): boolean => {
  return Object.hasOwn(globalThis, "__REACT_DEVTOOLS_GLOBAL_HOOK__");
};

/**
 * Returns the current React DevTools global hook.
 */
export const getRDTHook = (onActive?: ActiveListener): ReactDevToolsGlobalHook => {
  if (!hasRDTHook()) {
    return installRDTHook(onActive);
  }

  patchRDTHook(onActive);
  return globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__ ?? installRDTHook(onActive);
};

export const safelyInstallRDTHook = (): void => {
  runWithBippyError(getRDTHook, (cause) => new BippyHookInstallationError(cause));
};
