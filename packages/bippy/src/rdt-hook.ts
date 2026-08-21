// This module must load before React so renderers can inject into the hook.

import type { FiberRoot, ReactDevToolsGlobalHook, ReactRenderer } from "./react-internals/index.js";

export interface Unsubscribe extends Disposable {
  (): void;
}

interface ActiveListener {
  (): unknown;
}

interface RendererInjectListener {
  (renderer: ReactRenderer): void;
}

interface RendererInjectSubscription {
  listener: RendererInjectListener;
  target: ReactDevToolsTarget;
}

interface RDTHookReplaceListener {
  (rdtHook: ReactDevToolsGlobalHook, target: ReactDevToolsTarget): void;
}

export interface ReactDevToolsTarget {
  __REACT_DEVTOOLS_GLOBAL_HOOK__?: ReactDevToolsGlobalHook;
}

export const version = process.env.VERSION;
export const BIPPY_INSTRUMENTATION_STRING = `bippy-${version}`;

const objectDefineProperty = Object.defineProperty;

const noOp = (): void => {};

const getTargetHook = (target: ReactDevToolsTarget): ReactDevToolsGlobalHook | undefined =>
  target.__REACT_DEVTOOLS_GLOBAL_HOOK__;

export const createUnsubscribe = (unsubscribe: () => void): Unsubscribe =>
  Object.assign(unsubscribe, { [Symbol.dispose]: unsubscribe });

export const isFiberRootUnmounted = (fiberRoot: FiberRoot): boolean => {
  const rootState = fiberRoot.current.memoizedState;
  return (
    rootState === null ||
    (rootState !== undefined && (rootState.element === null || rootState.element === undefined))
  );
};

const checkDCE = (functionToCheck: unknown): void => {
  try {
    const code = Function.prototype.toString.call(functionToCheck);
    if (code.indexOf("^_^") > -1) {
      setTimeout(() => {
        throw new Error(
          "React is running in production mode, but dead code " +
            "elimination has not been applied. Read how to correctly " +
            "configure React for production: " +
            "https://react.dev/link/perf-use-production-build",
        );
      });
    }
  } catch {}
};

export const isRealReactDevtools = (
  rdtHook: ReactDevToolsGlobalHook | undefined | null = globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__,
): boolean => {
  return Boolean(rdtHook && "getFiberRoots" in rdtHook && rdtHook._isBippyHook !== true);
};

// HACK: react-refresh's inject wrapper is the only stock hook whose parameter is named
// "injected", so its string form identifies hooks installed by react-refresh:
// https://github.com/facebook/react/blob/main/packages/react-refresh/src/ReactFreshRuntime.js (injectIntoGlobalHook)
export const isReactRefresh = (
  rdtHook: ReactDevToolsGlobalHook | undefined | null = globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__,
): boolean => {
  if (!rdtHook || typeof rdtHook.inject !== "function") return false;
  if (isRealReactDevtools(rdtHook)) return false;
  try {
    return Function.prototype.toString.call(rdtHook.inject).includes("(injected)");
  } catch {
    return false;
  }
};

export const _onActiveListeners = new Set<ActiveListener>();

export const _renderers = new Set<ReactRenderer>();

const activeListenerTargets = new WeakMap<ActiveListener, Set<ReactDevToolsTarget>>();
const rendererInjectSubscriptions = new Set<RendererInjectSubscription>();
const rdtHookReplaceListeners = new Set<RDTHookReplaceListener>();
const notifiedRenderersByTarget = new WeakMap<ReactDevToolsTarget, WeakSet<ReactRenderer>>();

const addActiveListener = (listener: ActiveListener, target: ReactDevToolsTarget): void => {
  _onActiveListeners.add(listener);
  const targets = activeListenerTargets.get(listener) ?? new Set<ReactDevToolsTarget>();
  targets.add(target);
  activeListenerTargets.set(listener, targets);
};

export const removeActiveListener = (
  listener: ActiveListener,
  target: ReactDevToolsTarget,
): void => {
  const targets = activeListenerTargets.get(listener);
  targets?.delete(target);
  if (!targets || targets.size === 0) {
    activeListenerTargets.delete(listener);
    _onActiveListeners.delete(listener);
  }
};

const notifyActiveListeners = (target: ReactDevToolsTarget): void => {
  for (const listener of _onActiveListeners) {
    if (activeListenerTargets.get(listener)?.has(target)) listener();
  }
};

const notifyRendererInjectListeners = (
  target: ReactDevToolsTarget,
  renderer: ReactRenderer,
): void => {
  for (const subscription of rendererInjectSubscriptions) {
    if (subscription.target === target) subscription.listener(renderer);
  }
};

const notifyRDTHookReplaceListeners = (
  rdtHook: ReactDevToolsGlobalHook,
  target: ReactDevToolsTarget,
): void => {
  for (const listener of rdtHookReplaceListeners) {
    listener(rdtHook, target);
  }
};

export const onRendererInject = (
  listener: RendererInjectListener,
  target: ReactDevToolsTarget = globalThis,
): Unsubscribe => {
  getRDTHook(undefined, target);
  const subscription = { listener, target };
  rendererInjectSubscriptions.add(subscription);
  return createUnsubscribe(() => {
    rendererInjectSubscriptions.delete(subscription);
  });
};

export const onRDTHookReplace = (listener: RDTHookReplaceListener): Unsubscribe => {
  rdtHookReplaceListeners.add(listener);
  return createUnsubscribe(() => {
    rdtHookReplaceListeners.delete(listener);
  });
};

const getRendererMap = (rdtHook: ReactDevToolsGlobalHook): Map<number, ReactRenderer> => {
  if (!(rdtHook.renderers instanceof Map)) {
    rdtHook.renderers = new Map();
  }
  return rdtHook.renderers;
};

const trackInjectedRenderer = (
  rdtHook: ReactDevToolsGlobalHook,
  target: ReactDevToolsTarget,
  renderers: Map<number, ReactRenderer>,
  rendererId: number,
  renderer: ReactRenderer,
): void => {
  renderers.set(rendererId, renderer);
  _renderers.add(renderer);
  if (!rdtHook._instrumentationIsActive) {
    rdtHook._instrumentationIsActive = true;
    notifyActiveListeners(target);
  }
  const notifiedRenderers = notifiedRenderersByTarget.get(target) ?? new WeakSet<ReactRenderer>();
  notifiedRenderersByTarget.set(target, notifiedRenderers);
  if (notifiedRenderers.has(renderer)) return;
  notifiedRenderers.add(renderer);
  notifyRendererInjectListeners(target, renderer);
};

export const installRDTHook = (
  onActive?: ActiveListener,
  target: ReactDevToolsTarget = globalThis,
): ReactDevToolsGlobalHook => {
  if (onActive) addActiveListener(onActive, target);
  const renderers = new Map<number, ReactRenderer>();
  const fiberRoots = new Map<number, Set<FiberRoot>>();
  // Callers register roots by mutating the returned set, so it must be memoized.
  const getRendererFiberRoots = (rendererId: number): Set<FiberRoot> => {
    const rendererRoots = fiberRoots.get(rendererId) ?? new Set<FiberRoot>();
    fiberRoots.set(rendererId, rendererRoots);
    return rendererRoots;
  };
  let rendererIdCounter = 0;
  let rdtHook: ReactDevToolsGlobalHook = {
    _instrumentationIsActive: false,
    _instrumentationSource: BIPPY_INSTRUMENTATION_STRING,
    _isBippyHook: true,
    checkDCE,
    getFiberRoots: getRendererFiberRoots,
    hasUnsupportedRendererAttached: false,
    inject: (renderer) => {
      const nextRendererId = ++rendererIdCounter;
      trackInjectedRenderer(rdtHook, target, renderers, nextRendererId, renderer);
      return nextRendererId;
    },
    on: noOp,
    onCommitFiberRoot: (rendererId, fiberRoot) => {
      const rendererRoots = getRendererFiberRoots(rendererId);
      if (isFiberRootUnmounted(fiberRoot)) rendererRoots.delete(fiberRoot);
      else rendererRoots.add(fiberRoot);
    },
    onCommitFiberUnmount: noOp,
    onPostCommitFiberRoot: noOp,
    renderers,
    supportsFiber: true,
    supportsFlight: true,
  };
  try {
    objectDefineProperty(target, "__REACT_DEVTOOLS_GLOBAL_HOOK__", {
      configurable: true,
      enumerable: true,
      get: () => rdtHook,
      set: (newHook: ReactDevToolsGlobalHook | undefined) => {
        if (newHook && typeof newHook === "object") {
          const ourRenderers = rdtHook.renderers;
          rdtHook = newHook;
          const nextRenderers = getRendererMap(rdtHook);
          ourRenderers.forEach((renderer, rendererId) => {
            _renderers.add(renderer);
            nextRenderers.set(rendererId, renderer);
          });
          if (ourRenderers.size > 0 || rdtHookReplaceListeners.size > 0) {
            patchRDTHook(onActive, target);
          }
          notifyRDTHookReplaceListeners(rdtHook, target);
        }
      },
    });
    if (target === globalThis && typeof window !== "undefined") {
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
        value: (propertyKey: PropertyKey) => {
          if (!didRunHasOwnPropertyHack && propertyKey === "__REACT_DEVTOOLS_GLOBAL_HOOK__") {
            didRunHasOwnPropertyHack = true;
            restoreWindowHasOwnProperty();
            globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__ = undefined;
            return false;
          }
          return originalWindowHasOwnProperty(propertyKey);
        },
        writable: true,
      });
    }
  } catch {
    patchRDTHook(onActive, target);
  }
  return rdtHook;
};

export const patchRDTHook = (
  onActive?: ActiveListener,
  target: ReactDevToolsTarget = globalThis,
): void => {
  if (onActive) addActiveListener(onActive, target);
  let didNotifyActiveListeners = false;
  const rdtHook = getTargetHook(target);
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
      notifyActiveListeners(target);
      didNotifyActiveListeners = true;
    } else if (!isReactDevtools && isReactRefresh(rdtHook)) {
      // HACK: react-refresh's stub inject never records renderers, so a React app
      // that injected before bippy loaded is undetectable through the renderers map.
      // A react-refresh hook implies a dev renderer, so activate immediately.
      rdtHook._instrumentationIsActive = true;
      notifyActiveListeners(target);
      didNotifyActiveListeners = true;
    }
    const previousInject = rdtHook.inject;
    rdtHook.inject = (renderer) => {
      const rendererId = previousInject.call(rdtHook, renderer);
      trackInjectedRenderer(rdtHook, target, renderers, rendererId, renderer);
      return rendererId;
    };
  }
  if (!didNotifyActiveListeners && (renderers.size || rdtHook._instrumentationIsActive)) {
    onActive?.();
  }
};

export const hasRDTHook = (target: ReactDevToolsTarget = globalThis): boolean =>
  Object.hasOwn(target, "__REACT_DEVTOOLS_GLOBAL_HOOK__");

/**
 * Returns the current React DevTools global hook.
 */
export const getRDTHook = (
  onActive?: ActiveListener,
  target: ReactDevToolsTarget = globalThis,
): ReactDevToolsGlobalHook => {
  if (!hasRDTHook(target)) {
    return installRDTHook(onActive, target);
  }

  patchRDTHook(onActive, target);
  return getTargetHook(target) ?? installRDTHook(onActive, target);
};
