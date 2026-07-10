import "../src/index.js"; // KEEP THIS LINE ON TOP

import { render } from "@testing-library/react";
import React from "react";
import { expect, it } from "vitest";
import { instrument, isCompositeFiber } from "../src/index.js";
import type { Fiber } from "../src/types.js";

export const Example = () => {
  return <div>Hello</div>;
};

it("should return true for a composite fiber", () => {
  let maybeCompositeFiber: Fiber | null = null;
  instrument({
    onCommitFiberRoot: (_rendererID, fiberRoot) => {
      maybeCompositeFiber = fiberRoot.current.child;
    },
  });
  render(<Example />);
  expect(maybeCompositeFiber).not.toBeNull();
  expect(isCompositeFiber(maybeCompositeFiber as unknown as Fiber)).toBe(true);
});

it("should return true for class and forwardRef fiber tags", () => {
  const createMockFiber = (tag: number): Fiber =>
    ({
      child: null,
      flags: 0,
      return: null,
      sibling: null,
      stateNode: null,
      tag,
      type: () => null,
    }) as unknown as Fiber;
  expect(isCompositeFiber(createMockFiber(1))).toBe(true);
  expect(isCompositeFiber(createMockFiber(11))).toBe(true);
});

it("should return false for a host fiber", () => {
  let maybeCompositeFiber: Fiber | null = null;
  instrument({
    onCommitFiberRoot: (_rendererID, fiberRoot) => {
      maybeCompositeFiber = fiberRoot.current.child;
    },
  });
  render(<div>Hello</div>);
  expect(maybeCompositeFiber).not.toBeNull();
  expect(isCompositeFiber(maybeCompositeFiber as unknown as Fiber)).toBe(false);
});
