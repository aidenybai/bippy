import "../src/index.js"; // KEEP THIS LINE ON TOP

import { expect, it } from "vitest";
import React from "react";

import {
  ClassComponentTag,
  ContextConsumerTag,
  didFiberRender,
  ForwardRefTag,
  instrument,
} from "../src/index.js";
import type { Fiber, WorkTag } from "../src/index.js";
import { ReactFiberFlags } from "../src/react-internals.js";
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
  using _unsubscribe = instrument({
    onCommitFiberRoot: (_rendererID, fiberRoot) => {
      maybeRenderedFiber = fiberRoot.current.child;
    },
  });
  render(<Example />);
  if (!maybeRenderedFiber) throw new Error("React DOM did not render the example fiber");
  expect(didFiberRender(maybeRenderedFiber)).toBe(true);
});

const createMockFiber = (tag: WorkTag, flags: number | undefined, effectTag?: number): Fiber =>
  ({
    alternate: null,
    child: null,
    effectTag,
    flags,
    memoizedProps: {},
    memoizedState: null,
    pendingProps: {},
    return: null,
    sibling: null,
    stateNode: null,
    tag,
    type: () => null,
  }) as unknown as Fiber;

it("should check the PerformedWork flag for every composite tag", () => {
  expect(didFiberRender(createMockFiber(ClassComponentTag, ReactFiberFlags.PerformedWork))).toBe(
    true,
  );
  expect(didFiberRender(createMockFiber(ContextConsumerTag, ReactFiberFlags.PerformedWork))).toBe(
    true,
  );
  expect(didFiberRender(createMockFiber(ForwardRefTag, ReactFiberFlags.PerformedWork))).toBe(true);
});

it("should fall back to effectTag for legacy react versions", () => {
  expect(
    didFiberRender(createMockFiber(ClassComponentTag, undefined, ReactFiberFlags.PerformedWork)),
  ).toBe(true);
  expect(didFiberRender(createMockFiber(ClassComponentTag, undefined))).toBe(false);
});

it("should return false for a fiber that hasn't rendered", () => {
  let maybeRenderedFiber: Fiber | null = null;
  using _unsubscribe = instrument({
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
});
