import "../src/index.js"; // KEEP THIS LINE ON TOP

import * as ReactThreeTestRenderer from "@react-three/test-renderer";
import { render, screen } from "@testing-library/react";
import React from "react";
import { expect, it } from "vitest";
import { getFiberFromHostInstance, getRDTHook, instrument, traverseFiber } from "../src/index.js";
import type { Fiber, FiberRoot, ReactRenderer } from "../src/types.js";

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
  const mockFiber = { pendingProps: {}, stateNode: {}, tag: 5, type: "RCTView" };
  const fabricPublicInstance = { __internalInstanceHandle: mockFiber, __nativeTag: 7 };
  expect(getFiberFromHostInstance(fabricPublicInstance)).toBe(mockFiber);

  const paperPublicInstance = { _internalInstanceHandle: mockFiber };
  expect(getFiberFromHostInstance(paperPublicInstance)).toBe(mockFiber);
});

it("should ignore instance handles that are not fibers", () => {
  expect(getFiberFromHostInstance({ __internalInstanceHandle: { notAFiber: true } })).toBe(null);
});

it("should resolve legacy roots through _reactRootContainer", () => {
  const mockFiber = { tag: 5, type: "div" };
  const legacyRootContainer = {
    _reactRootContainer: { _internalRoot: { current: { child: mockFiber } } },
  };
  expect(getFiberFromHostInstance(legacyRootContainer)).toBe(mockFiber);
});

it("should prefer renderer.findFiberByHostInstance when available", () => {
  const mockFiber = { tag: 5, type: "span" } as unknown as Fiber;
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
  let threeFiberRoot: FiberRoot | null = null;
  using _unsubscribe = instrument({
    onCommitFiberRoot: (rendererId, fiberRoot) => {
      const renderer = getRDTHook().renderers.get(rendererId);
      if (renderer?.rendererPackageName === "@react-three/fiber") {
        threeFiberRoot = fiberRoot;
      }
    },
  });
  const renderer = await ReactThreeTestRenderer.create(<mesh name="tracked-mesh" />);

  try {
    const fiberRoot = threeFiberRoot;
    if (!fiberRoot) throw new Error("React Three Fiber did not commit a root");
    const meshFiber = traverseFiber(fiberRoot.current, (fiber) => fiber.type === "mesh");
    if (!meshFiber) throw new Error("React Three Fiber did not create a mesh Fiber");
    expect(getFiberFromHostInstance(meshFiber.stateNode)).toBe(meshFiber);
  } finally {
    await renderer.unmount();
  }
});
