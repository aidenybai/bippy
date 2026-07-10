import "../src/index.js"; // KEEP THIS LINE ON TOP

import { expect, it, vi } from "vitest";
import { overrideHookState, overrideProps } from "../src/index.js";
import type { Fiber, FiberRoot, ReactDevToolsGlobalHook, ReactRenderer } from "../src/types.js";

interface MockFiberOverrides {
  memoizedState?: unknown;
  return?: Fiber | null;
  stateNode?: unknown;
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
    tag: 0,
    type: () => null,
    ...overrides,
  }) as unknown as Fiber;

const firstOverrideProps = vi.fn();
const secondOverrideProps = vi.fn();
const firstRenderer = { overrideProps: firstOverrideProps } as unknown as ReactRenderer;
const secondRenderer = { overrideProps: secondOverrideProps } as unknown as ReactRenderer;

const rdtHook = {
  _instrumentationSource: "test",
  renderers: new Map([
    [1, firstRenderer],
    [2, secondRenderer],
  ]),
} as unknown as ReactDevToolsGlobalHook;
globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__ = rdtHook;

it("should fan out to every renderer when the fiber's root owner is unknown", () => {
  const orphanFiber = createMockFiber();
  overrideProps(orphanFiber, { count: 1 });
  expect(firstOverrideProps).toHaveBeenCalledWith(orphanFiber, ["count"], 1);
  expect(secondOverrideProps).toHaveBeenCalledWith(orphanFiber, ["count"], 1);
});

it("should route to only the renderer that committed the fiber's root", () => {
  const fiberRoot = { current: null } as unknown as FiberRoot;
  const hostRootFiber = createMockFiber({ stateNode: fiberRoot });
  const childFiber = createMockFiber({ return: hostRootFiber });

  rdtHook.onCommitFiberRoot(2, fiberRoot, undefined);

  firstOverrideProps.mockClear();
  secondOverrideProps.mockClear();
  overrideProps(childFiber, { count: 2 });
  expect(firstOverrideProps).not.toHaveBeenCalled();
  expect(secondOverrideProps).toHaveBeenCalledWith(childFiber, ["count"], 2);
});

it("should dispatch whole values through the hook queue when no renderer can override hook state", () => {
  const dispatch = vi.fn();
  const fiber = createMockFiber({ memoizedState: { queue: { dispatch } } });
  overrideHookState(fiber, 0, 7);
  expect(dispatch).toHaveBeenCalledWith(7);
});

it("should not dispatch partial-object writes through the hook queue", () => {
  const dispatch = vi.fn();
  const fiber = createMockFiber({ memoizedState: { queue: { dispatch } } });
  overrideHookState(fiber, 0, { value: 7 });
  expect(dispatch).not.toHaveBeenCalled();
});
