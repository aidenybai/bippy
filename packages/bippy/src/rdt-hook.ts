import type { ReactDevToolsGlobalHook, ReactRenderer } from './types.js';

export const version = process.env.VERSION;
export const BIPPY_INSTRUMENTATION_STRING = `bippy-${version}`;

const objectDefineProperty = Object.defineProperty;
// eslint-disable-next-line @typescript-eslint/unbound-method
const objectHasOwnProperty = Object.prototype.hasOwnProperty;

const NO_OP = () => {
  /**/
};

const checkDCE = (fn: unknown): void => {
  try {
    const code = Function.prototype.toString.call(fn);
    if (code.indexOf('^_^') > -1) {
      setTimeout(() => {
        throw new Error(
          'React is running in production mode, but dead code ' +
            'elimination has not been applied. Read how to correctly ' +
            'configure React for production: ' +
            'https://reactjs.org/link/perf-use-production-build'
        );
      });
    }
  } catch {}
};

export const isRealReactDevtools = (rdtHook = getRDTHook()): boolean => {
  return 'getFiberRoots' in rdtHook;
};

let isReactRefreshOverride = false;
let injectFnStr: string | undefined = undefined;

export const isReactRefresh = (rdtHook = getRDTHook()): boolean => {
  if (isReactRefreshOverride) return true;
  if (typeof rdtHook.inject === 'function') {
    injectFnStr = rdtHook.inject.toString();
  }
  return Boolean(injectFnStr?.includes('(injected)'));
};

const onActiveListeners = new Set<() => unknown>();

export const _renderers = new Set<ReactRenderer>();

export const installRDTHook = (
  onActive?: () => unknown
): ReactDevToolsGlobalHook => {
  const renderers = new Map<number, ReactRenderer>();
  let i = 0;
  let rdtHook: ReactDevToolsGlobalHook = {
    _instrumentationIsActive: false,
    _instrumentationSource: BIPPY_INSTRUMENTATION_STRING,
    checkDCE,
    hasUnsupportedRendererAttached: false,
    inject(renderer) {
      const nextID = ++i;
      renderers.set(nextID, renderer);
      _renderers.add(renderer);
      if (!rdtHook._instrumentationIsActive) {
        rdtHook._instrumentationIsActive = true;
        onActiveListeners.forEach((listener) => listener());
      }
      return nextID;
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
    objectDefineProperty(globalThis, '__REACT_DEVTOOLS_GLOBAL_HOOK__', {
      configurable: true,
      enumerable: true,
      get() {
        return rdtHook;
      },
      set(newHook) {
        if (newHook && typeof newHook === 'object') {
          const ourRenderers = rdtHook.renderers;
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          rdtHook = newHook;
          if (ourRenderers.size > 0) {
            ourRenderers.forEach((renderer, id) => {
              _renderers.add(renderer);
              // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
              newHook.renderers.set(id, renderer);
            });
            patchRDTHook(onActive);
          }
        }
      },
    });
    // [!] this is a hack for chrome extensions - if we install before React DevTools, we could accidently prevent React DevTools from installing:
    // https://github.com/facebook/react/blob/18eaf51bd51fed8dfed661d64c306759101d0bfd/packages/react-devtools-extensions/src/contentScripts/installHook.js#L30C6-L30C27
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const originalWindowHasOwnProperty = window.hasOwnProperty;
    let hasRanHack = false;
    objectDefineProperty(window, 'hasOwnProperty', {
      configurable: true,
      value: function (this: unknown, ...args: [PropertyKey]) {
        try {
          if (
            !hasRanHack &&
            args[0] === '__REACT_DEVTOOLS_GLOBAL_HOOK__'
          ) {
            globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__ = undefined;
            // special falsy value to know that we've already installed before
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
    onActiveListeners.add(onActive);
  }
  try {
    const rdtHook = globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__;
    if (!rdtHook) return;
    if (!rdtHook._instrumentationSource) {
      rdtHook.checkDCE = checkDCE;
      rdtHook.supportsFiber = true;
      rdtHook.supportsFlight = true;
      rdtHook.hasUnsupportedRendererAttached = false;
      rdtHook._instrumentationSource = BIPPY_INSTRUMENTATION_STRING;
      rdtHook._instrumentationIsActive = false;
      rdtHook.on = NO_OP;
      if (rdtHook.renderers.size) {
        rdtHook._instrumentationIsActive = true;
        onActiveListeners.forEach((listener) => listener());
        return;
      }
      const prevInject = rdtHook.inject;
      if (isReactRefresh(rdtHook) && !isRealReactDevtools()) {
        isReactRefreshOverride = true;
        // but since the underlying implementation doens't care,
        // it's ok: https://github.com/facebook/react/blob/18eaf51bd51fed8dfed661d64c306759101d0bfd/packages/react-refresh/src/ReactFreshRuntime.js#L430
        const nextID = rdtHook.inject({
          scheduleRefresh() {},
        });
        if (nextID) {
          rdtHook._instrumentationIsActive = true;
        }
      }
      rdtHook.inject = (renderer) => {
        const id = prevInject(renderer);
        _renderers.add(renderer);
        rdtHook._instrumentationIsActive = true;
        onActiveListeners.forEach((listener) => listener());
        return id;
      };
    }
    if (
      rdtHook.renderers.size ||
      rdtHook._instrumentationIsActive ||
      // depending on this to inject is unsafe, since inject could occur before and we wouldn't know
      isReactRefresh()
    ) {
      onActive?.();
    }
  } catch {}
};

export const hasRDTHook = (): boolean => {
  return objectHasOwnProperty.call(
    globalThis,
    '__REACT_DEVTOOLS_GLOBAL_HOOK__'
  );
};

/**
 * Returns the current React DevTools global hook.
 */
export const getRDTHook = (
  onActive?: () => unknown
): ReactDevToolsGlobalHook => {
  if (!hasRDTHook()) {
    return installRDTHook(onActive);
  }
  patchRDTHook(onActive);
  // must exist at this point
  return globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__ as ReactDevToolsGlobalHook;
};

export const isClientEnvironment = (): boolean => {
  return Boolean(
    typeof window !== 'undefined' &&
      // eslint-disable-next-line @typescript-eslint/unbound-method
      (window.document?.createElement ||
        window.navigator?.product === 'ReactNative'),
  );
};

/**
 * Usually used purely for side effect
 */
export const safelyInstallRDTHook = () => {
  try {
    // __REACT_DEVTOOLS_GLOBAL_HOOK__ must exist before React is ever executed
    if (isClientEnvironment()) {
      getRDTHook();
    }
  } catch {}
};
