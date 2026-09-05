import "../../../bippy/src/index.js"; // KEEP THIS LINE ON TOP

import { describe, expect, it, vi } from "vite-plus/test";
import type { Fiber } from "../../../bippy/src/react-internals/index.js";
import { instrument, traverseFiber } from "../../../bippy/src/index.js";
import { latestReactWorkTags } from "./react-work-tags.js";
import React from "react";
import { render } from "@testing-library/react";

const createMockFiber = (overrides: Record<string, unknown> = {}): Fiber =>
  ({
    alternate: null,
    child: null,
    dependencies: null,
    flags: 0,
    memoizedProps: {},
    memoizedState: null,
    pendingProps: {},
    return: null,
    sibling: null,
    stateNode: null,
    tag: latestReactWorkTags.FunctionComponent,
    type: null,
    ...overrides,
  }) as unknown as Fiber;

const Example = () => {
  return <div>Hello</div>;
};
describe("traverseFiber", () => {
  it("should return the nearest host fiber", () => {
    let maybeFiber: Fiber | null = null;
    instrument({
      onCommitFiberRoot: (_rendererID, fiberRoot) => {
        maybeFiber = fiberRoot.current.child;
      },
    });
    render(<Example />);
    expect(traverseFiber(maybeFiber as unknown as Fiber, (fiber) => fiber.type === "div")).toBe(
      (maybeFiber as unknown as Fiber)?.child,
    );
  });

  it("should call selector only once per node (descending)", () => {
    let maybeFiber: Fiber | null = null;
    instrument({
      onCommitFiberRoot: (_rendererID, fiberRoot) => {
        maybeFiber = fiberRoot.current.child;
      },
    });
    render(<Example />);
    const selector = vi.fn((fiber) => fiber.type === "div");
    const result = traverseFiber(maybeFiber as unknown as Fiber, selector);
    expect(result).toBeTruthy();
    const callCounts = new Map<Fiber, number>();
    selector.mock.calls.forEach(([fiber]) => {
      callCounts.set(fiber, (callCounts.get(fiber) || 0) + 1);
    });
    callCounts.forEach((count, _fiber) => {
      expect(count).toBe(1);
    });
  });

  it("should call selector only once per node (ascending)", () => {
    let maybeFiber: Fiber | null = null;
    instrument({
      onCommitFiberRoot: (_rendererID, fiberRoot) => {
        maybeFiber = fiberRoot.current.child?.child ?? null;
      },
    });
    render(<Example />);
    const selector = vi.fn((fiber) => fiber.tag === latestReactWorkTags.HostRoot);
    const result = traverseFiber(maybeFiber as unknown as Fiber, selector, true);
    expect(result).toBeTruthy();
    const callCounts = new Map<Fiber, number>();
    selector.mock.calls.forEach(([fiber]) => {
      callCounts.set(fiber, (callCounts.get(fiber) || 0) + 1);
    });
    callCounts.forEach((count, _fiber) => {
      expect(count).toBe(1);
    });
  });

  it("should call async selector only once per node (descending)", async () => {
    let maybeFiber: Fiber | null = null;
    instrument({
      onCommitFiberRoot: (_rendererID, fiberRoot) => {
        maybeFiber = fiberRoot.current.child;
      },
    });
    render(<Example />);
    const selector = vi.fn(async (fiber) => fiber.type === "div");
    const result = await traverseFiber(maybeFiber as unknown as Fiber, selector);
    expect(result).toBeTruthy();
    const callCounts = new Map<Fiber, number>();
    selector.mock.calls.forEach(([fiber]) => {
      callCounts.set(fiber, (callCounts.get(fiber) || 0) + 1);
    });
    callCounts.forEach((count, _fiber) => {
      expect(count).toBe(1);
    });
  });

  it("should call async selector only once per node (ascending)", async () => {
    let maybeFiber: Fiber | null = null;
    instrument({
      onCommitFiberRoot: (_rendererID, fiberRoot) => {
        maybeFiber = fiberRoot.current.child?.child ?? null;
      },
    });
    render(<Example />);
    const selector = vi.fn(async (fiber) => fiber.tag === latestReactWorkTags.HostRoot);
    const result = await traverseFiber(maybeFiber as unknown as Fiber, selector, true);
    expect(result).toBeTruthy();
    const callCounts = new Map<Fiber, number>();
    selector.mock.calls.forEach(([fiber]) => {
      callCounts.set(fiber, (callCounts.get(fiber) || 0) + 1);
    });
    callCounts.forEach((count, _fiber) => {
      expect(count).toBe(1);
    });
  });

  it("should find first node when it matches (descending)", () => {
    let maybeFiber: Fiber | null = null;
    instrument({
      onCommitFiberRoot: (_rendererID, fiberRoot) => {
        maybeFiber = fiberRoot.current.child;
      },
    });
    render(<Example />);
    const selector = vi.fn((fiber) => fiber === maybeFiber);
    const result = traverseFiber(maybeFiber as unknown as Fiber, selector);
    expect(result).toBe(maybeFiber);
    expect(selector).toBeCalledTimes(1);
  });

  it("should find first node when it matches (ascending)", () => {
    let maybeFiber: Fiber | null = null;
    instrument({
      onCommitFiberRoot: (_rendererID, fiberRoot) => {
        maybeFiber = fiberRoot.current.child;
      },
    });
    render(<Example />);
    const selector = vi.fn((fiber) => fiber === maybeFiber);
    const result = traverseFiber(maybeFiber as unknown as Fiber, selector, true);
    expect(result).toBe(maybeFiber);
    expect(selector).toBeCalledTimes(1);
  });

  it("should find first node when it matches (async descending)", async () => {
    let maybeFiber: Fiber | null = null;
    instrument({
      onCommitFiberRoot: (_rendererID, fiberRoot) => {
        maybeFiber = fiberRoot.current.child;
      },
    });
    render(<Example />);
    const selector = vi.fn(async (fiber) => fiber === maybeFiber);
    const result = await traverseFiber(maybeFiber as unknown as Fiber, selector);
    expect(result).toBe(maybeFiber);
    expect(selector).toBeCalledTimes(1);
  });

  it("should find first node when it matches (async ascending)", async () => {
    let maybeFiber: Fiber | null = null;
    instrument({
      onCommitFiberRoot: (_rendererID, fiberRoot) => {
        maybeFiber = fiberRoot.current.child;
      },
    });
    render(<Example />);
    const selector = vi.fn(async (fiber) => fiber === maybeFiber);
    const result = await traverseFiber(maybeFiber as unknown as Fiber, selector, true);
    expect(result).toBe(maybeFiber);
    expect(selector).toBeCalledTimes(1);
  });

  it("should return null when passed a null fiber", async () => {
    expect(traverseFiber(null, () => true)).toBe(null);
    expect(await traverseFiber(null, async () => true)).toBe(null);
  });

  it("should return null when no node matches (async descending)", async () => {
    let maybeFiber: Fiber | null = null;
    instrument({
      onCommitFiberRoot: (_rendererID, fiberRoot) => {
        maybeFiber = fiberRoot.current.child;
      },
    });
    render(<Example />);
    const result = await traverseFiber(maybeFiber as unknown as Fiber, async () => false);
    expect(result).toBe(null);
  });

  it("should return null when no node matches (async ascending)", async () => {
    let maybeFiber: Fiber | null = null;
    instrument({
      onCommitFiberRoot: (_rendererID, fiberRoot) => {
        maybeFiber = fiberRoot.current.child;
      },
    });
    render(<Example />);
    const result = await traverseFiber(maybeFiber as unknown as Fiber, async () => false, true);
    expect(result).toBe(null);
  });

  it("should traverse siblings when the first async subtree does not match", async () => {
    const targetSibling = createMockFiber();
    const firstChild = createMockFiber({ sibling: targetSibling });
    const rootFiber = createMockFiber({ child: firstChild });
    const result = await traverseFiber(rootFiber, async (fiber) => fiber === targetSibling);
    expect(result).toBe(targetSibling);
  });

  it("should await promises returned after synchronous selector results", async () => {
    const targetFiber = createMockFiber();
    const rootFiber = createMockFiber({ child: targetFiber });
    const result = traverseFiber(rootFiber, (fiber) =>
      fiber === rootFiber ? false : Promise.resolve(fiber === targetFiber),
    );
    expect(await result).toBe(targetFiber);
  });

  it("should return null when no node matches (sync descending)", () => {
    const targetSibling = createMockFiber();
    const firstChild = createMockFiber({ sibling: targetSibling });
    const rootFiber = createMockFiber({ child: firstChild });
    expect(traverseFiber(rootFiber, () => false)).toBe(null);
  });

  it("should traverse nested siblings with an async selector (descending)", async () => {
    const targetSibling = createMockFiber();
    const firstGrandchild = createMockFiber({ sibling: targetSibling });
    const childFiber = createMockFiber({ child: firstGrandchild });
    const rootFiber = createMockFiber({ child: childFiber });
    const result = await traverseFiber(rootFiber, async (fiber) => fiber === targetSibling);
    expect(result).toBe(targetSibling);
  });

  it("should return null with an async selector when ascending finds no match", async () => {
    const rootFiber = createMockFiber();
    const parentFiber = createMockFiber({ return: rootFiber });
    const childFiber = createMockFiber({ return: parentFiber });
    const result = await traverseFiber(childFiber, async () => false, true);
    expect(result).toBe(null);
  });
});
