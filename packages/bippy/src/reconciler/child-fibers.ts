import {
  ClassComponentTag,
  DeletionFlag,
  FunctionComponentTag,
  HostComponentTag,
  HostPortalTag,
  HostTextTag,
  NoFlags,
  PlacementFlag,
  REACT_CONTEXT_TYPE,
  REACT_PORTAL_TYPE,
  REACT_PROVIDER_TYPE,
  UpdateFlag,
  isComponentFiber,
} from "./constants.js";
import { deletions } from "./scheduler.js";
import type { ReconcilerFiber } from "./types.js";

interface FiberFields {
  tag: number;
  type?: unknown;
  elementType?: unknown;
  key?: React.Key | null;
  ref?: unknown;
  pendingProps?: Record<string, unknown>;
  stateNode?: unknown;
  memoizedState?: unknown;
}

export const createFiber = (fields: FiberFields): ReconcilerFiber => ({
  tag: fields.tag,
  key: fields.key ?? null,
  ref: fields.ref ?? null,
  index: 0,
  type: fields.type ?? null,
  elementType: fields.elementType ?? fields.type ?? null,
  pendingProps: fields.pendingProps ?? {},
  memoizedProps: null,
  memoizedState: fields.memoizedState ?? null,
  stateNode: fields.stateNode ?? null,
  return: null,
  child: null,
  sibling: null,
  alternate: null,
  flags: NoFlags,
  effects: null,
  siblingNode: null,
});

interface ContextLike {
  $$typeof: symbol;
  _context?: unknown;
}

const isClassComponent = (type: unknown): boolean =>
  typeof type === "function" &&
  Boolean((type as { prototype?: { isReactComponent?: unknown } }).prototype?.isReactComponent);

const createFiberFromElement = (element: any): ReconcilerFiber => {
  if (typeof element?.then === "function") element = element.value;

  let { type, props = {}, ref, key } = element ?? {};
  let tag: number;

  if (element?.$$typeof === REACT_PORTAL_TYPE) {
    tag = HostPortalTag;
    props = element;
  } else if (typeof element === "string" || typeof element === "number") {
    type = "";
    tag = HostTextTag;
    props = { text: element };
  } else if (typeof type === "string") {
    tag = HostComponentTag;
  } else if (isClassComponent(type)) {
    tag = ClassComponentTag;
  } else {
    tag = FunctionComponentTag;

    const typeTag = (type as ContextLike | null | undefined)?.$$typeof;
    if (typeTag === REACT_CONTEXT_TYPE || typeTag === REACT_PROVIDER_TYPE) {
      props = { ...props, _context: (type as ContextLike)._context ?? type };
    }

    if (typeof type !== "function") {
      type = type?.render ?? type?.type ?? type?.$$typeof ?? type;
      if (isClassComponent(type)) tag = ClassComponentTag;
    }
  }

  return createFiber({ tag, type, elementType: element?.type, key, ref, pendingProps: props });
};

let shouldTrackSideEffects = false;

const deleteChild = (firstChild: ReconcilerFiber | null, child: ReconcilerFiber): void => {
  if (!shouldTrackSideEffects) return;
  child.flags = DeletionFlag;
  deletions.push(child);

  let prevChild = firstChild;
  let nextChild = firstChild;
  while (nextChild !== null && prevChild !== null) {
    if (nextChild.flags === DeletionFlag) {
      prevChild.sibling = nextChild.sibling;
    }
    prevChild = nextChild;
    nextChild = nextChild.sibling;
  }
};

const createChild = (returnFiber: ReconcilerFiber, newChild: unknown): ReconcilerFiber => {
  const created = createFiberFromElement(newChild);
  created.return = returnFiber;
  return created;
};

const updateElement = (
  workInProgress: ReconcilerFiber,
  oldFiber: ReconcilerFiber | null,
  newChild: any,
): ReconcilerFiber => {
  const isPrimitiveChild = typeof newChild === "string" || typeof newChild === "number";
  const isMatch =
    oldFiber !== null &&
    (isPrimitiveChild
      ? oldFiber.tag === HostTextTag
      : oldFiber.elementType === (newChild?.type ?? null));
  if (oldFiber !== null && isMatch) {
    return {
      ...oldFiber,
      pendingProps: isPrimitiveChild
        ? { text: newChild }
        : (newChild.props ?? oldFiber.pendingProps),
      key: newChild?.key ?? null,
      return: workInProgress,
      flags: UpdateFlag,
      alternate: oldFiber,
    };
  }
  const created = createChild(workInProgress, newChild);
  created.flags = PlacementFlag;
  return created;
};

const placeChild = (
  newFiber: ReconcilerFiber,
  lastPlaceIndex: number,
  newIndex: number,
): number => {
  newFiber.index = newIndex;

  const current = newFiber.alternate;
  if (current !== null) {
    const oldIndex = current.index;
    if (oldIndex < lastPlaceIndex) {
      newFiber.flags = PlacementFlag;
      return lastPlaceIndex;
    }
    return oldIndex;
  }
  newFiber.flags = PlacementFlag;
  return lastPlaceIndex;
};

const setComponentSiblingNodes = (firstChild: ReconcilerFiber | null): void => {
  let current: ReconcilerFiber | null = firstChild;
  while (current !== null) {
    if (isComponentFiber(current)) {
      let siblingNode: unknown = null;
      let nextFiber = current.sibling;
      while (siblingNode === null && nextFiber !== null) {
        if (!isComponentFiber(nextFiber) && nextFiber.flags !== PlacementFlag) {
          siblingNode = nextFiber.stateNode;
        }
        nextFiber = nextFiber.sibling;
      }
      current.siblingNode = siblingNode;
    }
    current = current.sibling;
  }
};

const getChildKey = (child: any, index: number): React.Key => child?.key ?? index;

const reconcileChildrenArray = (
  current: ReconcilerFiber | null,
  workInProgress: ReconcilerFiber,
  newChildren: any[],
): void => {
  let resultingFirstChild: ReconcilerFiber | null = null;
  let previousNewFiber: ReconcilerFiber | null = null;
  let oldChildFiber: ReconcilerFiber | null = current?.child ?? null;
  let nextOldFiber: ReconcilerFiber | null = null;
  let newIndex = 0;
  let lastPlaceIndex = 0;

  for (; oldChildFiber !== null && newIndex < newChildren.length; newIndex++) {
    nextOldFiber = oldChildFiber.sibling;

    const newChild = newChildren[newIndex];
    if ((newChild?.key ?? null) !== oldChildFiber.key) break;
    const newFiber = updateElement(workInProgress, oldChildFiber, newChild);

    if (newFiber.alternate === null) {
      deleteChild(workInProgress.child, oldChildFiber);
    }
    lastPlaceIndex = placeChild(newFiber, lastPlaceIndex, newIndex);
    if (previousNewFiber === null) {
      resultingFirstChild = newFiber;
    } else {
      previousNewFiber.sibling = newFiber;
    }
    previousNewFiber = newFiber;
    oldChildFiber = nextOldFiber;
  }

  if (newIndex === newChildren.length) {
    let childToDelete: ReconcilerFiber | null = oldChildFiber;
    while (childToDelete !== null) {
      deleteChild(workInProgress.child, childToDelete);
      childToDelete = childToDelete.sibling;
    }
  } else {
    const existingChildren = new Map<React.Key, ReconcilerFiber>();

    let existingChild: ReconcilerFiber | null = oldChildFiber;
    while (existingChild !== null) {
      existingChildren.set(existingChild.key ?? existingChild.index, existingChild);
      existingChild = existingChild.sibling;
    }

    for (; newIndex < newChildren.length; newIndex++) {
      const newChild = newChildren[newIndex];
      const matchedFiber = existingChildren.get(getChildKey(newChild, newIndex)) ?? null;
      const newFiber = updateElement(workInProgress, matchedFiber, newChild);
      if (newFiber.alternate !== null) {
        existingChildren.delete(getChildKey(newChild, newIndex));
      }

      lastPlaceIndex = placeChild(newFiber, lastPlaceIndex, newIndex);
      if (previousNewFiber === null) {
        resultingFirstChild = newFiber;
      } else {
        previousNewFiber.sibling = newFiber;
      }
      previousNewFiber = newFiber;
    }
    for (const [, child] of existingChildren) deleteChild(resultingFirstChild, child);
  }

  if (previousNewFiber !== null) previousNewFiber.sibling = null;
  setComponentSiblingNodes(resultingFirstChild);
  workInProgress.child = resultingFirstChild;
};

const flattenChildren = (newChildren: unknown): unknown[] =>
  (Array.isArray(newChildren) ? newChildren.flat(Number.POSITIVE_INFINITY) : [newChildren]).filter(
    (child) => child !== null && child !== undefined && typeof child !== "boolean",
  );

export const reconcileChildFibers = (
  current: ReconcilerFiber | null,
  workInProgress: ReconcilerFiber,
  newChildren: unknown,
): void => {
  shouldTrackSideEffects = true;
  reconcileChildrenArray(current, workInProgress, flattenChildren(newChildren));
};

export const mountChildFibers = (
  current: ReconcilerFiber | null,
  workInProgress: ReconcilerFiber,
  newChildren: unknown,
): void => {
  shouldTrackSideEffects = false;
  reconcileChildrenArray(current, workInProgress, flattenChildren(newChildren));
};
