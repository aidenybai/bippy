import "../src/index.js"; // HACK: Bippy must initialize before imports that load React.

import { expect, it } from "vite-plus/test";
import React from "react";

import { didFiberCommit, instrument, type Fiber } from "../src/index.js";
import { render } from "@testing-library/react";
import { requireFiber } from "./require-fiber.js";

const Example = () => {
  return <div>Hello</div>;
};

export const ExampleWithUnmount = () => {
  const [shouldUnmount, setShouldUnmount] = React.useState(true);
  React.useEffect(() => {
    setShouldUnmount(false);
  }, []);
  return shouldUnmount ? <div>Hello</div> : null;
};

it("should return true for a fiber that has committed", () => {
  let maybeRenderedFiber: Fiber | null = null;
  instrument({
    onCommitFiberRoot: (_rendererID, fiberRoot) => {
      maybeRenderedFiber = fiberRoot.current.child;
    },
  });
  render(<ExampleWithUnmount />);
  expect(maybeRenderedFiber).not.toBeNull();
  expect(didFiberCommit(requireFiber(maybeRenderedFiber, "React DOM did not render a Fiber"))).toBe(
    true,
  );
});

it("should return false for a fiber that hasn't committed", () => {
  let maybeRenderedFiber: Fiber | null = null;
  instrument({
    onCommitFiberRoot: (_rendererID, fiberRoot) => {
      maybeRenderedFiber = fiberRoot.current.child;
    },
  });
  render(<Example />);
  expect(maybeRenderedFiber).not.toBeNull();
  expect(didFiberCommit(requireFiber(maybeRenderedFiber, "React DOM did not render a Fiber"))).toBe(
    false,
  );
});
