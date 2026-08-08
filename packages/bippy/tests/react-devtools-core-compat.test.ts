import { expect, it, vi } from "vitest";
import { getRDTHook, isRealReactDevtools } from "../src/rdt-hook.js";

it("allows react-devtools-core to replace the preinstalled bippy hook", async () => {
  const bippyHook = getRDTHook();
  expect(isRealReactDevtools(bippyHook)).toBe(false);

  const { initialize } = await import("react-devtools-core");
  initialize();

  const reactDevtoolsHook = globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  expect(reactDevtoolsHook).not.toBe(bippyHook);
  expect(isRealReactDevtools(reactDevtoolsHook)).toBe(true);
  expect(reactDevtoolsHook?.sub).toBeTypeOf("function");
  expect(reactDevtoolsHook?.emit).toBeTypeOf("function");

  const listener = vi.fn();
  const unsubscribe = reactDevtoolsHook?.sub?.("bippy-test", listener);
  reactDevtoolsHook?.emit?.("bippy-test", { compatible: true });
  expect(listener).toHaveBeenCalledWith({ compatible: true });
  unsubscribe?.();
});
