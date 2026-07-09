import "../src/index.js"; // KEEP THIS LINE ON TOP

import { expect, it } from "vitest";
import React, { forwardRef, memo, Component } from "react";

import { getDisplayName } from "../src/index.js";

const Example = () => {
  return null;
};

Example.displayName = "Example";

export const ForwardRefExample = forwardRef(Example);
export const MemoizedExample = memo(Example);

export class ClassComponent extends Component {
  render() {
    return <div>Hello</div>;
  }
}

it("should return the displayName of the forwardRef component", () => {
  expect(getDisplayName(ForwardRefExample)).toBe("Example");
});

it("should return the displayName of the memoized component", () => {
  expect(getDisplayName(MemoizedExample)).toBe("Example");
});

it("should return the displayName of the component", () => {
  expect(getDisplayName(Example)).toBe("Example");
});

it("should return the displayName of the class component", () => {
  expect(getDisplayName(ClassComponent)).toBe("ClassComponent");
});

it("should return null for a non-fiber", () => {
  expect(getDisplayName({})).toBe(null);
});

it("should return the string itself for host component types", () => {
  expect(getDisplayName("div")).toBe("div");
});

it("should return null for non-component values", () => {
  expect(getDisplayName(42)).toBe(null);
  expect(getDisplayName(null)).toBe(null);
});

it("should unwrap memo components without a displayName", () => {
  const namedInner = () => null;
  expect(getDisplayName(memo(namedInner))).toBe("namedInner");
});

it("should return null for memoized anonymous components", () => {
  expect(getDisplayName(memo(() => null))).toBe(null);
});
