import "../index.js"; // KEEP THIS LINE ON TOP

import { render, screen } from "@testing-library/react";
import React from "react";
import { expect, it } from "vitest";
import { getFiberFromHostInstance, getRDTHook } from "../index.js";
import type { Fiber, ReactRenderer } from "../types.js";

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
