import "../../../bippy/src/index.js"; // KEEP THIS LINE ON TOP

import { render } from "@testing-library/react";
import React from "react";
import { expect, it } from "vite-plus/test";
import { getFiberFromHostInstance, isFiber, isHostFiber } from "../../../bippy/src/index.js";

const Example = () => {
  return <div>Hello</div>;
};

it("returns true for a Fiber", () => {
  const { container } = render(<div>Hello</div>);
  const hostFiber = getFiberFromHostInstance(container.firstChild);
  expect(isFiber(hostFiber)).toBe(true);
});

it("should return true for a composite fiber", () => {
  const { container } = render(<Example />);

  const hostFiber = getFiberFromHostInstance(container.firstChild);
  expect(hostFiber).not.toBeNull();
  if (!hostFiber) throw new Error("Expected the rendered host Fiber");
  expect(isHostFiber(hostFiber)).toBe(true);
});

it("should return false for non-object types", () => {
  expect(isFiber(null)).toBe(false);
  expect(isFiber(undefined)).toBe(false);
  expect(isFiber("")).toBe(false);
  expect(isFiber("string")).toBe(false);
  expect(isFiber(123)).toBe(false);
  expect(isFiber(0)).toBe(false);
  expect(isFiber(true)).toBe(false);
  expect(isFiber(false)).toBe(false);
  expect(isFiber(Symbol("test"))).toBe(false);
  expect(isFiber({ pendingProps: null })).toBe(false);
});
