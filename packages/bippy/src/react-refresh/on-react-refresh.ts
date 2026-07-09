import { getRDTHook, isClientEnvironment } from "../rdt-hook.js";
import type { ReactRenderer } from "../types.js";
import { ReactRefreshListener, ReactRefreshUpdateHandler } from "./types.js";

/**
 * Subscribes to react-refresh (fast refresh) updates by wrapping
 * `scheduleRefresh` on every injected renderer. The react-refresh runtime
 * calls `scheduleRefresh(root, update)` through the React DevTools global
 * hook after each hot update, so this works with any bundler that uses
 * react-refresh (Vite, Next.js webpack, Next.js Turbopack, Metro) without
 * bundler-specific transports. Returns `null` in non-browser environments.
 *
 * The handler receives the refresh update after React has re-rendered:
 * `updatedFamilies` are components that re-rendered preserving state, and
 * `staleFamilies` are components that were remounted. Each family's
 * `current` is the new component type.
 *
 * @example
 * ```ts
 * const listener = onReactRefresh((update) => {
 *   for (const family of update.updatedFamilies) {
 *     console.log("hot updated:", getDisplayName(family.current));
 *   }
 * });
 * listener?.dispose();
 * ```
 */
export const onReactRefresh = (
  onRefreshUpdate: ReactRefreshUpdateHandler,
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
      if (!isDisposed) onRefreshUpdate(update, root);
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
