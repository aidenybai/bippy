import { getReactWorkTags, type Fiber } from "bippy";

interface FiberOverrides extends Partial<Omit<Fiber, "tag">> {
  tag?: number;
}

export const createFiber = (overrides: FiberOverrides = {}): Fiber => ({
  key: null,
  elementType: null,
  type: null,
  stateNode: null,
  return: null,
  child: null,
  sibling: null,
  index: 0,
  ref: null,
  pendingProps: {},
  memoizedProps: {},
  updateQueue: null,
  memoizedState: null,
  dependencies: null,
  mode: 0,
  flags: 1,
  subtreeFlags: 0,
  deletions: null,
  nextEffect: null,
  firstEffect: null,
  lastEffect: null,
  lanes: 0,
  childLanes: 0,
  alternate: null,
  ...overrides,
  tag: (overrides.tag ?? getReactWorkTags().FunctionComponent) as Fiber["tag"],
});

export const linkChildren = (parent: Fiber, children: Fiber[]): void => {
  parent.child = children[0] ?? null;
  children.forEach((child, index) => {
    child.return = parent;
    child.sibling = children[index + 1] ?? null;
  });
};
