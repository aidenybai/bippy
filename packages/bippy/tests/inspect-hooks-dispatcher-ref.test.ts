import { describe, expect, it } from "vite-plus/test";
import type { Fiber } from "../src/react-internals/index.js";
import { _renderers } from "../src/rdt-hook.js";
import { getFiberHooks } from "../src/source/inspect-hooks.js";
import { createFiber } from "./create-fiber.js";
import { createReactRenderer } from "./create-react-renderer.js";

const createFakeFiber = (type: unknown): Fiber =>
  createFiber({
    type,
    elementType: type,
  });

describe("getFiberHooks dispatcher discovery", () => {
  it("throws when no react renderer is registered", () => {
    const fiber = createFakeFiber(() => null);
    expect(() => getFiberHooks(fiber)).toThrowError(
      "Bippy couldn’t find a React renderer. Load React and install Bippy’s hook.",
    );
  });

  it("supports renderers exposing a dispatcher ref with a current property", () => {
    const legacyDispatcherRef: { current: unknown } = { current: null };
    const rendererWithoutRef = createReactRenderer({ currentDispatcherRef: null });
    const legacyRenderer = createReactRenderer({ currentDispatcherRef: legacyDispatcherRef });
    _renderers.add(rendererWithoutRef);
    _renderers.add(legacyRenderer);

    try {
      let capturedState: unknown = null;
      const LegacyDispatcherComponent = (): null => {
        const dispatcher = legacyDispatcherRef.current as {
          useState: (initialState: unknown) => [unknown, () => void];
        };
        capturedState = dispatcher.useState("legacy-state")[0];
        return null;
      };
      const fiber = createFakeFiber(LegacyDispatcherComponent);

      const hooksTree = getFiberHooks(fiber);

      expect(capturedState).toBe("legacy-state");
      expect(legacyDispatcherRef.current).toBeNull();
      expect(hooksTree.length).toBeGreaterThanOrEqual(1);
    } finally {
      _renderers.delete(rendererWithoutRef);
      _renderers.delete(legacyRenderer);
    }
  });
});
