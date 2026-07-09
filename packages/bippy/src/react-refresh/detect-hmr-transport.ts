import { isClientEnvironment } from "../rdt-hook.js";

import { createMetroHmrTransport } from "./metro-hmr-transport.js";
import { createNextWebpackHmrTransport } from "./next-webpack-hmr-transport.js";
import { HmrTransport, HmrUpdateHandler } from "./types.js";
import { createViteHmrTransport } from "./vite-hmr-transport.js";

/**
 * Detects the dev server's HMR transport (Next.js webpack, then Metro for
 * React Native, then Vite) and subscribes `onHmrUpdate` to hot updates.
 * Resolves `null` on the server (SSR) and when no known transport is
 * available (production builds, unsupported bundlers — Turbopack exposes
 * `window.TURBOPACK_CHUNK_UPDATE_LISTENERS` but its update payload shape
 * has not been validated, so it is not wired up yet).
 *
 * @example
 * ```ts
 * const transport = await detectHmrTransport((filePaths) => {
 *   console.log("hot updated:", filePaths);
 * });
 * transport?.dispose();
 * ```
 */
export const detectHmrTransport = async (
  onHmrUpdate: HmrUpdateHandler,
): Promise<HmrTransport | null> => {
  if (!isClientEnvironment()) return null;
  const webpackTransport = createNextWebpackHmrTransport(onHmrUpdate);
  if (webpackTransport) return webpackTransport;
  const metroTransport = createMetroHmrTransport(onHmrUpdate);
  if (metroTransport) return metroTransport;
  return createViteHmrTransport(onHmrUpdate);
};
