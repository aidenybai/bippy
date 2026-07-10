import "../src/index.js"; // KEEP THIS LINE ON TOP

import { render } from "@testing-library/react";
import React from "react";
import { expect, it } from "vitest";
import { getTimings, instrument } from "../src/index.js";
import type { Fiber } from "../src/types.js";

const SlowComponent = () => {
  for (let i = 0; i < 100; i++) {} // simulate slowdown
  return <div>Hello</div>;
};

it("should return zero timings when there is no fiber", () => {
  expect(getTimings(null)).toEqual({ selfTime: 0, totalTime: 0 });
  expect(getTimings()).toEqual({ selfTime: 0, totalTime: 0 });
});

it("should treat children without actualDuration as zero cost", () => {
  const childFiber = { actualDuration: undefined, sibling: null } as unknown as Fiber;
  const fiber = { actualDuration: 5, child: childFiber } as unknown as Fiber;
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
  const timings = getTimings(maybeFiber as unknown as Fiber);
  expect(timings.selfTime).toBeGreaterThan(0);
  expect(timings.totalTime).toBeGreaterThan(0);
});
