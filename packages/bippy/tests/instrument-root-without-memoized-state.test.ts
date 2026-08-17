import "../src/index.js"; // KEEP THIS LINE ON TOP

import { expect, it, vi } from "vite-plus/test";
import { _fiberRoots, getRDTHook, instrument } from "../src/index.js";
import type { Fiber, FiberRoot } from "../src/react-internals/index.js";
import { latestReactWorkTags } from "./react-work-tags.js";

const createMockFiber = (overrides: Partial<Fiber> = {}): Fiber =>
  ({
    alternate: null,
    child: null,
    flags: 0,
    memoizedProps: {},
    memoizedState: undefined,
    pendingProps: {},
    ref: null,
    return: null,
    sibling: null,
    stateNode: null,
    subtreeFlags: 0,
    tag: latestReactWorkTags.HostRoot,
    type: null,
    ...overrides,
  }) as unknown as Fiber;

it("tracks committed roots without memoizedState instead of crashing", () => {
  const onCommitFiberRoot = vi.fn();
  const unsubscribe = instrument({ onCommitFiberRoot });
  const rdtHook = getRDTHook();

  const childFiber = createMockFiber({ tag: latestReactWorkTags.FunctionComponent });
  const rootFiber = createMockFiber({ child: childFiber });
  childFiber.return = rootFiber;
  const root: FiberRoot = { current: rootFiber };

  expect(() => rdtHook.onCommitFiberRoot(1, root, undefined, false)).not.toThrow();
  expect(onCommitFiberRoot).toHaveBeenCalledWith(1, root, undefined, false);
  expect(_fiberRoots.has(root)).toBe(true);

  unsubscribe();
});

it("keeps childless roots without memoizedState tracked", () => {
  const unsubscribe = instrument({});
  const rdtHook = getRDTHook();
  const root: FiberRoot = { current: createMockFiber() };

  expect(() => rdtHook.onCommitFiberRoot(1, root, undefined, false)).not.toThrow();
  expect(_fiberRoots.has(root)).toBe(true);

  unsubscribe();
});

it("untracks roots whose memoizedState element is cleared", () => {
  const unsubscribe = instrument({});
  const rdtHook = getRDTHook();
  const root: FiberRoot = { current: createMockFiber({ memoizedState: { element: {} } }) };

  rdtHook.onCommitFiberRoot(1, root, undefined, false);
  expect(_fiberRoots.has(root)).toBe(true);

  root.current = createMockFiber({ memoizedState: { element: null } });
  rdtHook.onCommitFiberRoot(1, root, undefined, false);
  expect(_fiberRoots.has(root)).toBe(false);

  unsubscribe();
});
