import "../../../bippy/src/index.js"; // KEEP THIS LINE ON TOP

import { expect, it } from "vite-plus/test";
import { getRDTHook, getRenderer, instrument } from "../../../bippy/src/index.js";
import type { ReactDevToolsTarget } from "../../../bippy/src/index.js";
import type { Fiber, FiberRoot, ReactRenderer } from "../../../bippy/src/react-internals/index.js";
import { latestReactWorkTags } from "./react-work-tags.js";

interface MockFiberOverrides {
  memoizedState?: unknown;
  return?: Fiber | null;
  stateNode?: unknown;
  tag?: Fiber["tag"];
}

const createMockFiber = (overrides: MockFiberOverrides = {}): Fiber =>
  ({
    alternate: null,
    child: null,
    flags: 0,
    memoizedProps: {},
    memoizedState: null,
    pendingProps: {},
    return: null,
    sibling: null,
    stateNode: null,
    tag: latestReactWorkTags.FunctionComponent,
    type: () => null,
    ...overrides,
  }) as unknown as Fiber;

const firstRenderer = { rendererPackageName: "first" } as unknown as ReactRenderer;
const secondRenderer = { rendererPackageName: "second" } as unknown as ReactRenderer;
const rdtHook = getRDTHook();
rdtHook.renderers.set(1, firstRenderer);
rdtHook.renderers.set(2, secondRenderer);
instrument({});

const createFiberTree = (): { childFiber: Fiber; fiberRoot: FiberRoot } => {
  const rootFiber = createMockFiber({
    memoizedState: { element: {} },
    tag: latestReactWorkTags.HostRoot,
  });
  const fiberRoot: FiberRoot = { current: rootFiber };
  rootFiber.stateNode = fiberRoot;
  return {
    childFiber: createMockFiber({ return: rootFiber }),
    fiberRoot,
  };
};

it("returns null before the fiber root has been observed", () => {
  const { childFiber } = createFiberTree();
  expect(getRenderer(childFiber)).toBeNull();
});

it("returns the renderer that committed the fiber root", () => {
  const { childFiber, fiberRoot } = createFiberTree();
  rdtHook.onCommitFiberRoot(2, fiberRoot, undefined);
  expect(getRenderer(childFiber)).toBe(secondRenderer);
});

it("backfills the renderer from an explicit target", () => {
  const target: ReactDevToolsTarget = {};
  const targetHook = getRDTHook(undefined, target);
  const { childFiber, fiberRoot } = createFiberTree();
  targetHook.renderers.set(2, secondRenderer);
  targetHook.getFiberRoots = () => new Set([fiberRoot]);
  try {
    expect(getRenderer(childFiber, target)).toBe(secondRenderer);
  } finally {
    Reflect.set(fiberRoot.current, "memoizedState", { element: null });
    targetHook.onCommitFiberRoot(2, fiberRoot, undefined);
  }
});

it("returns null when the renderer is no longer registered", () => {
  const { childFiber, fiberRoot } = createFiberTree();
  rdtHook.onCommitFiberRoot(1, fiberRoot, undefined);
  rdtHook.renderers.delete(1);
  expect(getRenderer(childFiber)).toBeNull();
  rdtHook.renderers.set(1, firstRenderer);
});

it("returns null for a fiber without a fiber root", () => {
  expect(getRenderer(createMockFiber())).toBeNull();
});
