import "../src/index.js"; // HACK: Bippy must initialize before imports that load React.

import React from "react";
import { expect, it } from "vite-plus/test";
import { instrument, isValidFiber } from "../src/index.js";
import type { Fiber } from "../src/react-internals/index.js";
import { requireFiber } from "./require-fiber.js";
import { render } from "@testing-library/react";

export const Example = () => {
  return null;
};

it("should return true for a valid fiber", () => {
  let maybeFiber: Fiber | null = null;
  instrument({
    onCommitFiberRoot: (_rendererID, fiberRoot) => {
      maybeFiber = fiberRoot.current.child;
    },
  });
  render(<Example />);
  expect(isValidFiber(requireFiber(maybeFiber, "React DOM did not render a Fiber"))).toBe(true);
});

it("should return false for a non-fiber", () => {
  expect(isValidFiber({})).toBe(false);
});
