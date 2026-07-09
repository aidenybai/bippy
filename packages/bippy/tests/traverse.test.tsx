import "../src/index.js"; // KEEP THIS LINE ON TOP

import { describe, expect, it, vi } from "vitest";
import type { ContextDependency, Fiber } from "../src/types.js";
import {
  instrument,
  traverseContexts,
  traverseFiber,
  traverseFiberAsync,
  traverseFiberSync,
  traverseProps,
  traverseState,
} from "../src/index.js";
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
    tag: 0,
    type: null,
    ...overrides,
  }) as unknown as Fiber;

export const Context1 = React.createContext(0);
export const Context2 = React.createContext(0);

export const Example = () => {
  return <div>Hello</div>;
};

export const ComplexComponent = ({
  countProp = 0,
}: {
  countProp?: number;
  extraProp?: unknown;
}) => {
  const countContextValue = React.useContext(Context1);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _extraContextValue = React.useContext(Context2);
  const [countState, setCountState] = React.useState(0);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_extraState, _setExtraState] = React.useState(0);

  React.useEffect(() => {
    setCountState(countState + 1);
  }, []);

  return <div>{countContextValue + countState + countProp}</div>;
};

describe("traverseProps", () => {
  it("should return the props of the fiber", () => {
    let maybeFiber: Fiber | null = null;
    instrument({
      onCommitFiberRoot: (_rendererID, fiberRoot) => {
        maybeFiber = fiberRoot.current.child;
      },
    });
    render(<ComplexComponent countProp={0} />);
    const selector = vi.fn();
    traverseProps(maybeFiber as unknown as Fiber, selector);
    expect(selector).toHaveBeenCalledWith("countProp", 0, 0);
  });

  it("should stop selector at the first prop", () => {
    let maybeFiber: Fiber | null = null;
    instrument({
      onCommitFiberRoot: (_rendererID, fiberRoot) => {
        maybeFiber = fiberRoot.current.child;
      },
    });
    render(<ComplexComponent countProp={1} extraProp={null} />);
    const selector = vi.fn();
    traverseProps(maybeFiber as unknown as Fiber, selector);
    expect(selector).toBeCalledTimes(2);
  });

  it("should stop selector at the first prop", () => {
    let maybeFiber: Fiber | null = null;
    instrument({
      onCommitFiberRoot: (_rendererID, fiberRoot) => {
        maybeFiber = fiberRoot.current.child;
      },
    });
    render(<ComplexComponent countProp={1} extraProp={null} />);
    const selector = vi.fn(() => true);
    traverseProps(maybeFiber as unknown as Fiber, selector);
    expect(selector).toBeCalledTimes(1);
  });

  it("should visit props that only exist on the previous fiber", () => {
    const fiber = createMockFiber({
      alternate: createMockFiber({ memoizedProps: { removedProp: 2, sharedProp: 1 } }),
      memoizedProps: { sharedProp: 1 },
    });
    const selector = vi.fn((propName: string) => propName === "removedProp");
    expect(traverseProps(fiber, selector)).toBe(true);
    expect(selector).toHaveBeenCalledWith("removedProp", undefined, 2);
  });

  it("should return false when no prop is selected", () => {
    const fiber = createMockFiber({
      alternate: createMockFiber({ memoizedProps: { removedProp: 2 } }),
      memoizedProps: { sharedProp: 1 },
    });
    const selector = vi.fn(() => false);
    expect(traverseProps(fiber, selector)).toBe(false);
    expect(selector).toHaveBeenCalledTimes(2);
  });

  it("should default previous props when there is no alternate", () => {
    const fiber = createMockFiber({ memoizedProps: { onlyProp: 1 } });
    const selector = vi.fn();
    expect(traverseProps(fiber, selector)).toBe(false);
    expect(selector).toHaveBeenCalledWith("onlyProp", 1, undefined);
  });
});

describe("traverseState", () => {
  it("should return the state of the fiber", () => {
    let maybeFiber: Fiber | null = null;
    instrument({
      onCommitFiberRoot: (_rendererID, fiberRoot) => {
        maybeFiber = fiberRoot.current.child;
      },
    });
    render(<ComplexComponent countProp={1} />);
    const states: { next: unknown; prev: unknown }[] = [];
    const selector = vi.fn((nextState, prevState) => {
      states.push({
        next: nextState.memoizedState,
        prev: prevState.memoizedState,
      });
    });
    traverseState(maybeFiber as unknown as Fiber, selector);
    expect(states[0].next).toEqual(1);
    expect(states[0].prev).toEqual(0);
    expect(states[1].next).toEqual(0);
    expect(states[1].prev).toEqual(0);
  });

  it("should call selector many times for a fiber with multiple states", () => {
    let maybeFiber: Fiber | null = null;
    instrument({
      onCommitFiberRoot: (_rendererID, fiberRoot) => {
        maybeFiber = fiberRoot.current.child;
      },
    });
    render(<ComplexComponent countProp={1} />);
    const selector = vi.fn();
    traverseState(maybeFiber as unknown as Fiber, selector);
    expect(selector).toBeCalledTimes(3);
  });

  it("should stop selector at the first state", () => {
    let maybeFiber: Fiber | null = null;
    instrument({
      onCommitFiberRoot: (_rendererID, fiberRoot) => {
        maybeFiber = fiberRoot.current.child;
      },
    });
    render(<ComplexComponent countProp={1} />);
    const selector = vi.fn(() => true);
    traverseState(maybeFiber as unknown as Fiber, selector);
    expect(selector).toBeCalledTimes(1);
  });
});

describe("traverseContexts", () => {
  it("should return the contexts of the fiber", () => {
    let maybeFiber: Fiber | null = null;
    instrument({
      onCommitFiberRoot: (_rendererID, fiberRoot) => {
        maybeFiber = fiberRoot.current.child.child;
      },
    });
    render(
      <Context1.Provider value={1}>
        <ComplexComponent countProp={1} />
      </Context1.Provider>,
    );
    const contexts: ContextDependency<unknown>[] = [];
    const selector = vi.fn((context) => {
      contexts.push(context);
    });
    traverseContexts(maybeFiber as unknown as Fiber, selector);
    expect(contexts).toHaveLength(2);
    expect(contexts[0].context).toBe(Context1);
    expect(contexts[0].memoizedValue).toBe(1);
    expect(contexts[1].context).toBe(Context2);
    expect(contexts[1].memoizedValue).toBe(0);
  });

  it("should stop selector at the first context", () => {
    let maybeFiber: Fiber | null = null;
    instrument({
      onCommitFiberRoot: (_rendererID, fiberRoot) => {
        maybeFiber = fiberRoot.current.child;
      },
    });
    render(<ComplexComponent countProp={1} />);
    const selector = vi.fn(() => true);
    traverseContexts(maybeFiber as unknown as Fiber, selector);
    expect(selector).toBeCalledTimes(1);
  });

  it("should return false when the fiber has no dependencies", () => {
    const fiber = createMockFiber({
      alternate: createMockFiber({ dependencies: { firstContext: null } }),
      dependencies: null,
    });
    const selector = vi.fn();
    expect(traverseContexts(fiber, selector)).toBe(false);
    expect(selector).not.toHaveBeenCalled();
  });

  it("should return false when dependencies have no firstContext", () => {
    const fiber = createMockFiber({
      alternate: createMockFiber({ dependencies: {} }),
      dependencies: {},
    });
    const selector = vi.fn();
    expect(traverseContexts(fiber, selector)).toBe(false);
    expect(selector).not.toHaveBeenCalled();
  });

  it("should keep traversing when only the previous fiber has contexts", () => {
    const fiber = createMockFiber({
      alternate: createMockFiber({
        dependencies: { firstContext: { memoizedValue: 1, next: null } },
      }),
      dependencies: { firstContext: null },
    });
    const selector = vi.fn();
    expect(traverseContexts(fiber, selector)).toBe(false);
    expect(selector).toHaveBeenCalledWith(null, { memoizedValue: 1, next: null });
  });
});

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
        maybeFiber = fiberRoot.current.child?.child;
      },
    });
    render(<Example />);
    const selector = vi.fn((fiber) => fiber.tag === 3);
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
        maybeFiber = fiberRoot.current.child?.child;
      },
    });
    render(<Example />);
    const selector = vi.fn(async (fiber) => fiber.tag === 3);
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
    expect(traverseFiberSync(null, () => true)).toBe(null);
    expect(await traverseFiberAsync(null, async () => true)).toBe(null);
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

  it("should return null when no node matches (sync descending)", () => {
    const targetSibling = createMockFiber();
    const firstChild = createMockFiber({ sibling: targetSibling });
    const rootFiber = createMockFiber({ child: firstChild });
    expect(traverseFiber(rootFiber, () => false)).toBe(null);
  });

  it("should traverse nested siblings in traverseFiberAsync (descending)", async () => {
    const targetSibling = createMockFiber();
    const firstGrandchild = createMockFiber({ sibling: targetSibling });
    const childFiber = createMockFiber({ child: firstGrandchild });
    const rootFiber = createMockFiber({ child: childFiber });
    const result = await traverseFiberAsync(rootFiber, async (fiber) => fiber === targetSibling);
    expect(result).toBe(targetSibling);
  });

  it("should return null in traverseFiberAsync when ascending finds no match", async () => {
    const rootFiber = createMockFiber();
    const parentFiber = createMockFiber({ return: rootFiber });
    const childFiber = createMockFiber({ return: parentFiber });
    const result = await traverseFiberAsync(childFiber, async () => false, true);
    expect(result).toBe(null);
  });
});
