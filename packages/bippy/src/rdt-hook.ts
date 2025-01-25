import type { ReactDevToolsGlobalHook, ReactRenderer } from './types.js';

export const version = process.env.VERSION;
export const BIPPY_INSTRUMENTATION_STRING = `bippy-${version}`;

const objectDefineProperty = Object.defineProperty;
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
            'https://reactjs.org/link/perf-use-production-build',
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

export const installRDTHook = (
  onActive?: () => unknown,
): ReactDevToolsGlobalHook => {
  const renderers = new Map<number, ReactRenderer>();
  let i = 0;
  const rdtHook: ReactDevToolsGlobalHook = {
    checkDCE,
    supportsFiber: true,
    supportsFlight: true,
    hasUnsupportedRendererAttached: false,
    renderers,
    onCommitFiberRoot: NO_OP,
    onCommitFiberUnmount: NO_OP,
    onPostCommitFiberRoot: NO_OP,
    inject(renderer) {
      const nextID = ++i;
      renderers.set(nextID, renderer);
      if (!rdtHook._instrumentationIsActive) {
        rdtHook._instrumentationIsActive = true;
        // biome-ignore lint/complexity/noForEach: prefer forEach for Set
        onActiveListeners.forEach((listener) => listener());
      }
      return nextID;
    },
    _instrumentationSource: BIPPY_INSTRUMENTATION_STRING,
    _instrumentationIsActive: false,
  };
  try {
    objectDefineProperty(globalThis, '__REACT_DEVTOOLS_GLOBAL_HOOK__', {
      value: rdtHook,
      configurable: true,
      writable: true,
    });
    // [!] this is a hack for chrome extensions - if we install before React DevTools, we could accidently prevent React DevTools from installing:
    // https://github.com/facebook/react/blob/18eaf51bd51fed8dfed661d64c306759101d0bfd/packages/react-devtools-extensions/src/contentScripts/installHook.js#L30C6-L30C27
    const originalWindowHasOwnProperty = window.hasOwnProperty;
    let hasRanHack = false;
    objectDefineProperty(window, 'hasOwnProperty', {
      value: function (this: unknown) {
        // biome-ignore lint/style/noArguments: perf
        if (!hasRanHack && arguments[0] === '__REACT_DEVTOOLS_GLOBAL_HOOK__') {
          globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__ = undefined;
          // special falsy value to know that we've already installed before
          hasRanHack = true;
          return -0;
        }
        // biome-ignore lint/suspicious/noExplicitAny: perf
        // biome-ignore lint/style/noArguments: perf
        return originalWindowHasOwnProperty.apply(this, arguments as any);
      },
      configurable: true,
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
      isReactRefreshOverride = isReactRefresh(rdtHook);
      rdtHook.checkDCE = checkDCE;
      rdtHook.supportsFiber = true;
      rdtHook.supportsFlight = true;
      rdtHook.hasUnsupportedRendererAttached = false;
      rdtHook._instrumentationSource = BIPPY_INSTRUMENTATION_STRING;
      rdtHook._instrumentationIsActive = false;
      if (rdtHook.renderers.size) {
        rdtHook._instrumentationIsActive = true;
        // biome-ignore lint/complexity/noForEach: prefer forEach for Set
        onActiveListeners.forEach((listener) => listener());
        return;
      }
      const prevInject = rdtHook.inject;
      if (isReactRefresh(rdtHook) && !isRealReactDevtools()) {
        isReactRefreshOverride = true;
        // but since the underlying implementation doens't care,
        // it's ok: https://github.com/facebook/react/blob/18eaf51bd51fed8dfed661d64c306759101d0bfd/packages/react-refresh/src/ReactFreshRuntime.js#L430
        // @ts-expect-error this is not actually a ReactRenderer,
        let nextID = rdtHook.inject(null);
        if (nextID) {
          rdtHook._instrumentationIsActive = true;
        }
        rdtHook.inject = () => nextID++;
      } else {
        rdtHook.inject = (renderer) => {
          const id = prevInject(renderer);
          rdtHook._instrumentationIsActive = true;
          // biome-ignore lint/complexity/noForEach: prefer forEach for Set
          onActiveListeners.forEach((listener) => listener());
          return id;
        };
      }
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
    '__REACT_DEVTOOLS_GLOBAL_HOOK__',
  );
};

/**
 * Returns the current React DevTools global hook.
 */
export const getRDTHook = (
  onActive?: () => unknown,
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
      (window.document?.createElement ||
        window.navigator?.product === 'ReactNative'),
  );
};
