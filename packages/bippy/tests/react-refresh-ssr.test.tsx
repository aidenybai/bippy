// @vitest-environment node
import { describe, expect, it } from "vitest";
import * as bippy from "../src/index.js";
import { onReactRefresh } from "../src/react-refresh/index.js";

describe("react-refresh under SSR (no window)", () => {
  it("runs without a DOM", () => {
    expect(typeof window).toBe("undefined");
    expect(typeof document).toBe("undefined");
  });

  it("onReactRefresh returns null without throwing", () => {
    expect(onReactRefresh(() => {})).toBeNull();
  });

  it("importing and installing bippy core is side-effect safe on the server", () => {
    expect(bippy.isClientEnvironment()).toBe(false);
    expect(() => bippy.safelyInstallRDTHook()).not.toThrow();
    expect(bippy.isInstrumentationActive()).toBe(false);
  });
});
