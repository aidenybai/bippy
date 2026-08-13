import type { ReactDevToolsGlobalHook } from "../src/react-internals/index.js";

export const createRDTHook = (overrides: Record<string, unknown> = {}): ReactDevToolsGlobalHook => {
  const rdtHook: ReactDevToolsGlobalHook = {
    checkDCE: () => {},
    hasUnsupportedRendererAttached: false,
    inject: () => 1,
    on: () => {},
    onCommitFiberRoot: () => {},
    onCommitFiberUnmount: () => {},
    onPostCommitFiberRoot: () => {},
    renderers: new Map(),
    supportsFiber: true,
    supportsFlight: true,
  };

  return Object.assign(rdtHook, overrides);
};
