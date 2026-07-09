import { getRDTHook, isClientEnvironment } from "../rdt-hook.js";
import type { FiberRoot, ReactRenderer } from "../types.js";

export interface ReactRefreshUpdate {
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
 * The handler runs after React has re-rendered with the new component
 * types.
 *
 * @example
 * ```ts
 * const listener = onReactRefresh((update) => {
 *   for (const componentType of update.updatedComponents) {
 *     console.log("hot updated:", getDisplayName(componentType));
 *   }
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
      for (const restoreCallback of restoreCallbacks) {
        restoreCallback();
      }
    },
  };
};
