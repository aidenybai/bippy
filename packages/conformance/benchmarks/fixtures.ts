import type { Fiber, FiberRoot } from "bippy";
import { getReactWorkTags } from "../../bippy/src/react-internals/generated/react-work-tags.js";
import { createFiber, linkChildren } from "../tests/fiber-fixture.js";

export { createFiber, linkChildren } from "../tests/fiber-fixture.js";

export interface FiberTree {
  root: FiberRoot;
  fibers: Fiber[];
}

export const Component = (): null => null;

export const createTree = (size: number, shape: "deep" | "wide"): FiberTree => {
  const root: FiberRoot = {
    current: createFiber({
      tag: getReactWorkTags().HostRoot,
      memoizedState: { element: {}, memoizedState: null, next: null },
    }),
  };
  root.current.stateNode = root;
  const fibers: Fiber[] = [];
  let parent = root.current;
  for (let index = 0; index < size; index++) {
    const fiber = createFiber({ type: Component, elementType: Component, return: parent });
    if (shape === "deep") {
      parent.child = fiber;
      parent = fiber;
    }
    fibers.push(fiber);
  }
  if (shape === "wide") linkChildren(root.current, fibers);
  return { root, fibers };
};

export const pairTrees = (previousTree: FiberTree, nextTree: FiberTree): void => {
  previousTree.root.current.alternate = nextTree.root.current;
  nextTree.root.current.alternate = previousTree.root.current;
  previousTree.fibers.forEach((fiber, index) => {
    fiber.alternate = nextTree.fibers[index];
    nextTree.fibers[index].alternate = fiber;
  });
  previousTree.root.current.stateNode = nextTree.root;
  nextTree.root.current.stateNode = nextTree.root;
};

export const createDebugStack = (depth = 1): Error => {
  const error = new Error("react-stack-top-frame");
  error.stack = [
    "Error: react-stack-top-frame",
    "    at jsx (https://bench.example/jsx.js:1:1)",
    ...Array.from(
      { length: depth },
      (_, index) => `    at Component${index} (https://bench.example/bundle.js:1:1)`,
    ),
    "    at react-stack-bottom-frame (https://bench.example/react.js:1:1)",
  ].join("\n");
  return error;
};
