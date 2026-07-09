import { describe, expect, it, vi } from "vitest";
import {
  FragmentTag,
  FunctionComponentTag,
  HostRootTag,
  mountFiberRecursively,
  OffscreenComponentTag,
  SuspenseComponentTag,
  traverseRenderedFibers,
  unmountFiber,
  unmountFiberChildrenRecursively,
  updateFiberRecursively,
} from "../index.js";
import type { Fiber, FiberRoot } from "../types.js";

const PERFORMED_WORK_FLAG = 0b1;

interface MockFiberOverrides {
  alternate?: Fiber | null;
  child?: Fiber | null;
  flags?: number;
  memoizedState?: unknown;
  return?: Fiber | null;
  sibling?: Fiber | null;
  tag?: number;
  type?: unknown;
}

const createMockFiber = (overrides: MockFiberOverrides = {}): Fiber =>
  ({
    alternate: null,
    child: null,
    dependencies: null,
    flags: PERFORMED_WORK_FLAG,
    memoizedProps: {},
    memoizedState: null,
    pendingProps: {},
    ref: null,
    return: null,
    sibling: null,
    stateNode: null,
    subtreeFlags: 0,
    tag: FunctionComponentTag,
    type: () => null,
    ...overrides,
  }) as unknown as Fiber;

describe("mountFiberRecursively", () => {
  it("should mount children and siblings", () => {
    const childFiber = createMockFiber();
    const siblingFiber = createMockFiber();
    const firstFiber = createMockFiber({ child: childFiber, sibling: siblingFiber });
    const onRender = vi.fn();
    mountFiberRecursively(onRender, firstFiber, true);
    expect(onRender).toHaveBeenCalledWith(firstFiber, "mount");
    expect(onRender).toHaveBeenCalledWith(childFiber, "mount");
    expect(onRender).toHaveBeenCalledWith(siblingFiber, "mount");
  });

  it("should mount the fallback child of a timed-out suspense fiber", () => {
    const fallbackChild = createMockFiber();
    const fallbackFragment = createMockFiber({ child: fallbackChild, tag: FragmentTag });
    const primaryFragment = createMockFiber({
      sibling: fallbackFragment,
      tag: OffscreenComponentTag,
    });
    const suspenseFiber = createMockFiber({
      child: primaryFragment,
      memoizedState: {},
      tag: SuspenseComponentTag,
    });
    const onRender = vi.fn();
    mountFiberRecursively(onRender, suspenseFiber, false);
    expect(onRender).toHaveBeenCalledWith(suspenseFiber, "mount");
    expect(onRender).toHaveBeenCalledWith(fallbackChild, "mount");
  });

  it("should handle a timed-out suspense fiber with no fallback fragment", () => {
    const primaryFragment = createMockFiber({ tag: OffscreenComponentTag });
    const suspenseFiber = createMockFiber({
      child: primaryFragment,
      memoizedState: {},
      tag: SuspenseComponentTag,
    });
    const onRender = vi.fn();
    mountFiberRecursively(onRender, suspenseFiber, false);
    expect(onRender).toHaveBeenCalledTimes(1);
  });

  it("should handle a timed-out suspense fiber with an empty fallback fragment", () => {
    const fallbackFragment = createMockFiber({ tag: FragmentTag });
    const primaryFragment = createMockFiber({
      sibling: fallbackFragment,
      tag: OffscreenComponentTag,
    });
    const suspenseFiber = createMockFiber({
      child: primaryFragment,
      memoizedState: {},
      tag: SuspenseComponentTag,
    });
    const onRender = vi.fn();
    mountFiberRecursively(onRender, suspenseFiber, false);
    expect(onRender).toHaveBeenCalledTimes(1);
  });

  it("should mount the primary child of a non-timed-out suspense fiber", () => {
    const primaryChild = createMockFiber();
    const offscreenFiber = createMockFiber({ child: primaryChild, tag: OffscreenComponentTag });
    const suspenseFiber = createMockFiber({ child: offscreenFiber, tag: SuspenseComponentTag });
    const onRender = vi.fn();
    mountFiberRecursively(onRender, suspenseFiber, false);
    expect(onRender).toHaveBeenCalledWith(suspenseFiber, "mount");
    expect(onRender).toHaveBeenCalledWith(primaryChild, "mount");
  });

  it("should handle a non-timed-out suspense fiber with no child", () => {
    const suspenseFiber = createMockFiber({ tag: SuspenseComponentTag });
    const onRender = vi.fn();
    mountFiberRecursively(onRender, suspenseFiber, false);
    expect(onRender).toHaveBeenCalledTimes(1);
  });

  it("should handle a timed-out suspense fiber with no child at all", () => {
    const suspenseFiber = createMockFiber({ memoizedState: {}, tag: SuspenseComponentTag });
    const onRender = vi.fn();
    mountFiberRecursively(onRender, suspenseFiber, false);
    expect(onRender).toHaveBeenCalledTimes(1);
  });

  it("should not report fibers that have not rendered", () => {
    const unrenderedFiber = createMockFiber({ flags: 0 });
    const onRender = vi.fn();
    mountFiberRecursively(onRender, unrenderedFiber, false);
    expect(onRender).not.toHaveBeenCalled();
  });
});

describe("updateFiberRecursively", () => {
  it("should return early when there is no previous fiber", () => {
    const nextFiber = createMockFiber();
    const onRender = vi.fn();
    updateFiberRecursively(onRender, nextFiber, null as unknown as Fiber, null);
    expect(onRender).not.toHaveBeenCalled();
  });

  it("should reconcile fallback sets when suspense stays timed out", () => {
    const nextFallbackSet = createMockFiber();
    const prevFallbackSet = createMockFiber();
    nextFallbackSet.alternate = prevFallbackSet;
    const nextFiber = createMockFiber({
      child: createMockFiber({ sibling: nextFallbackSet, tag: OffscreenComponentTag }),
      memoizedState: {},
      tag: SuspenseComponentTag,
    });
    const prevFiber = createMockFiber({
      child: createMockFiber({ sibling: prevFallbackSet, tag: OffscreenComponentTag }),
      memoizedState: {},
      tag: SuspenseComponentTag,
    });
    const onRender = vi.fn();
    updateFiberRecursively(onRender, nextFiber, prevFiber, null);
    expect(onRender).toHaveBeenCalledWith(nextFiber, "update");
    expect(onRender).toHaveBeenCalledWith(nextFallbackSet, "update");
  });

  it("should mount the primary set when suspense recovers from timeout", () => {
    const nextPrimaryChild = createMockFiber();
    const nextFiber = createMockFiber({
      child: nextPrimaryChild,
      tag: SuspenseComponentTag,
    });
    const prevFiber = createMockFiber({
      child: createMockFiber({ tag: OffscreenComponentTag }),
      memoizedState: {},
      tag: SuspenseComponentTag,
    });
    const onRender = vi.fn();
    updateFiberRecursively(onRender, nextFiber, prevFiber, null);
    expect(onRender).toHaveBeenCalledWith(nextFiber, "update");
    expect(onRender).toHaveBeenCalledWith(nextPrimaryChild, "mount");
  });

  it("should not report filtered fibers on update", () => {
    const nextFragment = createMockFiber({ tag: FragmentTag });
    const prevFragment = createMockFiber({ tag: FragmentTag });
    const onRender = vi.fn();
    updateFiberRecursively(onRender, nextFragment, prevFragment, null);
    expect(onRender).not.toHaveBeenCalled();
  });

  it("should handle timed-out suspense fibers without fallback sets", () => {
    const nextFiber = createMockFiber({ memoizedState: {}, tag: SuspenseComponentTag });
    const prevFiber = createMockFiber({ memoizedState: {}, tag: SuspenseComponentTag });
    const onRender = vi.fn();
    updateFiberRecursively(onRender, nextFiber, prevFiber, null);
    expect(onRender).toHaveBeenCalledTimes(1);
  });

  it("should handle suspense recovery when there is no primary set", () => {
    const nextFiber = createMockFiber({ tag: SuspenseComponentTag });
    const prevFiber = createMockFiber({ memoizedState: {}, tag: SuspenseComponentTag });
    const onRender = vi.fn();
    updateFiberRecursively(onRender, nextFiber, prevFiber, null);
    expect(onRender).toHaveBeenCalledTimes(1);
  });

  it("should handle suspense timing out without a fallback set", () => {
    const nextFiber = createMockFiber({
      child: createMockFiber({ tag: OffscreenComponentTag }),
      memoizedState: {},
      tag: SuspenseComponentTag,
    });
    const prevFiber = createMockFiber({ tag: SuspenseComponentTag });
    const onRender = vi.fn();
    updateFiberRecursively(onRender, nextFiber, prevFiber, null);
    expect(onRender).toHaveBeenCalledTimes(1);
  });

  it("should pass through the parent fiber when the parent is filtered", () => {
    const prevChild = createMockFiber();
    const nextChild = createMockFiber({ alternate: prevChild });
    const nextFragment = createMockFiber({ child: nextChild, tag: FragmentTag });
    const prevFragment = createMockFiber({ child: prevChild, tag: FragmentTag });
    const onRender = vi.fn();
    updateFiberRecursively(onRender, nextFragment, prevFragment, null);
    expect(onRender).toHaveBeenCalledWith(nextChild, "update");
  });

  it("should unmount the primary set and mount the fallback when suspense times out", () => {
    const prevFiber = createMockFiber({
      memoizedState: null,
      tag: SuspenseComponentTag,
    });
    const prevPrimaryChild = createMockFiber({ return: prevFiber });
    prevFiber.child = prevPrimaryChild;
    const nextFallbackSet = createMockFiber();
    const nextFiber = createMockFiber({
      child: createMockFiber({ sibling: nextFallbackSet, tag: OffscreenComponentTag }),
      memoizedState: {},
      tag: SuspenseComponentTag,
    });
    const onRender = vi.fn();
    updateFiberRecursively(onRender, nextFiber, prevFiber, null);
    expect(onRender).toHaveBeenCalledWith(prevPrimaryChild, "unmount");
    expect(onRender).toHaveBeenCalledWith(nextFallbackSet, "mount");
  });
});

describe("unmountFiber", () => {
  it("should report unmounts for root fibers", () => {
    const rootFiber = createMockFiber({ tag: HostRootTag });
    const onRender = vi.fn();
    unmountFiber(onRender, rootFiber);
    expect(onRender).toHaveBeenCalledWith(rootFiber, "unmount");
  });

  it("should skip filtered fibers", () => {
    const fragmentFiber = createMockFiber({ tag: FragmentTag });
    const onRender = vi.fn();
    unmountFiber(onRender, fragmentFiber);
    expect(onRender).not.toHaveBeenCalled();
  });
});

describe("unmountFiberChildrenRecursively", () => {
  it("should traverse the fallback tree of a timed-out suspense fiber", () => {
    const suspenseFiber = createMockFiber({
      memoizedState: {},
      tag: SuspenseComponentTag,
    });
    const fallbackChild = createMockFiber({ return: suspenseFiber });
    const fallbackFragment = createMockFiber({ child: fallbackChild, tag: FragmentTag });
    const primaryFragment = createMockFiber({
      sibling: fallbackFragment,
      tag: OffscreenComponentTag,
    });
    suspenseFiber.child = primaryFragment;
    const onRender = vi.fn();
    unmountFiberChildrenRecursively(onRender, suspenseFiber);
    expect(onRender).toHaveBeenCalledWith(fallbackChild, "unmount");
  });

  it("should skip children without a return pointer", () => {
    const detachedChild = createMockFiber();
    const parentFiber = createMockFiber({ child: detachedChild });
    const onRender = vi.fn();
    unmountFiberChildrenRecursively(onRender, parentFiber);
    expect(onRender).not.toHaveBeenCalled();
  });

  it("should handle timed-out suspense fibers without children", () => {
    const suspenseFiber = createMockFiber({ memoizedState: {}, tag: SuspenseComponentTag });
    const onRender = vi.fn();
    unmountFiberChildrenRecursively(onRender, suspenseFiber);
    expect(onRender).not.toHaveBeenCalled();
  });
});

describe("traverseRenderedFibers", () => {
  const createMountedRootFiber = (alternate: Fiber | null = null): Fiber =>
    createMockFiber({
      alternate,
      memoizedState: { element: {}, isDehydrated: false },
      tag: HostRootTag,
    });

  it("should report a mount on the first commit", () => {
    const rootFiber = createMountedRootFiber();
    const root: FiberRoot = { current: rootFiber };
    const onRender = vi.fn();
    traverseRenderedFibers(root, onRender);
    expect(onRender).toHaveBeenCalledWith(rootFiber, "mount");
  });

  it("should report a mount when the root becomes mounted", () => {
    const unmountedRootFiber = createMockFiber({ tag: HostRootTag });
    const root: FiberRoot = { current: unmountedRootFiber };
    const onRender = vi.fn();
    traverseRenderedFibers(root, onRender);
    const mountedRootFiber = createMountedRootFiber();
    root.current = mountedRootFiber;
    traverseRenderedFibers(root, onRender);
    expect(onRender).toHaveBeenCalledWith(mountedRootFiber, "mount");
  });

  it("should report an update when the root stays mounted", () => {
    const prevRootFiber = createMountedRootFiber();
    const root: FiberRoot = { current: prevRootFiber };
    const onRender = vi.fn();
    traverseRenderedFibers(root, onRender);
    const nextRootFiber = createMountedRootFiber(prevRootFiber);
    root.current = nextRootFiber;
    traverseRenderedFibers(root, onRender);
    expect(onRender).toHaveBeenCalledWith(nextRootFiber, "update");
  });

  it("should report an unmount when the root loses its element", () => {
    const mountedRootFiber = createMountedRootFiber();
    const root: FiberRoot = { current: mountedRootFiber };
    const onRender = vi.fn();
    traverseRenderedFibers(root, onRender);
    const unmountedRootFiber = createMockFiber({
      memoizedState: { element: null },
      tag: HostRootTag,
    });
    root.current = unmountedRootFiber;
    traverseRenderedFibers(root, onRender);
    expect(onRender).toHaveBeenCalledWith(unmountedRootFiber, "unmount");
  });

  it("should accept a fiber instead of a fiber root", () => {
    const fiber = createMockFiber();
    const onRender = vi.fn();
    traverseRenderedFibers(fiber, onRender);
    expect(onRender).toHaveBeenCalledWith(fiber, "mount");
  });

  it("should do nothing when the root stays unmounted", () => {
    const firstUnmountedRootFiber = createMockFiber({ tag: HostRootTag });
    const root: FiberRoot = { current: firstUnmountedRootFiber };
    const onRender = vi.fn();
    traverseRenderedFibers(root, onRender);
    const callCountAfterFirstCommit = onRender.mock.calls.length;
    root.current = createMockFiber({ tag: HostRootTag });
    traverseRenderedFibers(root, onRender);
    expect(onRender.mock.calls.length).toBe(callCountAfterFirstCommit);
  });

  it("currently throws when the root has no current fiber", () => {
    const root: FiberRoot = { current: null };
    const onRender = vi.fn();
    expect(() => traverseRenderedFibers(root, onRender)).toThrow(TypeError);
  });
});
