import { HMR_RECONNECT_DELAY_MS, VITE_WS_TOKEN_REGEX } from "./constants.js";
import { HmrTransport, HmrUpdateHandler } from "./types.js";

/**
 * Extracts the accepted file paths from a raw Vite HMR WebSocket message.
 * Only `js-update` entries are kept (a `css-update` swaps a stylesheet link
 * without re-running modules). Returns an empty array for any other message
 * shape.
 *
 * @example
 * ```ts
 * parseViteUpdatePaths(rawMessageData);
 * // ["/src/app.tsx"]
 * ```
 */
export const parseViteUpdatePaths = (rawMessageData: string): string[] => {
  let message: unknown;
  try {
    message = JSON.parse(rawMessageData);
  } catch {
    return [];
  }
  if (typeof message !== "object" || message === null) return [];
  if (!("type" in message) || message.type !== "update") return [];
  if (!("updates" in message) || !Array.isArray(message.updates)) return [];
  const filePaths: string[] = [];
  for (const update of message.updates) {
    if (typeof update !== "object" || update === null) continue;
    if (!("type" in update) || update.type !== "js-update") continue;
    if (!("acceptedPath" in update) || typeof update.acceptedPath !== "string") continue;
    filePaths.push(update.acceptedPath);
  }
  return filePaths;
};

// HACK: a standalone script is not a Vite module, so import.meta.hot is
// unavailable; open a second HMR WebSocket using the wsToken scraped from
// the dev server's own /@vite/client source.
const fetchViteWsToken = async (): Promise<string | null> => {
  try {
    const response = await fetch("/@vite/client");
    if (!response.ok) return null;
    const clientSource = await response.text();
    return VITE_WS_TOKEN_REGEX.exec(clientSource)?.[1] ?? null;
  } catch {
    return null;
  }
};

/**
 * Subscribes to the current page's Vite dev server HMR WebSocket and invokes
 * `onHmrUpdate` with the updated file paths on every hot update. Reconnects
 * automatically when the dev server restarts. Resolves `null` when the page
 * is not served by Vite.
 *
 * @example
 * ```ts
 * const transport = await createViteHmrTransport((filePaths) => {
 *   console.log("hot updated:", filePaths);
 * });
 * transport?.dispose();
 * ```
 */
export const createViteHmrTransport = async (
  onHmrUpdate: HmrUpdateHandler,
): Promise<HmrTransport | null> => {
  if (typeof window === "undefined" || typeof WebSocket === "undefined") return null;
  const initialWsToken = await fetchViteWsToken();
  if (!initialWsToken) return null;

  let isDisposed = false;
  let socket: WebSocket | null = null;
  let reconnectTimerId: number | undefined;

  const scheduleReconnect = () => {
    if (isDisposed) return;
    reconnectTimerId = window.setTimeout(() => {
      void fetchViteWsToken().then((freshWsToken) => {
        if (isDisposed) return;
        if (freshWsToken) {
          connect(freshWsToken);
        } else {
          scheduleReconnect();
        }
      });
    }, HMR_RECONNECT_DELAY_MS);
  };

  const connect = (wsToken: string) => {
    if (isDisposed) return;
    const socketProtocol = location.protocol === "https:" ? "wss" : "ws";
    const connectedSocket = new WebSocket(
      `${socketProtocol}://${location.host}/?token=${wsToken}`,
      "vite-hmr",
    );
    socket = connectedSocket;
    connectedSocket.onmessage = (event) => {
      const filePaths = parseViteUpdatePaths(String(event.data));
      if (filePaths.length > 0) onHmrUpdate(filePaths);
    };
    connectedSocket.onclose = scheduleReconnect;
  };

  connect(initialWsToken);

  return {
    dispose: () => {
      isDisposed = true;
      window.clearTimeout(reconnectTimerId);
      if (socket) {
        socket.onclose = null;
        socket.close();
      }
    },
  };
};
