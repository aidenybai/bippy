import "../src/index.js"; // HACK: Bippy must initialize before imports that load React.

import { render } from "@testing-library/react";
import React from "react";
import { expect, it } from "vite-plus/test";
import { getTimings, instrument } from "../src/index.js";
import type { Fiber } from "../src/react-internals/index.js";
import { requireFiber } from "./require-fiber.js";

const SlowComponent = () => {
  for (let iterationIndex = 0; iterationIndex < 100; iterationIndex++) {}
  return <div>Hello</div>;
};

it("should return zero timings when there is no fiber", () => {
  expect(getTimings(null)).toEqual({ selfTime: 0, totalTime: 0 });
  expect(getTimings()).toEqual({ selfTime: 0, totalTime: 0 });
});

it("should treat children without actualDuration as zero cost", () => {
  const childFiber = { actualDuration: undefined, sibling: null };
  const fiber = { actualDuration: 5, child: childFiber };
  expect(getTimings(fiber)).toEqual({ selfTime: 5, totalTime: 5 });
});

it("should return the timings of the fiber", () => {
  let maybeFiber: Fiber | null = null;
  instrument({
    onCommitFiberRoot: (_rendererID, fiberRoot) => {
      maybeFiber = fiberRoot.current.child;
    },
  });
  render(<SlowComponent />);
  const timings = getTimings(requireFiber(maybeFiber, "React DOM did not render a Fiber"));
  expect(timings.selfTime).toBeGreaterThan(0);
  expect(timings.totalTime).toBeGreaterThan(0);
});
