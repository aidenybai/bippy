import "../src/index.js"; // HACK: Bippy must initialize before imports that load React.

import { render } from "@testing-library/react";
import React from "react";
import { expect, it } from "vite-plus/test";
import { isHostFiber, getFiberFromHostInstance, isFiber } from "../src/index.js";
import { requireFiber } from "./require-fiber.js";

export const Example = () => {
  return <div>Hello</div>;
};

it("should return true for a fiber", () => {
  const { container } = render(<div>Hello</div>);
  const hostFiber = getFiberFromHostInstance(container.firstChild);
  expect(isFiber(hostFiber)).toBe(true);
});

it("should return true for a composite fiber", () => {
  const { container } = render(<Example />);

  const hostFiber = getFiberFromHostInstance(container.firstChild);
  expect(isHostFiber(requireFiber(hostFiber, "React DOM did not render a host Fiber"))).toBe(true);
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
});
