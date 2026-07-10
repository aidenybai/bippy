// intentionally avoids importing ../index.js so this file controls hook installation
import { expect, it } from "vitest";
import { getRDTHook } from "../src/rdt-hook.js";
import type { ReactDevToolsGlobalHook, ReactRenderer } from "../src/types.js";

it("should not merge renderers into a new hook when none were injected", () => {
  const installedHook = getRDTHook();
  expect(installedHook.renderers.size).toBe(0);
  const replacementHook: ReactDevToolsGlobalHook = {
    checkDCE: () => {},
    hasUnsupportedRendererAttached: false,
    inject: () => 0,
    on: () => {},
    onCommitFiberRoot: () => {},
    onCommitFiberUnmount: () => {},
    onPostCommitFiberRoot: () => {},
    renderers: new Map<number, ReactRenderer>(),
    supportsFiber: true,
    supportsFlight: true,
  };
  globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__ = replacementHook;
  expect(globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__).toBe(replacementHook);
  expect(replacementHook.renderers.size).toBe(0);
  expect(replacementHook._instrumentationIsActive).toBeUndefined();
});
