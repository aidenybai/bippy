// This module must load before React so renderers can inject into the hook.

import type { ReactDevToolsGlobalHook, ReactRenderer } from "./types.js";
import { toUnsubscribe, type Unsubscribe } from "./unsubscribe.js";

export const version = process.env.VERSION;
export const BIPPY_INSTRUMENTATION_STRING = `bippy-${version}`;

const objectDefineProperty = Object.defineProperty;
// eslint-disable-next-line @typescript-eslint/unbound-method
const objectHasOwnProperty = Object.prototype.hasOwnProperty;

const NO_OP = (): void => {};

const checkDCE = (functionToCheck: unknown): void => {
  try {
    const code = Function.prototype.toString.call(functionToCheck);
    if (code.includes("^_^")) {
      setTimeout(() => {
        throw new Error(
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

export const _onActiveListeners = new Set<() => unknown>();

export const _renderers = new Set<ReactRenderer>();

const rendererInjectListeners = new Set<(renderer: ReactRenderer) => void>();
// HACK: Hook replacement can leave an old inject wrapper in the call chain, so notifications must be deduplicated.
const notifiedRenderers = new WeakSet<ReactRenderer>();
let notifyingInject: ReactDevToolsGlobalHook["inject"] | null = null;

const ensureInjectNotifiesListeners = (rdtHook: ReactDevToolsGlobalHook): void => {
  if (rdtHook.inject === notifyingInject) return;
  const prevInject = rdtHook.inject;
  const nextInject = (renderer: ReactRenderer) => {
    const rendererId = prevInject.call(rdtHook, renderer);
    if (!notifiedRenderers.has(renderer)) {
      notifiedRenderers.add(renderer);
      for (const listener of rendererInjectListeners) {
        listener(renderer);
      }
    }
    return rendererId;
  };
  rdtHook.inject = nextInject;
  notifyingInject = nextInject;
};

/** Subscribes to renderer injections without stacking competing hook patches. */
export const onRendererInject = (listener: (renderer: ReactRenderer) => void): Unsubscribe => {
  ensureInjectNotifiesListeners(getRDTHook());
  rendererInjectListeners.add(listener);
  return toUnsubscribe(() => {
    rendererInjectListeners.delete(listener);
  });
};

const ensureRendererMap = (rdtHook: ReactDevToolsGlobalHook): Map<number, ReactRenderer> => {
  if (!(rdtHook.renderers instanceof Map)) {
    rdtHook.renderers = new Map();
  }
  return rdtHook.renderers;
};

export const installRDTHook = (onActive?: () => unknown): ReactDevToolsGlobalHook => {
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
    inject(renderer) {
      const nextRendererId = ++rendererIdCounter;
      renderers.set(nextRendererId, renderer);
      _renderers.add(renderer);
      if (!rdtHook._instrumentationIsActive) {
        rdtHook._instrumentationIsActive = true;
        _onActiveListeners.forEach((listener) => listener());
      }
      return nextRendererId;
    },
    on: NO_OP,
    onCommitFiberRoot: NO_OP,
    onCommitFiberUnmount: NO_OP,
    onPostCommitFiberRoot: NO_OP,
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
          const nextRenderers = ensureRendererMap(rdtHook);
          if (ourRenderers.size > 0) {
            ourRenderers.forEach((renderer, id) => {
              _renderers.add(renderer);
              nextRenderers.set(id, renderer);
            });
            patchRDTHook(onActive);
          }
        }
      },
    });
    // HACK: The DevTools extension uses hasOwnProperty to decide whether it may replace an earlier hook.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const originalWindowHasOwnProperty = window.hasOwnProperty;
    let hasRanHack = false;
    objectDefineProperty(window, "hasOwnProperty", {
      configurable: true,
      value: function (this: unknown, ...args: [PropertyKey]) {
        try {
          if (!hasRanHack && args[0] === "__REACT_DEVTOOLS_GLOBAL_HOOK__") {
            globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__ = undefined;
            hasRanHack = true;
            return -0;
          }
        } catch {}
        return originalWindowHasOwnProperty.apply(this, args);
      },
      writable: true,
    });
  } catch {
    patchRDTHook(onActive);
  }
  return rdtHook;
};

export const patchRDTHook = (onActive?: () => unknown): void => {
  if (onActive) {
    _onActiveListeners.add(onActive);
  }
  let didNotifyActiveListeners = false;
  try {
    const rdtHook = globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__;
    if (!rdtHook) return;
    const renderers = ensureRendererMap(rdtHook);
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
        rdtHook.on = NO_OP;
      }
      if (renderers.size) {
        renderers.forEach((renderer) => _renderers.add(renderer));
        rdtHook._instrumentationIsActive = true;
        _onActiveListeners.forEach((listener) => listener());
        didNotifyActiveListeners = true;
      }
      const prevInject = rdtHook.inject;
      rdtHook.inject = (renderer) => {
        const rendererId = prevInject(renderer);
        _renderers.add(renderer);
        renderers.set(rendererId, renderer);
        rdtHook._instrumentationIsActive = true;
        _onActiveListeners.forEach((listener) => listener());
        return rendererId;
      };
    }
    if (!didNotifyActiveListeners && (renderers.size || rdtHook._instrumentationIsActive)) {
      onActive?.();
    }
  } catch {}
};

export const hasRDTHook = (): boolean => {
  return objectHasOwnProperty.call(globalThis, "__REACT_DEVTOOLS_GLOBAL_HOOK__");
};

/**
 * Returns the current React DevTools global hook.
 */
export const getRDTHook = (onActive?: () => unknown): ReactDevToolsGlobalHook => {
  if (!hasRDTHook()) {
    return installRDTHook(onActive);
  }

  patchRDTHook(onActive);
  return globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__ ?? installRDTHook(onActive);
};

export const isClientEnvironment = (): boolean => {
  return Boolean(
    typeof window !== "undefined" &&
    // eslint-disable-next-line @typescript-eslint/unbound-method
    (window.document?.createElement || window.navigator?.product === "ReactNative"),
  );
};

export const safelyInstallRDTHook = () => {
  try {
    if (isClientEnvironment()) {
      getRDTHook();
    }
  } catch {}
};
