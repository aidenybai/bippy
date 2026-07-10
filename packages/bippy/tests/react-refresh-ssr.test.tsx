// @vitest-environment node
import { describe, expect, it } from "vitest";
import * as bippy from "../src/index.js";
import { detectHmrTransport } from "../src/react-refresh/detect-hmr-transport.js";
import { instrumentReactRefresh } from "../src/react-refresh/index.js";

describe("react-refresh under SSR (no window)", () => {
  it("runs without a DOM", () => {
    expect(typeof window).toBe("undefined");
    expect(typeof document).toBe("undefined");
  });

  it("instrumentReactRefresh returns a no-op unsubscribe without throwing", () => {
    const unsubscribe = instrumentReactRefresh({ onRefresh: () => {} });
    expect(typeof unsubscribe).toBe("function");
    expect(() => unsubscribe()).not.toThrow();
  });

  it("detectHmrTransport resolves null without throwing", async () => {
    await expect(detectHmrTransport(() => {})).resolves.toBeNull();
  });

  it("importing and installing bippy core is side-effect safe on the server", () => {
    expect(bippy.isClientEnvironment()).toBe(false);
    expect(() => bippy.safelyInstallRDTHook()).not.toThrow();
    expect(bippy.isInstrumentationActive()).toBe(false);
  });
});
