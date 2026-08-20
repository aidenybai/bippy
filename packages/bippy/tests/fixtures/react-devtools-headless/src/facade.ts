import { getRDTHook, instrument, onRendererInject } from "bippy";
import type { FiberRoot, ReactDevToolsTarget, ReactRenderer, Unsubscribe } from "bippy";
import { createUnsubscribe } from "./create-unsubscribe.js";
import { getFiberRootEntries, getRendererForFiber, updateFiberRoot } from "./fiber-roots.js";
import { createRendererActions } from "./renderer-actions.js";
import type { RendererActions } from "./renderer-actions.js";
import type { Facade, ProfilingState } from "./types.js";

const rendererActionsByFacade = new WeakMap<Facade, RendererActions>();

export const getFacadeRendererActions = (facade: Facade): RendererActions => {
  const rendererActions = rendererActionsByFacade.get(facade);
  if (!rendererActions) throw new Error("React DevTools facade is disposed");
  return rendererActions;
};

const addRenderer = (
  rendererInternals: Map<number, ReactRenderer>,
  renderers: Map<number, ReactRenderer>,
  renderer: ReactRenderer,
): void => {
  for (const [rendererId, injectedRenderer] of renderers) {
    if (injectedRenderer === renderer) {
      rendererInternals.set(rendererId, renderer);
      return;
    }
  }
};

const updateFacadeRoots = (
  fiberRoots: Map<number, Set<FiberRoot>>,
  rendererId: number,
  fiberRoot: FiberRoot,
  isMounted: boolean,
): void => {
  for (const [trackedRendererId, roots] of fiberRoots) {
    roots.delete(fiberRoot);
    if (roots.size === 0) fiberRoots.delete(trackedRendererId);
  }
  if (!isMounted) return;
  const rendererRoots = fiberRoots.get(rendererId) ?? new Set<FiberRoot>();
  rendererRoots.add(fiberRoot);
  fiberRoots.set(rendererId, rendererRoots);
};

export const installFacade = (target: ReactDevToolsTarget = globalThis): Facade => {
  const hook = getRDTHook(undefined, target);
  const fiberRoots = new Map<number, Set<FiberRoot>>();
  const rendererInternals = new Map(hook.renderers);
  const listeners = new Set<() => void>();
  let revision = 0;
  const notify = (): void => {
    revision++;
    for (const listener of listeners) listener();
  };
  const profilingState: ProfilingState = {
    currentTraceName: null,
    isActive: false,
    onCommit: null,
    onPostCommit: null,
    traces: new Map(),
  };
  const rendererActions = createRendererActions({
    getRenderer: getRendererForFiber,
    getRendererById: (rendererId) => rendererInternals.get(rendererId) ?? null,
    target,
  });
  const unsubscribers: Unsubscribe[] = [rendererActions.dispose];

  for (const { rendererId, root } of getFiberRootEntries(target)) {
    updateFacadeRoots(fiberRoots, rendererId ?? -1, root, true);
  }

  unsubscribers.push(
    instrument({
      name: "react-devtools-headless",
      onCommitFiberRoot: (rendererId, root, priority) => {
        const renderer = hook.renderers.get(rendererId);
        if (renderer) rendererInternals.set(rendererId, renderer);
        const isMounted = updateFiberRoot(hook, rendererId, root);
        updateFacadeRoots(fiberRoots, rendererId, root, isMounted);
        if (profilingState.isActive) {
          profilingState.onCommit?.(rendererId, root, priority);
        }
        notify();
      },
      onPostCommitFiberRoot: (_rendererId, root) => {
        if (profilingState.isActive) profilingState.onPostCommit?.(root);
        notify();
      },
      target,
    }),
    onRendererInject((renderer) => {
      addRenderer(rendererInternals, hook.renderers, renderer);
      notify();
    }, target),
  );

  const dispose = createUnsubscribe(() => {
    for (const unsubscribe of unsubscribers) unsubscribe();
    unsubscribers.length = 0;
    listeners.clear();
    rendererActionsByFacade.delete(facade);
  });
  const subscribe = (listener: () => void): Unsubscribe => {
    listeners.add(listener);
    return createUnsubscribe(() => listeners.delete(listener));
  };
  const facade: Facade = {
    dispose,
    fiberRoots,
    getRevision: () => revision,
    hook,
    profilingState,
    rendererInternals,
    subscribe,
    target,
  };
  rendererActionsByFacade.set(facade, rendererActions);
  return facade;
};
