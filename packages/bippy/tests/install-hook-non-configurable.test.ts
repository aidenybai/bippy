// HACK: Avoid importing index so this test controls hook installation.
import { expect, it, vi } from "vite-plus/test";
import { ReactBuildType } from "../src/react-internals/index.js";
import { installRDTHook } from "../src/rdt-hook.js";
import type { ReactDevToolsGlobalHook, ReactRenderer } from "../src/react-internals/index.js";
import { createReactRenderer } from "./create-react-renderer.js";

it("should fall back to patching when the hook property cannot be redefined", () => {
  const existingInject = vi.fn(() => 42);
  const existingHook: ReactDevToolsGlobalHook = {
    checkDCE: () => {},
    hasUnsupportedRendererAttached: false,
    inject: existingInject,
    on: () => {},
    onCommitFiberRoot: () => {},
    onCommitFiberUnmount: () => {},
    onPostCommitFiberRoot: () => {},
    renderers: new Map<number, ReactRenderer>(),
    supportsFiber: true,
    supportsFlight: true,
  };
  Object.defineProperty(globalThis, "__REACT_DEVTOOLS_GLOBAL_HOOK__", {
    configurable: false,
    value: existingHook,
    writable: true,
  });

  const onActive = vi.fn();
  installRDTHook(onActive);
  expect(existingHook._instrumentationSource).toBeDefined();
  expect(existingHook.inject).not.toBe(existingInject);
  expect(onActive).not.toHaveBeenCalled();

  const fakeRenderer = createReactRenderer({
    bundleType: ReactBuildType.Development,
  });
  const rendererId = existingHook.inject(fakeRenderer);
  expect(rendererId).toBe(42);
  expect(existingInject).toHaveBeenCalledWith(fakeRenderer);
  expect(existingHook.renderers.get(42)).toBe(fakeRenderer);
  expect(existingHook._instrumentationIsActive).toBe(true);
  expect(onActive).toHaveBeenCalledTimes(1);
});
