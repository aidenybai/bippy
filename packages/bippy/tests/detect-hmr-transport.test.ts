import { afterEach, describe, expect, it, vi } from "vitest";
import { detectHmrTransport } from "../src/react-refresh/detect-hmr-transport.js";
import { installFakeWebSocket } from "./fake-web-socket.js";

const installFakeFetch = () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

const installMetroTurboModuleProxy = () => {
  globalThis.__turboModuleProxy = (moduleName: string) =>
    moduleName === "SourceCode"
      ? { getConstants: () => ({ scriptURL: "http://localhost:8081/index.bundle?platform=ios" }) }
      : null;
};

describe("detectHmrTransport", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete window.webpackHotUpdate_N_E;
    delete globalThis.__turboModuleProxy;
  });

  it("prefers the Next.js webpack transport when its global is present", async () => {
    const socketInstances = installFakeWebSocket();
    const fetchMock = installFakeFetch();
    installMetroTurboModuleProxy();
    const originalHotUpdate = vi.fn();
    window.webpackHotUpdate_N_E = originalHotUpdate;

    const transport = await detectHmrTransport(() => {});
    expect(transport).not.toBeNull();
    expect(window.webpackHotUpdate_N_E).not.toBe(originalHotUpdate);
    expect(socketInstances).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();

    transport?.dispose();
    expect(window.webpackHotUpdate_N_E).toBe(originalHotUpdate);
  });

  it("falls back to the Metro transport when webpack is absent", async () => {
    const socketInstances = installFakeWebSocket();
    const fetchMock = installFakeFetch();
    installMetroTurboModuleProxy();

    const transport = await detectHmrTransport(() => {});
    expect(transport).not.toBeNull();
    expect(socketInstances).toHaveLength(1);
    expect(socketInstances[0].url).toBe("ws://localhost:8081/hot");
    expect(fetchMock).not.toHaveBeenCalled();

    transport?.dispose();
  });

  it("falls back to the Vite transport when neither webpack nor Metro applies", async () => {
    const socketInstances = installFakeWebSocket();
    const fetchMock = installFakeFetch();
    fetchMock.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('const wsToken = "vite-token";'),
    });

    const transport = await detectHmrTransport(() => {});
    expect(transport).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledWith("/@vite/client");
    expect(socketInstances).toHaveLength(1);
    expect(socketInstances[0].url).toContain("?token=vite-token");

    transport?.dispose();
  });

  it("resolves null when no transport is available", async () => {
    installFakeWebSocket();
    const fetchMock = installFakeFetch();
    fetchMock.mockRejectedValue(new Error("not a dev server"));

    await expect(detectHmrTransport(() => {})).resolves.toBeNull();
  });
});
