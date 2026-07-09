import { afterEach, describe, expect, it, vi } from "vitest";
import { installFakeWebSocket } from "./fake-web-socket.js";
import {
  createMetroHmrTransport,
  getMetroBundleUrl,
  parseMetroUpdatePaths,
} from "../react-refresh/metro-hmr-transport.js";
import {
  createNextWebpackHmrTransport,
  normalizeWebpackModulePaths,
} from "../react-refresh/next-webpack-hmr-transport.js";
import { normalizeHmrFilePath } from "../react-refresh/normalize-hmr-file-path.js";
import { pickHmrSourcePath } from "../react-refresh/pick-hmr-source-path.js";
import { parseViteUpdatePaths } from "../react-refresh/vite-hmr-transport.js";

describe("parseViteUpdatePaths", () => {
  it("extracts acceptedPath from js-update entries", () => {
    const message = JSON.stringify({
      type: "update",
      updates: [
        {
          type: "js-update",
          timestamp: 1,
          path: "/src/app.tsx",
          acceptedPath: "/src/app.tsx",
        },
      ],
    });
    expect(parseViteUpdatePaths(message)).toEqual(["/src/app.tsx"]);
  });

  it("keeps css paths delivered as js-update (tailwind JIT shape)", () => {
    const message = JSON.stringify({
      type: "update",
      updates: [
        { type: "js-update", acceptedPath: "/src/index.css" },
        { type: "js-update", acceptedPath: "/src/button.tsx" },
      ],
    });
    expect(parseViteUpdatePaths(message)).toEqual(["/src/index.css", "/src/button.tsx"]);
  });

  it("skips css-update entries", () => {
    const message = JSON.stringify({
      type: "update",
      updates: [
        { type: "css-update", acceptedPath: "/src/index.css" },
        { type: "js-update", acceptedPath: "/src/app.tsx" },
      ],
    });
    expect(parseViteUpdatePaths(message)).toEqual(["/src/app.tsx"]);
  });

  it("returns empty for non-update message types", () => {
    expect(parseViteUpdatePaths(JSON.stringify({ type: "connected" }))).toEqual([]);
    expect(parseViteUpdatePaths(JSON.stringify({ type: "full-reload" }))).toEqual([]);
  });

  it("returns empty for malformed payloads", () => {
    expect(parseViteUpdatePaths("not json")).toEqual([]);
    expect(parseViteUpdatePaths(JSON.stringify(null))).toEqual([]);
    expect(parseViteUpdatePaths(JSON.stringify({ type: "update" }))).toEqual([]);
    expect(parseViteUpdatePaths(JSON.stringify({ type: "update", updates: "nope" }))).toEqual([]);
    expect(
      parseViteUpdatePaths(JSON.stringify({ type: "update", updates: [{ type: "js-update" }] })),
    ).toEqual([]);
  });
});

describe("normalizeHmrFilePath", () => {
  it("strips bundler layer prefixes and leading ./", () => {
    expect(normalizeHmrFilePath("(app-pages-browser)/./app/page.tsx")).toBe("app/page.tsx");
    expect(normalizeHmrFilePath("./components/hero.tsx")).toBe("components/hero.tsx");
  });

  it("passes through already-normalized paths", () => {
    expect(normalizeHmrFilePath("src/app.tsx")).toBe("src/app.tsx");
  });
});

describe("normalizeWebpackModulePaths", () => {
  it("strips the bundler layer prefix and leading ./ from app-router keys", () => {
    expect(normalizeWebpackModulePaths(["(app-pages-browser)/./app/page.tsx"])).toEqual([
      "app/page.tsx",
    ]);
  });

  it("filters out node_modules entries", () => {
    expect(
      normalizeWebpackModulePaths([
        "(app-pages-browser)/./node_modules/next/dist/client/app-dir.js",
        "(app-pages-browser)/./app/layout.tsx",
      ]),
    ).toEqual(["app/layout.tsx"]);
  });

  it("filters out keys without source file extensions", () => {
    expect(
      normalizeWebpackModulePaths([
        "webpack/runtime/getFullHash",
        "(app-pages-browser)/./app/page.tsx",
      ]),
    ).toEqual(["app/page.tsx"]);
  });

  it("keeps css module keys so the css-vs-source preference happens downstream", () => {
    expect(normalizeWebpackModulePaths(["(app-pages-browser)/./app/globals.css"])).toEqual([
      "app/globals.css",
    ]);
  });

  it("handles multiple updated modules in one hot update", () => {
    expect(
      normalizeWebpackModulePaths([
        "(app-pages-browser)/./app/page.tsx",
        "(app-pages-browser)/./components/card.tsx",
      ]),
    ).toEqual(["app/page.tsx", "components/card.tsx"]);
  });
});

describe("pickHmrSourcePath", () => {
  it("prefers the first non-css path", () => {
    expect(pickHmrSourcePath(["/src/index.css", "/src/app.tsx", "/src/other.tsx"])).toBe(
      "/src/app.tsx",
    );
  });

  it("falls back to the first path when all are css", () => {
    expect(pickHmrSourcePath(["/src/index.css", "/src/theme.css"])).toBe("/src/index.css");
  });

  it("returns null for an empty list", () => {
    expect(pickHmrSourcePath([])).toBeNull();
  });
});

describe("createNextWebpackHmrTransport", () => {
  it("returns null when the webpack hot-update global is missing", () => {
    delete window.webpackHotUpdate_N_E;
    expect(createNextWebpackHmrTransport(() => {})).toBeNull();
  });

  it("wraps the global, forwards normalized paths, and restores on dispose", () => {
    const originalHotUpdate = vi.fn();
    window.webpackHotUpdate_N_E = originalHotUpdate;

    const onHmrUpdate = vi.fn();
    const transport = createNextWebpackHmrTransport(onHmrUpdate);
    expect(transport).not.toBeNull();
    expect(window.webpackHotUpdate_N_E).not.toBe(originalHotUpdate);

    window.webpackHotUpdate_N_E?.(
      "chunk-id",
      { "(app-pages-browser)/./app/page.tsx": {} },
      undefined,
    );
    expect(onHmrUpdate).toHaveBeenCalledWith(["app/page.tsx"]);
    expect(originalHotUpdate).toHaveBeenCalledTimes(1);

    transport?.dispose();
    expect(window.webpackHotUpdate_N_E).toBe(originalHotUpdate);
    delete window.webpackHotUpdate_N_E;
  });

  it("does not invoke the handler for updates with no source paths", () => {
    const originalHotUpdate = vi.fn();
    window.webpackHotUpdate_N_E = originalHotUpdate;

    const onHmrUpdate = vi.fn();
    const transport = createNextWebpackHmrTransport(onHmrUpdate);

    window.webpackHotUpdate_N_E?.("chunk-id", { "webpack/runtime/getFullHash": {} }, undefined);
    expect(onHmrUpdate).not.toHaveBeenCalled();
    expect(originalHotUpdate).toHaveBeenCalledTimes(1);

    transport?.dispose();
    delete window.webpackHotUpdate_N_E;
  });

  it("tolerates hot updates delivered without an updated modules record", () => {
    const originalHotUpdate = vi.fn();
    window.webpackHotUpdate_N_E = originalHotUpdate;

    const onHmrUpdate = vi.fn();
    const transport = createNextWebpackHmrTransport(onHmrUpdate);

    window.webpackHotUpdate_N_E?.("chunk-id", undefined, undefined);
    expect(onHmrUpdate).not.toHaveBeenCalled();
    expect(originalHotUpdate).toHaveBeenCalledWith("chunk-id", undefined, undefined);

    transport?.dispose();
    delete window.webpackHotUpdate_N_E;
  });

  it("does not clobber a replacement wrapper on dispose", () => {
    const originalHotUpdate = vi.fn();
    window.webpackHotUpdate_N_E = originalHotUpdate;

    const transport = createNextWebpackHmrTransport(() => {});
    const replacementHotUpdate = vi.fn();
    window.webpackHotUpdate_N_E = replacementHotUpdate;

    transport?.dispose();
    expect(window.webpackHotUpdate_N_E).toBe(replacementHotUpdate);
    delete window.webpackHotUpdate_N_E;
  });
});

const METRO_MODULE_SOURCE_URL =
  "http://localhost:8081/src/App.bundle//&platform=ios&dev=true&minify=false";

const buildMetroUpdateMessage = (body: Record<string, unknown>): string =>
  JSON.stringify({ type: "update", body });

describe("parseMetroUpdatePaths", () => {
  it("extracts extension-less project-relative paths from jsc-safe sourceURLs", () => {
    const message = buildMetroUpdateMessage({
      revisionId: "abc",
      isInitialUpdate: false,
      added: [],
      modified: [{ module: [1, "code"], sourceURL: METRO_MODULE_SOURCE_URL }],
      deleted: [],
    });
    expect(parseMetroUpdatePaths(message)).toEqual(["src/App"]);
  });

  it("collects added and modified modules and skips node_modules", () => {
    const message = buildMetroUpdateMessage({
      isInitialUpdate: false,
      added: [
        {
          module: [2, "code"],
          sourceURL: "http://localhost:8081/src/components/card.bundle//&platform=ios",
        },
      ],
      modified: [
        {
          module: [3, "code"],
          sourceURL: "http://localhost:8081/node_modules/react/index.bundle//&platform=ios",
        },
      ],
      deleted: [],
    });
    expect(parseMetroUpdatePaths(message)).toEqual(["src/components/card"]);
  });

  it("skips the initial update replayed on connect", () => {
    const message = buildMetroUpdateMessage({
      isInitialUpdate: true,
      added: [{ module: [1, "code"], sourceURL: METRO_MODULE_SOURCE_URL }],
      modified: [],
      deleted: [],
    });
    expect(parseMetroUpdatePaths(message)).toEqual([]);
  });

  it("handles plain (non-jsc-safe) sourceURLs", () => {
    const message = buildMetroUpdateMessage({
      isInitialUpdate: false,
      added: [],
      modified: [
        { module: [1, "code"], sourceURL: "http://localhost:8081/src/App.bundle?platform=android" },
      ],
      deleted: [],
    });
    expect(parseMetroUpdatePaths(message)).toEqual(["src/App"]);
  });

  it("returns empty for other message types and malformed payloads", () => {
    expect(parseMetroUpdatePaths(JSON.stringify({ type: "update-start" }))).toEqual([]);
    expect(parseMetroUpdatePaths(JSON.stringify({ type: "update-done" }))).toEqual([]);
    expect(parseMetroUpdatePaths("not json")).toEqual([]);
    expect(parseMetroUpdatePaths(JSON.stringify(42))).toEqual([]);
    expect(parseMetroUpdatePaths(JSON.stringify({ type: "update" }))).toEqual([]);
    expect(
      parseMetroUpdatePaths(
        buildMetroUpdateMessage({ isInitialUpdate: false, modified: [{ module: [1, "code"] }] }),
      ),
    ).toEqual([]);
  });

  it("handles bodies with only added or only modified module lists", () => {
    expect(
      parseMetroUpdatePaths(
        buildMetroUpdateMessage({
          isInitialUpdate: false,
          added: [{ module: [1, "code"], sourceURL: METRO_MODULE_SOURCE_URL }],
        }),
      ),
    ).toEqual(["src/App"]);
    expect(
      parseMetroUpdatePaths(
        buildMetroUpdateMessage({
          isInitialUpdate: false,
          modified: [{ module: [1, "code"], sourceURL: METRO_MODULE_SOURCE_URL }],
        }),
      ),
    ).toEqual(["src/App"]);
  });

  it("skips non-array module lists and non-object module entries", () => {
    expect(
      parseMetroUpdatePaths(
        buildMetroUpdateMessage({
          isInitialUpdate: false,
          added: "not an array",
          modified: ["not an object", null],
        }),
      ),
    ).toEqual([]);
  });

  it("skips modules with unparseable or empty-path sourceURLs", () => {
    expect(
      parseMetroUpdatePaths(
        buildMetroUpdateMessage({
          isInitialUpdate: false,
          added: [],
          modified: [
            { module: [1, "code"], sourceURL: "::not a url::" },
            { module: [2, "code"], sourceURL: "http://localhost:8081/" },
            { module: [3, "code"], sourceURL: METRO_MODULE_SOURCE_URL },
          ],
        }),
      ),
    ).toEqual(["src/App"]);
  });

  it("keeps sourceURL paths that lack a .bundle suffix", () => {
    expect(
      parseMetroUpdatePaths(
        buildMetroUpdateMessage({
          isInitialUpdate: false,
          added: [],
          modified: [
            { module: [1, "code"], sourceURL: "http://localhost:8081/src/App.tsx?platform=ios" },
          ],
        }),
      ),
    ).toEqual(["src/App.tsx"]);
  });

  it("handles sourceURL pathnames without a leading slash", () => {
    expect(
      parseMetroUpdatePaths(
        buildMetroUpdateMessage({
          isInitialUpdate: false,
          added: [],
          modified: [{ module: [1, "code"], sourceURL: "data:src/App.bundle" }],
        }),
      ),
    ).toEqual(["src/App"]);
  });
});

describe("getMetroBundleUrl", () => {
  afterEach(() => {
    delete globalThis.__turboModuleProxy;
    delete globalThis.nativeModuleProxy;
  });

  it("reads scriptURL through the turbo module proxy", () => {
    globalThis.__turboModuleProxy = (moduleName: string) =>
      moduleName === "SourceCode"
        ? { getConstants: () => ({ scriptURL: "http://localhost:8081/index.bundle?platform=ios" }) }
        : null;
    expect(getMetroBundleUrl()).toBe("http://localhost:8081/index.bundle?platform=ios");
  });

  it("falls back to the legacy native module proxy", () => {
    globalThis.nativeModuleProxy = {
      SourceCode: {
        getConstants: () => ({ scriptURL: "http://localhost:8081/index.bundle?platform=android" }),
      },
    };
    expect(getMetroBundleUrl()).toBe("http://localhost:8081/index.bundle?platform=android");
  });

  it("returns null outside a Metro-served runtime", () => {
    expect(getMetroBundleUrl()).toBeNull();
  });

  it("falls back to the legacy proxy when the turbo module proxy throws", () => {
    globalThis.__turboModuleProxy = () => {
      throw new Error("module not registered");
    };
    globalThis.nativeModuleProxy = {
      SourceCode: {
        getConstants: () => ({ scriptURL: "http://localhost:8081/index.bundle?platform=ios" }),
      },
    };
    expect(getMetroBundleUrl()).toBe("http://localhost:8081/index.bundle?platform=ios");
  });

  it("falls back to the legacy proxy when the turbo module yields no script url", () => {
    globalThis.__turboModuleProxy = () => ({ getConstants: () => ({}) });
    globalThis.nativeModuleProxy = {
      SourceCode: {
        getConstants: () => ({ scriptURL: "http://localhost:8081/index.bundle?platform=ios" }),
      },
    };
    expect(getMetroBundleUrl()).toBe("http://localhost:8081/index.bundle?platform=ios");
  });

  it("returns null for malformed SourceCode module shapes", () => {
    globalThis.__turboModuleProxy = () => ({});
    expect(getMetroBundleUrl()).toBeNull();

    globalThis.__turboModuleProxy = () => ({ getConstants: "not a function" });
    expect(getMetroBundleUrl()).toBeNull();

    globalThis.__turboModuleProxy = () => ({
      getConstants: () => {
        throw new Error("bridge unavailable");
      },
    });
    expect(getMetroBundleUrl()).toBeNull();

    globalThis.__turboModuleProxy = () => ({ getConstants: () => "not an object" });
    expect(getMetroBundleUrl()).toBeNull();

    globalThis.__turboModuleProxy = () => ({ getConstants: () => ({ scriptURL: 42 }) });
    expect(getMetroBundleUrl()).toBeNull();
  });
});

describe("createMetroHmrTransport", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete globalThis.__turboModuleProxy;
  });

  it("returns null when no bundle url can be resolved", () => {
    installFakeWebSocket();
    expect(createMetroHmrTransport(() => {})).toBeNull();
  });

  it("returns null when WebSocket is unavailable", () => {
    vi.stubGlobal("WebSocket", undefined);
    expect(
      createMetroHmrTransport(() => {}, { bundleUrl: "http://localhost:8081/index.bundle" }),
    ).toBeNull();
  });

  it("returns null for an unparseable bundle url", () => {
    installFakeWebSocket();
    expect(createMetroHmrTransport(() => {}, { bundleUrl: "::not a url::" })).toBeNull();
  });

  it("connects to /hot, registers the bundle entrypoint, and forwards update paths", () => {
    const socketInstances = installFakeWebSocket();
    const onHmrUpdate = vi.fn();
    const transport = createMetroHmrTransport(onHmrUpdate, {
      bundleUrl: "http://localhost:8081/index.bundle?platform=ios&dev=true",
    });
    expect(transport).not.toBeNull();
    expect(socketInstances).toHaveLength(1);
    expect(socketInstances[0].url).toBe("ws://localhost:8081/hot");

    socketInstances[0].onopen?.();
    expect(socketInstances[0].sentMessages).toEqual([
      JSON.stringify({
        type: "register-entrypoints",
        entryPoints: ["http://localhost:8081/index.bundle?platform=ios&dev=true"],
      }),
    ]);

    socketInstances[0].onmessage?.({
      data: buildMetroUpdateMessage({
        isInitialUpdate: false,
        added: [],
        modified: [{ module: [1, "code"], sourceURL: METRO_MODULE_SOURCE_URL }],
        deleted: [],
      }),
    });
    expect(onHmrUpdate).toHaveBeenCalledWith(["src/App"]);

    transport?.dispose();
    expect(socketInstances[0].onclose).toBeNull();
  });

  it("resolves the bundle url from the turbo module proxy when not provided", () => {
    const socketInstances = installFakeWebSocket();
    globalThis.__turboModuleProxy = (moduleName: string) =>
      moduleName === "SourceCode"
        ? { getConstants: () => ({ scriptURL: "https://tunnel.example/index.bundle?dev=true" }) }
        : null;
    const transport = createMetroHmrTransport(() => {});
    expect(transport).not.toBeNull();
    expect(socketInstances[0].url).toBe("wss://tunnel.example/hot");
    transport?.dispose();
  });

  it("does not invoke the handler for non-update messages", () => {
    const socketInstances = installFakeWebSocket();
    const onHmrUpdate = vi.fn();
    const transport = createMetroHmrTransport(onHmrUpdate, {
      bundleUrl: "http://localhost:8081/index.bundle",
    });

    socketInstances[0].onmessage?.({ data: JSON.stringify({ type: "update-start" }) });
    expect(onHmrUpdate).not.toHaveBeenCalled();

    transport?.dispose();
  });

  it("reconnects after the socket closes", () => {
    vi.useFakeTimers();
    const socketInstances = installFakeWebSocket();
    const transport = createMetroHmrTransport(() => {}, {
      bundleUrl: "http://localhost:8081/index.bundle",
    });

    socketInstances[0].onclose?.();
    expect(socketInstances).toHaveLength(1);
    vi.advanceTimersByTime(1000);
    expect(socketInstances).toHaveLength(2);
    expect(socketInstances[1].url).toBe("ws://localhost:8081/hot");

    transport?.dispose();
  });

  it("dispose cancels a pending reconnect timer", () => {
    vi.useFakeTimers();
    const socketInstances = installFakeWebSocket();
    const transport = createMetroHmrTransport(() => {}, {
      bundleUrl: "http://localhost:8081/index.bundle",
    });

    socketInstances[0].onclose?.();
    transport?.dispose();
    vi.advanceTimersByTime(5000);
    expect(socketInstances).toHaveLength(1);
  });

  it("ignores a close event delivered after dispose", () => {
    vi.useFakeTimers();
    const socketInstances = installFakeWebSocket();
    const transport = createMetroHmrTransport(() => {}, {
      bundleUrl: "http://localhost:8081/index.bundle",
    });

    const capturedCloseHandler = socketInstances[0].onclose;
    transport?.dispose();
    capturedCloseHandler?.();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not reconnect when a stale reconnect timer fires after dispose", () => {
    vi.useFakeTimers();
    const socketInstances = installFakeWebSocket();
    const transport = createMetroHmrTransport(() => {}, {
      bundleUrl: "http://localhost:8081/index.bundle",
    });

    // HACK: two close events queue two reconnect timers but dispose can only
    // clear the last one, so the stale first timer exercises the disposed
    // guard inside connect.
    socketInstances[0].onclose?.();
    socketInstances[0].onclose?.();
    transport?.dispose();
    vi.advanceTimersByTime(5000);
    expect(socketInstances).toHaveLength(1);
  });
});
