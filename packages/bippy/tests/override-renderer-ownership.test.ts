import "../src/index.js"; // HACK: Bippy must initialize before imports that load React.

import { expect, it, vi } from "vite-plus/test";
import { overrideHookState, overrideProps } from "../src/index.js";
import type { Fiber, FiberRoot } from "../src/react-internals/index.js";
import { createFiber } from "./create-fiber.js";
import { createRDTHook } from "./create-rdt-hook.js";
import { createReactRenderer } from "./create-react-renderer.js";

interface MockFiberOverrides {
  memoizedState?: unknown;
  return?: Fiber | null;
  stateNode?: unknown;
}

const createMockFiber = (overrides: MockFiberOverrides = {}): Fiber =>
  createFiber({ type: () => null, ...overrides });

const firstOverrideProps = vi.fn();
const secondOverrideProps = vi.fn();
const firstRenderer = createReactRenderer({ overrideProps: firstOverrideProps });
const secondRenderer = createReactRenderer({ overrideProps: secondOverrideProps });

const rdtHook = createRDTHook({
  _instrumentationSource: "test",
  renderers: new Map([
    [1, firstRenderer],
    [2, secondRenderer],
  ]),
});
globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__ = rdtHook;

it("should fan out to every renderer when the fiber's root owner is unknown", () => {
  const orphanFiber = createMockFiber();
  overrideProps(orphanFiber, { count: 1 });
  expect(firstOverrideProps).toHaveBeenCalledWith(orphanFiber, ["count"], 1);
  expect(secondOverrideProps).toHaveBeenCalledWith(orphanFiber, ["count"], 1);
});

it("should route to only the renderer that committed the fiber's root", () => {
  const hostRootFiber = createMockFiber({ memoizedState: { element: {} } });
  const fiberRoot: FiberRoot = { current: hostRootFiber };
  hostRootFiber.stateNode = fiberRoot;
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
