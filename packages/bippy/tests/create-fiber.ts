import type { Fiber } from "../src/react-internals/index.js";
import { latestReactWorkTags } from "./react-work-tags.js";

export const createFiber = (overrides: Record<string, unknown> = {}): Fiber => {
  const fiber: Fiber = {
    alternate: null,
    child: null,
    childLanes: 0,
    deletions: null,
    dependencies: null,
    elementType: null,
    firstEffect: null,
    flags: 0,
    index: 0,
    key: null,
    lanes: 0,
    lastEffect: null,
    memoizedProps: {},
    memoizedState: null,
    mode: 0,
    nextEffect: null,
    pendingProps: {},
    ref: null,
    return: null,
    sibling: null,
    stateNode: null,
    subtreeFlags: 0,
    tag: latestReactWorkTags.FunctionComponent,
    type: null,
    updateQueue: null,
  };

  return Object.assign(fiber, overrides);
};
