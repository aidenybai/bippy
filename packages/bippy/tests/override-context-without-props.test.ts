import "../src/index.js"; // HACK: Bippy must initialize before imports that load React.

import { expect, it } from "vite-plus/test";
import { overrideContext } from "../src/index.js";
import { createFiber } from "./create-fiber.js";
import { createRDTHook } from "./create-rdt-hook.js";
import { createReactRenderer } from "./create-react-renderer.js";

it("should do nothing when no renderer exposes overrideProps", () => {
  globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__ = createRDTHook({
    _instrumentationSource: "test",
    renderers: new Map([[1, createReactRenderer()]]),
  });
  const contextType = { displayName: "TestContext" };
  const providerFiber = createFiber({
    alternate: null,
    return: null,
    type: contextType,
  });
  expect(() => overrideContext(providerFiber, contextType, { theme: "dark" })).not.toThrow();
});
