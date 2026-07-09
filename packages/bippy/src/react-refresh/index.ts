import { getRDTHook, isClientEnvironment } from "../rdt-hook.js";
import type { FiberRoot, ReactRenderer } from "../types.js";
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
  /** new component types that re-rendered preserving state */
  updatedComponents: unknown[];
}

export interface ReactRefreshHandler {
  (update: ReactRefreshUpdate): void;
}

export interface ReactRefreshListener {
  dispose: () => void;
}

/**
 * Subscribes to react-refresh (fast refresh) updates by wrapping
 * `scheduleRefresh` on every renderer injected into the React DevTools
 * global hook. The react-refresh runtime calls `scheduleRefresh` after each
 * hot update, so this works with any bundler that uses react-refresh (Vite,
 * Next.js webpack, Next.js Turbopack, Metro) without bundler-specific code.
 * Returns `null` in non-client environments (e.g. SSR).
 *
 * The bundler's HMR transport is auto-detected and each refresh update is
 * augmented with the hot-updated source file paths it reported.
 *
 * The handler runs after React has re-rendered with the new component
 * types.
 *
 * @example
 * ```ts
 * const listener = onReactRefresh((update) => {
 *   for (const componentType of update.updatedComponents) {
 *     console.log("hot updated:", getDisplayName(componentType));
 *   }
 *   console.log("changed files:", update.filePaths);
 * });
 * listener?.dispose();
 * ```
 */
export const onReactRefresh = (
  onRefreshUpdate: ReactRefreshHandler,
): ReactRefreshListener | null => {
  if (!isClientEnvironment()) return null;

  const restoreCallbacks: (() => void)[] = [];
  let isDisposed = false;

  let pendingFilePaths: string[] = [];
  let pendingFilePathsReceivedAtMs = 0;
  let transport: HmrTransport | null = null;

  void detectHmrTransport((filePaths) => {
    const nowMs = Date.now();
    if (nowMs - pendingFilePathsReceivedAtMs > PENDING_HOT_UPDATE_MAX_AGE_MS) {
      pendingFilePaths = [];
    }
    pendingFilePaths.push(...filePaths);
    pendingFilePathsReceivedAtMs = nowMs;
  }).then((detectedTransport) => {
    if (isDisposed) {
      detectedTransport?.dispose();
      return;
    }
    transport = detectedTransport;
  });

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

  const patchRenderer = (renderer: ReactRenderer) => {
    const originalScheduleRefresh = renderer.scheduleRefresh;
    if (typeof originalScheduleRefresh !== "function") return;
    const wrappedScheduleRefresh: NonNullable<ReactRenderer["scheduleRefresh"]> = (
      root,
      update,
    ) => {
      originalScheduleRefresh.call(renderer, root, update);
      if (isDisposed) return;
      onRefreshUpdate({
        filePaths: takeFreshFilePaths(),
        root,
        staleComponents: Array.from(update.staleFamilies, (family) => family.current),
        updatedComponents: Array.from(update.updatedFamilies, (family) => family.current),
      });
    };
    renderer.scheduleRefresh = wrappedScheduleRefresh;
    restoreCallbacks.push(() => {
      if (renderer.scheduleRefresh === wrappedScheduleRefresh) {
        renderer.scheduleRefresh = originalScheduleRefresh;
      }
    });
  };

  const rdtHook = getRDTHook();
  for (const renderer of rdtHook.renderers.values()) {
    patchRenderer(renderer);
  }

  const previousInject = rdtHook.inject;
  const wrappedInject = (renderer: ReactRenderer) => {
    const rendererId = previousInject.call(rdtHook, renderer);
    patchRenderer(renderer);
    return rendererId;
  };
  rdtHook.inject = wrappedInject;
  restoreCallbacks.push(() => {
    if (rdtHook.inject === wrappedInject) {
      rdtHook.inject = previousInject;
    }
  });

  return {
    dispose: () => {
      isDisposed = true;
      transport?.dispose();
      for (const restoreCallback of restoreCallbacks) {
        restoreCallback();
      }
    },
  };
};
