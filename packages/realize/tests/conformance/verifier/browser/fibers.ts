import { didFiberRender, traverseFiber } from "bippy";
import type { Fiber, FiberRoot, MemoizedState } from "bippy";

export const MAX_CAPTURED_FIBERS = 10_000;

let latestRoot: FiberRoot | null = null;
let mountedType: unknown = null;
let lastCommittedFiber: Fiber | null = null;
let renderCount = 0;

export const getMountedType = (): unknown => mountedType;

export const setMountedType = (type: unknown): void => {
  mountedType = type;
};

export const getRenderCount = (): number => renderCount;

export const resetCommitTracking = (): void => {
  lastCommittedFiber = null;
};

export const getChildren = (fiber: Fiber): Fiber[] => {
  const children: Fiber[] = [];
  for (let child = fiber.child; child; child = child.sibling) children.push(child);
  return children;
};

export const findMountedFiber = (): Fiber | null => {
  let fiber = traverseFiber(
    latestRoot?.current ?? null,
    (candidate) => candidate.elementType === mountedType || candidate.type === mountedType,
  );
  while (fiber?.child && fiber.child.elementType === Reflect.get(Object(fiber.type), "type"))
    fiber = fiber.child;
  return fiber;
};

export const recordCommit = (root: FiberRoot): Fiber | null => {
  latestRoot = root;
  const fiber = findMountedFiber();
  if (fiber && fiber !== lastCommittedFiber && didFiberRender(fiber)) renderCount++;
  lastCommittedFiber = fiber;
  return fiber;
};

export const hasTooManyFibers = (fiber: Fiber): boolean => {
  let count = 0;
  const pending = [...getChildren(fiber)];
  for (let current = pending.pop(); current; current = pending.pop()) {
    if (++count > MAX_CAPTURED_FIBERS) return true;
    pending.push(...getChildren(current));
  }
  return false;
};

export const getQueuedHooks = (fiber: Fiber): MemoizedState[] => {
  const hooks: MemoizedState[] = [];
  for (
    let hook = fiber.memoizedState;
    hook && typeof hook === "object" && "next" in hook;
    hook = hook.next
  ) {
    if (hook.queue) hooks.push(hook);
  }
  return hooks;
};

const isMountedType = (type: unknown): boolean =>
  type !== null &&
  (type === mountedType ||
    type === Reflect.get(Object(mountedType), "type") ||
    type === Reflect.get(Object(mountedType), "render"));

export const isRenderedByChild = (fiber: Fiber): boolean => {
  const owner: unknown = Reflect.get(fiber, "_debugOwner");
  const ownerType: unknown = owner && typeof owner === "object" ? Reflect.get(owner, "type") : null;
  return ownerType !== null && ownerType !== undefined && !isMountedType(ownerType);
};

const getLanes = (root: FiberRoot, key: string): number => {
  const lanes: unknown = Reflect.get(root, key);
  return typeof lanes === "number" ? lanes : 0;
};

export const hasSuspendedReactWork = (): boolean =>
  latestRoot !== null && getLanes(latestRoot, "suspendedLanes") !== 0;

export const hasPendingReactWork = (): boolean => {
  if (!latestRoot) return false;
  const warmLanes = "warmLanes" in latestRoot ? getLanes(latestRoot, "warmLanes") : ~0;
  const blockedLanes =
    getLanes(latestRoot, "suspendedLanes") & ~getLanes(latestRoot, "pingedLanes") & warmLanes;
  return (getLanes(latestRoot, "pendingLanes") & ~blockedLanes) !== 0;
};
