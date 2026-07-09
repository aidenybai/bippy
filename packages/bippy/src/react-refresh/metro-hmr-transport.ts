import { HMR_RECONNECT_DELAY_MS } from "./constants.js";
import { HmrTransport, HmrUpdateHandler } from "./types.js";

declare global {
  var __turboModuleProxy: ((moduleName: string) => unknown) | undefined;
  var nativeModuleProxy: Record<string, unknown> | undefined;
}

const getScriptUrlFromSourceCodeModule = (sourceCodeModule: unknown): string | null => {
  if (typeof sourceCodeModule !== "object" || sourceCodeModule === null) return null;
  if (!("getConstants" in sourceCodeModule)) return null;
  const getConstants = sourceCodeModule.getConstants;
  if (typeof getConstants !== "function") return null;
  let constants: unknown;
  try {
    constants = getConstants.call(sourceCodeModule);
  } catch {
    return null;
  }
  if (typeof constants !== "object" || constants === null) return null;
  if (!("scriptURL" in constants)) return null;
  const scriptUrl = constants.scriptURL;
  return typeof scriptUrl === "string" ? scriptUrl : null;
};

/**
 * Resolves the URL the running React Native bundle was loaded from, using
 * the same `SourceCode` native module React Native's own dev tooling reads
 * (via the TurboModule proxy globals, so react-native is not imported).
 * Returns `null` outside a Metro-served React Native runtime.
 *
 * @example
 * ```ts
 * getMetroBundleUrl();
 * // "http://localhost:8081/index.bundle?platform=ios&dev=true"
 * ```
 */
export const getMetroBundleUrl = (): string | null => {
  if (typeof globalThis.__turboModuleProxy === "function") {
    let sourceCodeModule: unknown;
    try {
      sourceCodeModule = globalThis.__turboModuleProxy("SourceCode");
    } catch {
      sourceCodeModule = null;
    }
    const scriptUrl = getScriptUrlFromSourceCodeModule(sourceCodeModule);
    if (scriptUrl) return scriptUrl;
  }
  const legacySourceCodeModule = globalThis.nativeModuleProxy?.SourceCode;
  return getScriptUrlFromSourceCodeModule(legacySourceCodeModule);
};

// HACK: module sourceURLs may be JSC-safe URLs where "//&" stands in for
// "?" (iOS 16.4 stack traces strip query strings), so the query separator
// must be normalized before URL parsing.
const normalizeJscSafeUrl = (jscSafeUrl: string): string => jscSafeUrl.replace("//&", "?");

const getSourcePathFromSourceUrl = (sourceUrl: string): string | null => {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(normalizeJscSafeUrl(sourceUrl));
  } catch {
    return null;
  }
  let sourcePath = decodeURIComponent(parsedUrl.pathname);
  if (sourcePath.startsWith("/")) sourcePath = sourcePath.slice(1);
  // Metro rewrites each module's real extension to ".bundle" when building
  // hot-update sourceURLs, so the original extension is unrecoverable.
  if (sourcePath.endsWith(".bundle")) sourcePath = sourcePath.slice(0, -".bundle".length);
  return sourcePath.length > 0 ? sourcePath : null;
};

const collectModuleSourcePaths = (hmrModules: unknown, filePaths: string[]) => {
  if (!Array.isArray(hmrModules)) return;
  for (const hmrModule of hmrModules) {
    if (typeof hmrModule !== "object" || hmrModule === null) continue;
    if (!("sourceURL" in hmrModule) || typeof hmrModule.sourceURL !== "string") continue;
    const sourcePath = getSourcePathFromSourceUrl(hmrModule.sourceURL);
    if (!sourcePath || sourcePath.includes("node_modules")) continue;
    filePaths.push(sourcePath);
  }
};

/**
 * Extracts the updated source file paths from a raw Metro HMR WebSocket
 * message. Paths are project-relative but extension-less (`src/app`, not
 * `src/app.tsx`) because Metro rewrites module extensions to `.bundle`.
 * The initial update replayed on connect is skipped. Returns an empty
 * array for any other message shape.
 *
 * @example
 * ```ts
 * parseMetroUpdatePaths(rawMessageData);
 * // ["src/app"]
 * ```
 */
export const parseMetroUpdatePaths = (rawMessageData: string): string[] => {
  let message: unknown;
  try {
    message = JSON.parse(rawMessageData);
  } catch {
    return [];
  }
  if (typeof message !== "object" || message === null) return [];
  if (!("type" in message) || message.type !== "update") return [];
  if (!("body" in message) || typeof message.body !== "object" || message.body === null) return [];
  const updateBody = message.body;
  if ("isInitialUpdate" in updateBody && updateBody.isInitialUpdate === true) return [];
  const filePaths: string[] = [];
  if ("added" in updateBody) collectModuleSourcePaths(updateBody.added, filePaths);
  if ("modified" in updateBody) collectModuleSourcePaths(updateBody.modified, filePaths);
  return filePaths;
};

export interface MetroHmrTransportOptions {
  bundleUrl?: string;
}

/**
 * Subscribes to the Metro dev server's `/hot` HMR WebSocket (as a second
 * client alongside React Native's own) and invokes `onHmrUpdate` with the
 * updated file paths on every hot update. Reconnects automatically when
 * the dev server restarts. Returns `null` when no Metro bundle URL can be
 * resolved (production builds, non-Metro runtimes).
 *
 * @example
 * ```ts
 * const transport = createMetroHmrTransport((filePaths) => {
 *   console.log("hot updated:", filePaths);
 * });
 * transport?.dispose();
 * ```
 */
export const createMetroHmrTransport = (
  onHmrUpdate: HmrUpdateHandler,
  options: MetroHmrTransportOptions = {},
): HmrTransport | null => {
  if (typeof WebSocket === "undefined") return null;
  const bundleUrl = options.bundleUrl ?? getMetroBundleUrl();
  if (!bundleUrl) return null;

  let hotSocketUrl: string;
  try {
    const parsedBundleUrl = new URL(bundleUrl);
    const socketProtocol = parsedBundleUrl.protocol === "https:" ? "wss" : "ws";
    hotSocketUrl = `${socketProtocol}://${parsedBundleUrl.host}/hot`;
  } catch {
    return null;
  }

  let isDisposed = false;
  let socket: WebSocket | null = null;
  let reconnectTimerId: ReturnType<typeof setTimeout> | undefined;

  const scheduleReconnect = () => {
    if (isDisposed) return;
    reconnectTimerId = setTimeout(connect, HMR_RECONNECT_DELAY_MS);
  };

  const connect = () => {
    if (isDisposed) return;
    const connectedSocket = new WebSocket(hotSocketUrl);
    socket = connectedSocket;
    connectedSocket.onopen = () => {
      connectedSocket.send(
        JSON.stringify({ type: "register-entrypoints", entryPoints: [bundleUrl] }),
      );
    };
    connectedSocket.onmessage = (event) => {
      const filePaths = parseMetroUpdatePaths(String(event.data));
      if (filePaths.length > 0) onHmrUpdate(filePaths);
    };
    connectedSocket.onclose = scheduleReconnect;
  };

  connect();

  return {
    dispose: () => {
      isDisposed = true;
      clearTimeout(reconnectTimerId);
      if (socket) {
        socket.onclose = null;
        socket.close();
      }
    },
  };
};
