import "../index.js"; // KEEP THIS LINE ON TOP

import { expect, it } from "vitest";
import React from "react";

import { didFiberRender, Fiber, instrument } from "../index.js";
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
  instrument({
    onCommitFiberRoot: (_rendererID, fiberRoot) => {
      maybeRenderedFiber = fiberRoot.current.child;
    },
  });
  render(<Example />);
  expect(maybeRenderedFiber).not.toBeNull();
  expect(didFiberRender(maybeRenderedFiber as unknown as Fiber)).toBe(true);
});

const PERFORMED_WORK_FLAG = 0b1;

const createMockFiber = (tag: number, flags: number | undefined, effectTag?: number): Fiber =>
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
  const classComponentTag = 1;
  const contextConsumerTag = 9;
  const forwardRefTag = 11;
  expect(didFiberRender(createMockFiber(classComponentTag, PERFORMED_WORK_FLAG))).toBe(true);
  expect(didFiberRender(createMockFiber(contextConsumerTag, PERFORMED_WORK_FLAG))).toBe(true);
  expect(didFiberRender(createMockFiber(forwardRefTag, PERFORMED_WORK_FLAG))).toBe(true);
});

it("should fall back to effectTag for legacy react versions", () => {
  const classComponentTag = 1;
  expect(didFiberRender(createMockFiber(classComponentTag, undefined, PERFORMED_WORK_FLAG))).toBe(
    true,
  );
  expect(didFiberRender(createMockFiber(classComponentTag, undefined))).toBe(false);
});

it("should return false for a fiber that hasn't rendered", () => {
  let maybeRenderedFiber: Fiber | null = null;
  instrument({
    onCommitFiberRoot: (_rendererID, fiberRoot) => {
      maybeRenderedFiber = fiberRoot.current.child;
    },
  });
  render(
    <div>
      <ExampleWithUnmount />
    </div>,
  );
  expect(maybeRenderedFiber).not.toBeNull();
  expect(didFiberRender(maybeRenderedFiber as unknown as Fiber)).toBe(false);
});
