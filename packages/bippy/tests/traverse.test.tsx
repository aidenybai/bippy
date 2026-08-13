import "../src/index.js"; // HACK: Bippy must initialize before imports that load React.

import { describe, expect, it, vi } from "vite-plus/test";
import type { ContextDependency, Fiber } from "../src/react-internals/index.js";
import {
  instrument,
  traverseContexts,
  traverseFiber,
  traverseProps,
  traverseState,
} from "../src/index.js";
import { latestReactWorkTags } from "./react-work-tags.js";
import { createFiber } from "./create-fiber.js";
import { requireFiber } from "./require-fiber.js";
import React from "react";
import { render } from "@testing-library/react";

export const Context1 = React.createContext(0);
export const Context2 = React.createContext(0);

export const Example = () => {
  return <div>Hello</div>;
};

interface ComplexComponentProps {
  countProp?: number;
  extraProp?: unknown;
}

export const ComplexComponent = ({ countProp = 0 }: ComplexComponentProps) => {
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
    traverseProps(requireFiber(maybeFiber, "React DOM did not render a Fiber"), selector);
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
    traverseProps(requireFiber(maybeFiber, "React DOM did not render a Fiber"), selector);
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
    traverseProps(requireFiber(maybeFiber, "React DOM did not render a Fiber"), selector);
    expect(selector).toBeCalledTimes(1);
  });

  it("should visit props that only exist on the previous fiber", () => {
    const fiber = createFiber({
      alternate: createFiber({ memoizedProps: { removedProp: 2, sharedProp: 1 } }),
      memoizedProps: { sharedProp: 1 },
    });
    const selector = vi.fn((propName: string) => propName === "removedProp");
    expect(traverseProps(fiber, selector)).toBe(true);
    expect(selector).toHaveBeenCalledWith("removedProp", undefined, 2);
  });

  it("should return false when no prop is selected", () => {
    const fiber = createFiber({
      alternate: createFiber({ memoizedProps: { removedProp: 2 } }),
      memoizedProps: { sharedProp: 1 },
    });
    const selector = vi.fn(() => false);
    expect(traverseProps(fiber, selector)).toBe(false);
    expect(selector).toHaveBeenCalledTimes(2);
  });

  it("should default previous props when there is no alternate", () => {
    const fiber = createFiber({ memoizedProps: { onlyProp: 1 } });
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
    traverseState(requireFiber(maybeFiber, "React DOM did not render a Fiber"), selector);
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
    traverseState(requireFiber(maybeFiber, "React DOM did not render a Fiber"), selector);
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
    traverseState(requireFiber(maybeFiber, "React DOM did not render a Fiber"), selector);
    expect(selector).toBeCalledTimes(1);
  });
});

describe("traverseContexts", () => {
  it("should return the contexts of the fiber", () => {
    let maybeFiber: Fiber | null = null;
    instrument({
      onCommitFiberRoot: (_rendererID, fiberRoot) => {
        const componentFiber = fiberRoot.current.child;
        if (!componentFiber) throw new Error("React DOM did not render the provider child");
        maybeFiber = componentFiber.child;
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
    traverseContexts(requireFiber(maybeFiber, "React DOM did not render a Fiber"), selector);
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
    traverseContexts(requireFiber(maybeFiber, "React DOM did not render a Fiber"), selector);
    expect(selector).toBeCalledTimes(1);
  });

  it("should return false when the fiber has no dependencies", () => {
    const fiber = createFiber({
      alternate: createFiber({ dependencies: { firstContext: null } }),
      dependencies: null,
    });
    const selector = vi.fn();
    expect(traverseContexts(fiber, selector)).toBe(false);
    expect(selector).not.toHaveBeenCalled();
  });

  it("should return false when dependencies have no firstContext", () => {
    const fiber = createFiber({
      alternate: createFiber({ dependencies: {} }),
      dependencies: {},
    });
    const selector = vi.fn();
    expect(traverseContexts(fiber, selector)).toBe(false);
    expect(selector).not.toHaveBeenCalled();
  });

  it("should keep traversing when only the previous fiber has contexts", () => {
    const fiber = createFiber({
      alternate: createFiber({
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
    expect(
      traverseFiber(
        requireFiber(maybeFiber, "React DOM did not render a Fiber"),
        (fiber) => fiber.type === "div",
      ),
    ).toBe(requireFiber(maybeFiber, "React DOM did not render a Fiber")?.child);
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
    const result = traverseFiber(
      requireFiber(maybeFiber, "React DOM did not render a Fiber"),
      selector,
    );
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
    const result = traverseFiber(
      requireFiber(maybeFiber, "React DOM did not render a Fiber"),
      selector,
      true,
    );
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
    const result = await traverseFiber(
      requireFiber(maybeFiber, "React DOM did not render a Fiber"),
      selector,
    );
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
    const result = await traverseFiber(
      requireFiber(maybeFiber, "React DOM did not render a Fiber"),
      selector,
      true,
    );
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
    const result = traverseFiber(
      requireFiber(maybeFiber, "React DOM did not render a Fiber"),
      selector,
    );
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
    const result = traverseFiber(
      requireFiber(maybeFiber, "React DOM did not render a Fiber"),
      selector,
      true,
    );
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
    const result = await traverseFiber(
      requireFiber(maybeFiber, "React DOM did not render a Fiber"),
      selector,
    );
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
    const result = await traverseFiber(
      requireFiber(maybeFiber, "React DOM did not render a Fiber"),
      selector,
      true,
    );
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
    const result = await traverseFiber(
      requireFiber(maybeFiber, "React DOM did not render a Fiber"),
      async () => false,
    );
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
    const result = await traverseFiber(
      requireFiber(maybeFiber, "React DOM did not render a Fiber"),
      async () => false,
      true,
    );
    expect(result).toBe(null);
  });

  it("should traverse siblings when the first async subtree does not match", async () => {
    const targetSibling = createFiber();
    const firstChild = createFiber({ sibling: targetSibling });
    const rootFiber = createFiber({ child: firstChild });
    const result = await traverseFiber(rootFiber, async (fiber) => fiber === targetSibling);
    expect(result).toBe(targetSibling);
  });

  it("should await promises returned after synchronous selector results", async () => {
    const targetFiber = createFiber();
    const rootFiber = createFiber({ child: targetFiber });
    const result = traverseFiber(rootFiber, (fiber) =>
      fiber === rootFiber ? false : Promise.resolve(fiber === targetFiber),
    );
    expect(await result).toBe(targetFiber);
  });

  it("should return null when no node matches (sync descending)", () => {
    const targetSibling = createFiber();
    const firstChild = createFiber({ sibling: targetSibling });
    const rootFiber = createFiber({ child: firstChild });
    expect(traverseFiber(rootFiber, () => false)).toBe(null);
  });

  it("should traverse nested siblings with an async selector (descending)", async () => {
    const targetSibling = createFiber();
    const firstGrandchild = createFiber({ sibling: targetSibling });
    const childFiber = createFiber({ child: firstGrandchild });
    const rootFiber = createFiber({ child: childFiber });
    const result = await traverseFiber(rootFiber, async (fiber) => fiber === targetSibling);
    expect(result).toBe(targetSibling);
  });

  it("should return null with an async selector when ascending finds no match", async () => {
    const rootFiber = createFiber();
    const parentFiber = createFiber({ return: rootFiber });
    const childFiber = createFiber({ return: parentFiber });
    const result = await traverseFiber(childFiber, async () => false, true);
    expect(result).toBe(null);
  });
});
