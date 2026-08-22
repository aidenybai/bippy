import type { RendererDispatcherRef } from "../react-internals/index.js";
import { _renderers, getRDTHook, isRendererMap } from "../rdt-hook.js";
import type { ReactDevToolsTarget } from "../rdt-hook.js";

export const getRendererDispatcherRefs = (
  target: ReactDevToolsTarget = globalThis,
): RendererDispatcherRef[] => {
  const rdtHook = getRDTHook(undefined, target);
  const targetRenderers = isRendererMap(rdtHook.renderers) ? rdtHook.renderers.values() : [];
  const renderers =
    target === globalThis ? new Set([..._renderers, ...targetRenderers]) : new Set(targetRenderers);
  const currentDispatcherRefs: RendererDispatcherRef[] = [];
  const seenCurrentDispatcherRefs = new Set<object>();
  for (const renderer of renderers) {
    const currentDispatcherRef = renderer.currentDispatcherRef;
    if (!currentDispatcherRef || seenCurrentDispatcherRefs.has(currentDispatcherRef)) continue;
    seenCurrentDispatcherRefs.add(currentDispatcherRef);
    currentDispatcherRefs.push(currentDispatcherRef);
  }
  return currentDispatcherRefs;
};

export const readDispatcher = (currentDispatcherRef: RendererDispatcherRef): unknown =>
  "H" in currentDispatcherRef ? currentDispatcherRef.H : currentDispatcherRef.current;

export const writeDispatcher = (
  currentDispatcherRef: RendererDispatcherRef,
  dispatcher: unknown,
): void => {
  if ("H" in currentDispatcherRef) {
    currentDispatcherRef.H = dispatcher;
  } else {
    currentDispatcherRef.current = dispatcher;
  }
};
