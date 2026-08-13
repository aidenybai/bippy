import "../src/index.js"; // HACK: Bippy must initialize before imports that load React.

import { expect, it } from "vite-plus/test";
import React from "react";

import { didFiberRender, instrument } from "../src/index.js";
import type { Fiber, WorkTag } from "../src/index.js";
import { ReactFiberFlags } from "../src/react-internals/index.js";
import { createFiber } from "./create-fiber.js";
import { latestReactWorkTags } from "./react-work-tags.js";
import { render } from "@testing-library/react";

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

it("should return true for a fiber that has rendered", () => {
  let maybeRenderedFiber: Fiber | null = null;
  const unsubscribe = instrument({
    onCommitFiberRoot: (_rendererID, fiberRoot) => {
      maybeRenderedFiber = fiberRoot.current.child;
    },
  });
  render(<Example />);
  if (!maybeRenderedFiber) throw new Error("React DOM did not render the example fiber");
  expect(didFiberRender(maybeRenderedFiber)).toBe(true);
  unsubscribe();
});

const createMockFiber = (tag: WorkTag, flags: number | undefined, effectTag?: number): Fiber =>
  createFiber({ effectTag, flags, tag, type: () => null });

it("should check the PerformedWork flag for every composite tag", () => {
  expect(
    didFiberRender(
      createMockFiber(latestReactWorkTags.ClassComponent, ReactFiberFlags.PerformedWork),
    ),
  ).toBe(true);
  expect(
    didFiberRender(
      createMockFiber(latestReactWorkTags.ContextConsumer, ReactFiberFlags.PerformedWork),
    ),
  ).toBe(true);
  expect(
    didFiberRender(createMockFiber(latestReactWorkTags.ForwardRef, ReactFiberFlags.PerformedWork)),
  ).toBe(true);
});

it("should fall back to effectTag for legacy react versions", () => {
  expect(
    didFiberRender(
      createMockFiber(latestReactWorkTags.ClassComponent, undefined, ReactFiberFlags.PerformedWork),
    ),
  ).toBe(true);
  expect(didFiberRender(createMockFiber(latestReactWorkTags.ClassComponent, undefined))).toBe(
    false,
  );
});

it("should return false for a fiber that hasn't rendered", () => {
  let maybeRenderedFiber: Fiber | null = null;
  const unsubscribe = instrument({
    onCommitFiberRoot: (_rendererID, fiberRoot) => {
      maybeRenderedFiber = fiberRoot.current.child;
    },
  });
  render(
    <div>
      <ExampleWithUnmount />
    </div>,
  );
  if (!maybeRenderedFiber) throw new Error("React DOM did not render the unmounted fiber");
  expect(didFiberRender(maybeRenderedFiber)).toBe(false);
  unsubscribe();
});
