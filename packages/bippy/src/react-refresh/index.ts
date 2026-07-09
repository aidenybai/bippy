import { getType, traverseFiber } from "../core.js";
import { getRDTHook, isClientEnvironment } from "../rdt-hook.js";
import { getSource } from "../source/get-source.js";
import { FiberSource } from "../source/types.js";
import type { Fiber, FiberRoot, ReactRenderer } from "../types.js";
import { PENDING_HOT_UPDATE_MAX_AGE_MS } from "./constants.js";
import { detectHmrTransport } from "./detect-hmr-transport.js";
import { HmrTransport } from "./types.js";

export interface ReactRefreshSources {
  /** source locations of `staleFibers`, aligned by index */
  staleSources: (FiberSource | null)[];
  /** source locations of `updatedFibers`, aligned by index */
  updatedSources: (FiberSource | null)[];
}

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
  /**
   * symbolicates the source locations (file, line, column) of
   * `updatedFibers`/`staleFibers` through source maps on demand. Lazy
   * because it fetches and decodes source maps; results are cached.
   * Best-effort: entries are null for components the stack-sampling
   * strategy cannot locate (e.g. hook-less components without props).
   */
  getSources: () => Promise<ReactRefreshSources>;
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

export interface ReactRefreshListener {
  dispose: () => void;
}

const resolveFiberSources = (fibers: Fiber[]): Promise<(FiberSource | null)[]> =>
  Promise.all(fibers.map((fiber) => getSource(fiber)));

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
 * types, so the refreshed root's fiber tree already carries them;
 * `updatedFibers`/`staleFibers` are the mounted fibers matching the
 * hot-swapped component types.
 *
 * @example
 * ```ts
 * const listener = onReactRefresh(async (update) => {
 *   for (const fiber of update.updatedFibers) {
 *     console.log("hot updated:", getDisplayName(fiber.type));
 *   }
 *   console.log("changed files:", update.filePaths);
 *   const { updatedSources } = await update.getSources();
 *   console.log("rendered at:", updatedSources[0]?.fileName);
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
      const staleComponents = Array.from(update.staleFamilies, (family) => family.current);
      const updatedComponents = Array.from(update.updatedFamilies, (family) => family.current);
      const staleFibers = collectFibersByComponentType(root, new Set(staleComponents));
      const updatedFibers = collectFibersByComponentType(root, new Set(updatedComponents));
      onRefreshUpdate({
        filePaths: takeFreshFilePaths(),
        getSources: async () => ({
          staleSources: await resolveFiberSources(staleFibers),
          updatedSources: await resolveFiberSources(updatedFibers),
        }),
        root,
        staleComponents,
        staleFibers,
        updatedComponents,
        updatedFibers,
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
