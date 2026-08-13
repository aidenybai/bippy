import "../src/index.js"; // HACK: Bippy must initialize before imports that load React.

import { render } from "@testing-library/react";
import React from "react";
import { expect, it } from "vite-plus/test";
import { instrument, isCompositeFiber } from "../src/index.js";
import type { Fiber } from "../src/react-internals/index.js";
import { createFiber } from "./create-fiber.js";
import { requireFiber } from "./require-fiber.js";

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
  expect(
    isCompositeFiber(requireFiber(maybeCompositeFiber, "React DOM did not render a Fiber")),
  ).toBe(true);
});

it("should return true for class and forwardRef fiber tags", () => {
  expect(isCompositeFiber(createFiber({ tag: 1, type: () => null }))).toBe(true);
  expect(isCompositeFiber(createFiber({ tag: 11, type: () => null }))).toBe(true);
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
  expect(
    isCompositeFiber(requireFiber(maybeCompositeFiber, "React DOM did not render a Fiber")),
  ).toBe(false);
});
