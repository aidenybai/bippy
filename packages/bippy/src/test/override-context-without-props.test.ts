import "../index.js"; // KEEP THIS LINE ON TOP

import { expect, it } from "vitest";
import { overrideContext } from "../index.js";
import type { Fiber, ReactDevToolsGlobalHook, ReactRenderer } from "../types.js";

it("should do nothing when no renderer exposes overrideProps", () => {
  globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    _instrumentationSource: "test",
    renderers: new Map([[1, {} as unknown as ReactRenderer]]),
  } as unknown as ReactDevToolsGlobalHook;
  const contextType = { displayName: "TestContext" };
  const providerFiber = {
    alternate: null,
    return: null,
    type: contextType,
  } as unknown as Fiber;
  expect(() => overrideContext(providerFiber, contextType, { theme: "dark" })).not.toThrow();
});
