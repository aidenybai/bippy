import "../src/index.js"; // KEEP THIS LINE ON TOP

import * as ReactThreeTestRenderer from "@react-three/test-renderer";
import { render, screen } from "@testing-library/react";
import React from "react";
import { expect, it } from "vite-plus/test";
import { getFiberFromHostInstance, getRDTHook, instrument, traverseFiber } from "../src/index.js";
import type { Fiber, FiberRoot, ReactRenderer, WorkTag } from "../src/react-internals/index.js";
import { latestReactWorkTags } from "./react-work-tags.js";

interface MockHostFiber {
  child: MockHostFiber | null;
  flags: number;
  memoizedState?: Record<string, unknown>;
  pendingProps: Record<string, unknown>;
  return: MockHostFiber | null;
  sibling: MockHostFiber | null;
  stateNode: unknown;
  tag: WorkTag;
  type: string;
}

const createMockHostFiber = (stateNode: unknown, type = "RCTView"): MockHostFiber => ({
  child: null,
  flags: 0,
  pendingProps: {},
  return: null,
  sibling: null,
  stateNode,
  tag: latestReactWorkTags.HostComponent,
  type,
});

it("should return the fiber from the host instance", () => {
  render(<div>HostInstance</div>);
  const fiber = getFiberFromHostInstance(screen.getByText("HostInstance"));
  expect(fiber).not.toBeNull();
  expect(fiber?.type).toBe("div");
});

it("should return null for objects without any fiber reference", () => {
  expect(getFiberFromHostInstance({})).toBe(null);
  expect(getFiberFromHostInstance(null)).toBe(null);
  expect(getFiberFromHostInstance("not-a-node")).toBe(null);
});

it("should return null when the fiber property holds a falsy value", () => {
  const hostInstanceWithEmptyFiber = { __reactFiber$empty: null };
  expect(getFiberFromHostInstance(hostInstanceWithEmptyFiber)).toBe(null);
});

it("should resolve React Native Fabric public instances via the internal instance handle", () => {
  const mockFiber = createMockHostFiber({});
  const fabricPublicInstance = { __internalInstanceHandle: mockFiber, __nativeTag: 7 };
  expect(getFiberFromHostInstance(fabricPublicInstance)).toBe(mockFiber);

  const paperPublicInstance = { _internalInstanceHandle: mockFiber };
  expect(getFiberFromHostInstance(paperPublicInstance)).toBe(mockFiber);
});

it("should ignore instance handles that are not fibers", () => {
  expect(getFiberFromHostInstance({ __internalInstanceHandle: { notAFiber: true } })).toBe(null);
});

it("should resolve legacy roots through _reactRootContainer", () => {
  const mockFiber = createMockHostFiber({}, "div");
  const legacyRootContainer = {
    _reactRootContainer: { _internalRoot: { current: { child: mockFiber } } },
  };
  expect(getFiberFromHostInstance(legacyRootContainer)).toBe(mockFiber);
});

it("should resolve Fabric public instances from canonical host state", () => {
  const unsubscribe = instrument({});
  const publicInstance = {};
  const hostFiber = createMockHostFiber({ canonical: { publicInstance } });
  const rootFiber = createMockHostFiber(null, "root");
  rootFiber.tag = latestReactWorkTags.HostRoot;
  rootFiber.child = hostFiber;
  rootFiber.memoizedState = { element: {} };
  hostFiber.return = rootFiber;
  const fiberRoot = { current: rootFiber };
  getRDTHook().onCommitFiberRoot(999, fiberRoot as unknown as FiberRoot, undefined, false);
  try {
    expect(getFiberFromHostInstance(publicInstance)).toBe(hostFiber);
  } finally {
    rootFiber.memoizedState = { element: null };
    getRDTHook().onCommitFiberRoot(999, fiberRoot as unknown as FiberRoot, undefined, false);
    unsubscribe();
  }
});

it("should resolve Paper native tags from host state", () => {
  const unsubscribe = instrument({});
  const hostFiber = createMockHostFiber({ _nativeTag: 42 });
  const rootFiber = createMockHostFiber(null, "root");
  rootFiber.tag = latestReactWorkTags.HostRoot;
  rootFiber.child = hostFiber;
  rootFiber.memoizedState = { element: {} };
  hostFiber.return = rootFiber;
  const fiberRoot = { current: rootFiber };
  getRDTHook().onCommitFiberRoot(999, fiberRoot as unknown as FiberRoot, undefined, false);
  try {
    expect(getFiberFromHostInstance(42)).toBe(hostFiber);
  } finally {
    rootFiber.memoizedState = { element: null };
    getRDTHook().onCommitFiberRoot(999, fiberRoot as unknown as FiberRoot, undefined, false);
    unsubscribe();
  }
});

it("should prefer renderer.findFiberByHostInstance when available", () => {
  const mockFiber = { tag: latestReactWorkTags.HostComponent, type: "span" } as unknown as Fiber;
  const rdtHook = getRDTHook();
  const findFiberByHostInstance = () => mockFiber;
  rdtHook.renderers.set(999, { findFiberByHostInstance } as unknown as ReactRenderer);
  try {
    expect(getFiberFromHostInstance({})).toBe(mockFiber);
  } finally {
    rdtHook.renderers.delete(999);
  }
});

it("should ignore renderers whose findFiberByHostInstance throws", () => {
  const rdtHook = getRDTHook();
  const findFiberByHostInstance = () => {
    throw new Error("no fiber");
  };
  rdtHook.renderers.set(999, { findFiberByHostInstance } as unknown as ReactRenderer);
  try {
    expect(getFiberFromHostInstance({})).toBe(null);
  } finally {
    rdtHook.renderers.delete(999);
  }
});

it("should resolve React Three Fiber host instances from its tracked root", async () => {
  const threeFiberRootRef: { current: FiberRoot | null } = { current: null };
  const unsubscribe = instrument({
    onCommitFiberRoot: (rendererId, fiberRoot) => {
      const renderer = getRDTHook().renderers.get(rendererId);
      if (renderer?.rendererPackageName === "@react-three/fiber") {
        threeFiberRootRef.current = fiberRoot;
      }
    },
  });
  const renderer = await ReactThreeTestRenderer.create(
    React.createElement("mesh", { name: "tracked-mesh" }),
  );

  try {
    const fiberRoot = threeFiberRootRef.current;
    if (!fiberRoot) throw new Error("React Three Fiber did not commit a root");
    const meshFiber = traverseFiber(fiberRoot.current, (fiber) => fiber.type === "mesh");
    if (!meshFiber) throw new Error("React Three Fiber did not create a mesh Fiber");
    expect(getFiberFromHostInstance(meshFiber.stateNode)).toBe(meshFiber);
  } finally {
    await renderer.unmount();
    unsubscribe();
  }
});
