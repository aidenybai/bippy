// @vitest-environment node
import { describe, expect, it } from "vitest";
import * as bippy from "../src/index.js";
import { detectHmrTransport } from "../src/react-refresh/detect-hmr-transport.js";
import {
  createMetroHmrTransport,
  getMetroBundleUrl,
} from "../src/react-refresh/metro-hmr-transport.js";
import { createNextWebpackHmrTransport } from "../src/react-refresh/next-webpack-hmr-transport.js";
import { createViteHmrTransport } from "../src/react-refresh/vite-hmr-transport.js";

describe("react-refresh under SSR (no window)", () => {
  it("runs without a DOM", () => {
    expect(typeof window).toBe("undefined");
    expect(typeof document).toBe("undefined");
  });

  it("detectHmrTransport resolves null without throwing", async () => {
    await expect(detectHmrTransport(() => {})).resolves.toBeNull();
  });

  it("createViteHmrTransport resolves null without throwing", async () => {
    await expect(createViteHmrTransport(() => {})).resolves.toBeNull();
  });

  it("createNextWebpackHmrTransport returns null without throwing", () => {
    expect(createNextWebpackHmrTransport(() => {})).toBeNull();
  });

  it("createMetroHmrTransport returns null without throwing", () => {
    expect(createMetroHmrTransport(() => {})).toBeNull();
  });

  it("getMetroBundleUrl returns null without throwing", () => {
    expect(getMetroBundleUrl()).toBeNull();
  });

  it("importing and installing bippy core is side-effect safe on the server", () => {
    expect(bippy.isClientEnvironment()).toBe(false);
    expect(() => bippy.safelyInstallRDTHook()).not.toThrow();
    expect(bippy.isInstrumentationActive()).toBe(false);
  });
});
