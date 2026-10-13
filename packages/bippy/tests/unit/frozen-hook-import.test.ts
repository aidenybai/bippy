// intentionally imports bippy dynamically so a frozen foreign hook can be
// installed before bippy loads
import { expect, it } from "vite-plus/test";
import type { ReactDevToolsGlobalHook } from "../../src/react-internals/index";

it("does not crash module evaluation when the hook is frozen", async () => {
  const frozenHook: ReactDevToolsGlobalHook = Object.freeze({
    checkDCE: () => {},
    hasUnsupportedRendererAttached: false,
    inject: () => 0,
    on: () => {},
    onCommitFiberRoot: () => {},
    onCommitFiberUnmount: () => {},
    onPostCommitFiberRoot: () => {},
    renderers: new Map(),
    supportsFiber: true,
    supportsFlight: true,
  });
  globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__ = frozenHook;

  const bippy = await import("../../src/index");
  expect(bippy.isInstrumentationActive()).toBe(false);
});
