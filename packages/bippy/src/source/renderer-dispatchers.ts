import type { RendererDispatcherRef } from "../react-internals/index.js";
import { _renderers, getRDTHook } from "../rdt-hook.js";

export const getRendererDispatcherRefs = (): RendererDispatcherRef[] => {
  const rdtHook = getRDTHook();
  const renderers = new Set([..._renderers, ...rdtHook.renderers.values()]);
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
