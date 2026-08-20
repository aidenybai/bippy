import { getRDTHook, hasRDTHook, isFiberRootUnmounted, setReactWorkTagsForFiber } from "bippy";
import type {
  Fiber,
  FiberRoot,
  ReactDevToolsGlobalHook,
  ReactDevToolsTarget,
  ReactRenderer,
} from "bippy";

export interface FiberRootEntry {
  rendererId: number | null;
  root: FiberRoot;
}

const fiberRoots = new Set<FiberRoot>();
const rootRendererIds = new WeakMap<FiberRoot, number>();
const rootHooks = new WeakMap<FiberRoot, ReactDevToolsGlobalHook>();

const isFiberRoot = (value: unknown): value is FiberRoot =>
  typeof value === "object" &&
  value !== null &&
  "current" in value &&
  typeof value.current === "object" &&
  value.current !== null;

export const getFiberRoot = (fiber: Fiber): FiberRoot | null => {
  let rootFiber = fiber;
  while (rootFiber.return) rootFiber = rootFiber.return;
  return isFiberRoot(rootFiber.stateNode) ? rootFiber.stateNode : null;
};

export const getRendererIdForFiberRoot = (fiberRoot: FiberRoot): number | null => {
  const trackedRendererId = rootRendererIds.get(fiberRoot);
  if (trackedRendererId !== undefined) return trackedRendererId;
  if (!hasRDTHook()) return null;

  const hook = getRDTHook();
  if (!hook.getFiberRoots) return null;
  for (const [rendererId, renderer] of hook.renderers) {
    if (!hook.getFiberRoots(rendererId).has(fiberRoot)) continue;
    fiberRoots.add(fiberRoot);
    rootHooks.set(fiberRoot, hook);
    rootRendererIds.set(fiberRoot, rendererId);
    setReactWorkTagsForFiber(fiberRoot.current, renderer);
    return rendererId;
  }
  return null;
};

export const getRendererIdForFiber = (fiber: Fiber): number | null => {
  const fiberRoot = getFiberRoot(fiber);
  return fiberRoot ? getRendererIdForFiberRoot(fiberRoot) : null;
};

export const getFiberRootEntries = (target: ReactDevToolsTarget = globalThis): FiberRootEntry[] => {
  const targetHook = hasRDTHook(target) ? getRDTHook(undefined, target) : null;
  if (targetHook?.getFiberRoots) {
    for (const [rendererId, renderer] of targetHook.renderers) {
      for (const fiberRoot of targetHook.getFiberRoots(rendererId)) {
        fiberRoots.add(fiberRoot);
        rootHooks.set(fiberRoot, targetHook);
        rootRendererIds.set(fiberRoot, rendererId);
        setReactWorkTagsForFiber(fiberRoot.current, renderer);
      }
    }
  }

  return Array.from(fiberRoots)
    .filter((fiberRoot) => targetHook === null || rootHooks.get(fiberRoot) === targetHook)
    .map((fiberRoot) => ({
      rendererId: rootRendererIds.get(fiberRoot) ?? null,
      root: fiberRoot,
    }));
};

export const updateFiberRoot = (
  hook: ReactDevToolsGlobalHook,
  rendererId: number,
  fiberRoot: FiberRoot,
): boolean => {
  if (isFiberRootUnmounted(fiberRoot)) {
    fiberRoots.delete(fiberRoot);
    rootHooks.delete(fiberRoot);
    rootRendererIds.delete(fiberRoot);
    return false;
  }

  fiberRoots.add(fiberRoot);
  rootHooks.set(fiberRoot, hook);
  rootRendererIds.set(fiberRoot, rendererId);
  setReactWorkTagsForFiber(fiberRoot.current, hook.renderers.get(rendererId));
  return true;
};

export const getRendererForFiber = (fiber: Fiber): ReactRenderer | null => {
  const fiberRoot = getFiberRoot(fiber);
  if (!fiberRoot) return null;
  const rendererId = getRendererIdForFiberRoot(fiberRoot);
  if (rendererId === null) return null;
  const hook = rootHooks.get(fiberRoot) ?? (hasRDTHook() ? getRDTHook() : null);
  return hook?.renderers.get(rendererId) ?? null;
};
