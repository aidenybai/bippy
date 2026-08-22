import "../src/index.js";

import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { installFacade } from "../src/facade.js";
import {
  getFiberRoot,
  getFiberRootEntries,
  getRendererForFiber,
  getRendererIdForFiber,
  getRendererIdForFiberRoot,
  updateFiberRoot,
} from "../src/fiber-roots.js";
import type { Fiber, FiberRoot, ReactDevToolsTarget } from "bippy";
import type { Facade } from "../src/types.js";

let facade: Facade;
let rendererId: number;
let root: FiberRoot;

const createRoot = (template: Fiber): FiberRoot => {
  const fiberRoot: FiberRoot = { current: template };
  const rootFiber: Fiber = {
    ...template,
    alternate: null,
    child: null,
    return: null,
    sibling: null,
    stateNode: fiberRoot,
  };
  Reflect.set(rootFiber, "memoizedState", { element: {} });
  fiberRoot.current = rootFiber;
  return fiberRoot;
};

beforeEach(() => {
  facade = installFacade();
  const App = () => <div />;
  render(<App />);
  const entry = facade.fiberRoots.entries().next().value;
  if (!entry) throw new Error("Missing renderer root");
  [rendererId] = entry;
  const currentRoot = entry[1].values().next().value;
  if (!currentRoot) throw new Error("Missing root");
  root = currentRoot;
});

afterEach(() => {
  cleanup();
  facade.dispose();
});

describe("upstream Fiber root bookkeeping", () => {
  it("discovers untracked roots through the DevTools hook", () => {
    const discoveredRoot = createRoot(root.current);
    const previousGetFiberRoots = facade.hook.getFiberRoots;
    facade.hook.getFiberRoots = (candidateRendererId) =>
      candidateRendererId === rendererId ? new Set([discoveredRoot]) : new Set();

    expect(getRendererIdForFiberRoot(discoveredRoot)).toBe(rendererId);
    expect(getRendererIdForFiber(discoveredRoot.current)).toBe(rendererId);
    expect(getRendererForFiber(discoveredRoot.current)).toBe(
      facade.rendererInternals.get(rendererId),
    );

    discoveredRoot.current.memoizedState = null;
    expect(updateFiberRoot(facade.hook, rendererId, discoveredRoot)).toBe(false);
    facade.hook.getFiberRoots = previousGetFiberRoots;
  });

  it("backfills root entries for an explicit target", () => {
    const target: ReactDevToolsTarget = {};
    const localFacade = installFacade(target);
    const renderer = facade.rendererInternals.get(rendererId);
    if (!renderer) throw new Error("Missing renderer");
    const localRendererId = localFacade.hook.inject(renderer);
    const discoveredRoot = createRoot(root.current);
    localFacade.hook.getFiberRoots = (candidateRendererId) =>
      candidateRendererId === localRendererId ? new Set([discoveredRoot]) : new Set();

    expect(getFiberRootEntries(target)).toContainEqual({
      rendererId: localRendererId,
      root: discoveredRoot,
    });
    discoveredRoot.current.memoizedState = null;
    updateFiberRoot(localFacade.hook, localRendererId, discoveredRoot);
    localFacade.dispose();
  });

  it("prunes tracked roots when the owning facade is disposed", () => {
    const target: ReactDevToolsTarget = {};
    const localFacade = installFacade(target);
    const renderer = facade.rendererInternals.get(rendererId);
    if (!renderer) throw new Error("Missing renderer");
    const localRendererId = localFacade.hook.inject(renderer);
    const trackedRoot = createRoot(root.current);
    localFacade.hook.getFiberRoots = (candidateRendererId) =>
      candidateRendererId === localRendererId ? new Set([trackedRoot]) : new Set();

    expect(getFiberRootEntries(target)).toContainEqual({
      rendererId: localRendererId,
      root: trackedRoot,
    });

    localFacade.dispose();
    localFacade.hook.getFiberRoots = () => new Set();
    expect(getFiberRootEntries(target)).toEqual([]);
  });

  it("rejects detached Fibers and supports targets without hooks", () => {
    const detachedFiber: Fiber = {
      ...root.current,
      alternate: null,
      child: null,
      return: null,
      sibling: null,
      stateNode: null,
    };
    expect(getFiberRoot(detachedFiber)).toBeNull();
    expect(getRendererIdForFiber(detachedFiber)).toBeNull();
    expect(getRendererForFiber(detachedFiber)).toBeNull();
    expect(getFiberRootEntries({})).toEqual(expect.any(Array));
  });
});
