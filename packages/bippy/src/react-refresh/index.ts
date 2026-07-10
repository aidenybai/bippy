import { getType, traverseFiber } from "../core.js";
import { getRDTHook, isClientEnvironment, onRendererInject } from "../rdt-hook.js";
import type { Fiber, FiberRoot, ReactRenderer } from "../types.js";
import { toUnsubscribe, type Unsubscribe } from "../unsubscribe.js";
import { PENDING_HOT_UPDATE_MAX_AGE_MS } from "./constants.js";
import { detectHmrTransport } from "./detect-hmr-transport.js";
import { HmrTransport } from "./types.js";

export interface ReactRefreshUpdate {
  /**
   * hot-updated source file paths reported by the bundler's HMR transport
   * (auto-detected: Next.js webpack, Metro, Vite). Best-effort: empty when
   * the bundler does not expose a transport (e.g. Turbopack) or when the
   * transport message has not arrived yet (e.g. Metro delivers updates on
   * an independent socket).
   */
  filePaths: string[];
  root: FiberRoot;
  /** new component types that were remounted, losing state */
  staleComponents: unknown[];
  /** mounted fibers whose component types were remounted */
  staleFibers: Fiber[];
  /** new component types that re-rendered preserving state */
  updatedComponents: unknown[];
  /** mounted fibers whose component types re-rendered preserving state */
  updatedFibers: Fiber[];
}

export interface ReactRefreshHandler {
  (update: ReactRefreshUpdate): void;
}

const collectFibersByComponentType = (root: FiberRoot, componentTypes: Set<unknown>): Fiber[] => {
  if (componentTypes.size === 0 || !root.current) return [];
  const matchedFibers: Fiber[] = [];
  traverseFiber(root.current, (fiber) => {
    // memo/forwardRef fibers carry the wrapper as fiber.type, while the
    // refresh families can register either the wrapper or the inner type
    if (componentTypes.has(fiber.type) || componentTypes.has(getType(fiber.type))) {
      matchedFibers.push(fiber);
    }
  });
  return matchedFibers;
};

const refreshHandlers = new Set<ReactRefreshHandler>();
const refreshWrappedRenderers = new WeakSet<ReactRenderer>();

let pendingFilePaths: string[] = [];
let pendingFilePathsReceivedAtMs = 0;

const bufferHotUpdateFilePaths = (filePaths: string[]): void => {
  const nowMs = Date.now();
  if (nowMs - pendingFilePathsReceivedAtMs > PENDING_HOT_UPDATE_MAX_AGE_MS) {
    pendingFilePaths = [];
  }
  pendingFilePaths.push(...filePaths);
  pendingFilePathsReceivedAtMs = nowMs;
};

const takeFreshFilePaths = (): string[] => {
  if (Date.now() - pendingFilePathsReceivedAtMs > PENDING_HOT_UPDATE_MAX_AGE_MS) return [];
  const freshFilePaths = [...pendingFilePaths];
  // performReactRefresh calls scheduleRefresh synchronously once per
  // mounted root, so clear the pending paths only after the whole
  // refresh pass instead of on the first root
  queueMicrotask(() => {
    pendingFilePaths = [];
  });
  return freshFilePaths;
};

const wrapRendererScheduleRefresh = (renderer: ReactRenderer): void => {
  if (refreshWrappedRenderers.has(renderer)) return;
  const originalScheduleRefresh = renderer.scheduleRefresh;
  if (typeof originalScheduleRefresh !== "function") return;
  refreshWrappedRenderers.add(renderer);
  renderer.scheduleRefresh = (root, update) => {
    originalScheduleRefresh.call(renderer, root, update);
    if (refreshHandlers.size === 0) return;
    const staleComponents = Array.from(update.staleFamilies, (family) => family.current);
    const updatedComponents = Array.from(update.updatedFamilies, (family) => family.current);
    const refreshUpdate: ReactRefreshUpdate = {
      filePaths: takeFreshFilePaths(),
      root,
      staleComponents,
      staleFibers: collectFibersByComponentType(root, new Set(staleComponents)),
      updatedComponents,
      updatedFibers: collectFibersByComponentType(root, new Set(updatedComponents)),
    };
    for (const handler of refreshHandlers) {
      handler(refreshUpdate);
    }
  };
};

let isRefreshWired = false;

const ensureRefreshWired = (): void => {
  if (isRefreshWired) return;
  isRefreshWired = true;
  const rdtHook = getRDTHook();
  for (const renderer of rdtHook.renderers.values()) {
    wrapRendererScheduleRefresh(renderer);
  }
  onRendererInject(wrapRendererScheduleRefresh);
};

let activeTransport: HmrTransport | null = null;

// the bundler's HMR global may not exist yet when an early subscriber
// arrives, so detection is retried whenever the first subscriber (re)appears
const detectTransportForNewSubscriber = (): void => {
  void detectHmrTransport(bufferHotUpdateFilePaths).then((detectedTransport) => {
    if (!detectedTransport) return;
    activeTransport?.dispose();
    activeTransport = detectedTransport;
  });
};

/**
 * Subscribes to react-refresh (fast refresh) updates by wrapping
 * `scheduleRefresh` on every renderer injected into the React DevTools
 * global hook. The react-refresh runtime calls `scheduleRefresh` after each
 * hot update, so this works with any bundler that uses react-refresh (Vite,
 * Next.js webpack, Next.js Turbopack, Metro) without bundler-specific code.
 * Returns an unsubscribe function (a no-op in non-client environments like
 * SSR, so callers never need an environment check). The returned function
 * is also a `Disposable`, so it composes with other bippy subscriptions
 * through `using`.
 *
 * The bundler's HMR transport is auto-detected and each refresh update is
 * augmented with the hot-updated source file paths it reported.
 *
 * The handler runs after React has re-rendered with the new component
 * types, so the refreshed root's fiber tree already carries them;
 * `updatedFibers`/`staleFibers` are the mounted fibers matching the
 * hot-swapped component types.
 *
 * @example
 * ```ts
 * const unsubscribe = instrumentReactRefresh((update) => {
 *   for (const fiber of update.updatedFibers) {
 *     console.log("hot updated:", getDisplayName(fiber.type));
 *   }
 *   console.log("changed files:", update.filePaths);
 * });
 * unsubscribe();
 * ```
 *
 * Pair with `getSource(fiber)` from `bippy/source` to symbolicate the
 * source locations of `updatedFibers` when needed.
 */
export const instrumentReactRefresh = (onRefreshUpdate: ReactRefreshHandler): Unsubscribe => {
  if (!isClientEnvironment()) return toUnsubscribe(() => {});
  ensureRefreshWired();
  if (refreshHandlers.size === 0) {
    detectTransportForNewSubscriber();
  }
  refreshHandlers.add(onRefreshUpdate);
  return toUnsubscribe(() => {
    refreshHandlers.delete(onRefreshUpdate);
  });
};
