import {
  didFiberRender,
  getReactWorkTags,
  traverseFiber,
  traverseRenderedFibers,
  type Fiber,
} from "bippy";
import { describe, expect, it } from "vite-plus/test";
import { createFiber, linkChildren } from "./fiber-fixture.js";

const workTags = getReactWorkTags();

describe("traverseFiber adversarial trees", () => {
  it.each(["child", "sibling"])("walks 20000 %s links without recursion", (direction) => {
    const root = createFiber();
    let lastFiber = root;
    for (let index = 0; index < 20000; index++) {
      const nextFiber = createFiber();
      if (direction === "sibling" && lastFiber === root) root.child = nextFiber;
      else Reflect.set(lastFiber, direction, nextFiber);
      lastFiber = nextFiber;
    }
    let visits = 0;
    expect(
      traverseFiber(root, () => {
        visits++;
      }),
    ).toBeNull();
    expect(visits).toBe(20001);
    expect(traverseFiber(root, (fiber) => fiber === lastFiber)).toBe(lastFiber);
  });

  it("walks deep ancestry without traversing ancestor siblings", () => {
    let child = createFiber();
    const leaf = child;
    for (let depth = 0; depth < 20000; depth++) {
      const parent = createFiber({ sibling: createFiber() });
      linkChildren(parent, [child]);
      child = parent;
    }
    let visits = 0;
    expect(
      traverseFiber(
        leaf,
        () => {
          visits++;
        },
        true,
      ),
    ).toBeNull();
    expect(visits).toBe(20001);
  });

  it("preserves depth-first order and stops at the subtree boundary", async () => {
    const root = createFiber({ sibling: createFiber() });
    const firstChild = createFiber();
    const grandchild = createFiber();
    const secondChild = createFiber();
    linkChildren(root, [firstChild, secondChild]);
    linkChildren(firstChild, [grandchild]);
    const visited: Fiber[] = [];
    const result = await traverseFiber(root, (fiber) => {
      visited.push(fiber);
      if (fiber === firstChild) return Promise.resolve(false);
      return fiber === secondChild;
    });
    expect(result).toBe(secondChild);
    expect(visited).toEqual([root, firstChild, grandchild, secondChild]);
  });

  it("propagates asynchronous selector failures without visiting later siblings", async () => {
    const root = createFiber();
    const children = [createFiber(), createFiber()];
    linkChildren(root, children);
    const visited: Fiber[] = [];
    const failure = new Error("selector failed");
    await expect(
      traverseFiber(root, (fiber) => {
        visited.push(fiber);
        return fiber === children[0] ? Promise.reject(failure) : false;
      }),
    ).rejects.toBe(failure);
    expect(visited).toEqual([root, children[0]]);
  });
});

describe("Suspense visible child sets", () => {
  it.each([false, true])("visits all siblings when timed out = %s", (isTimedOut) => {
    const primaryChildren = [createFiber(), createFiber(), createFiber()];
    const fallbackChildren = [createFiber(), createFiber(), createFiber()];
    const primary = createFiber({ tag: workTags.OffscreenComponent });
    const fallback = createFiber({ tag: workTags.Fragment });
    const suspense = createFiber({ tag: workTags.SuspenseComponent });
    if (isTimedOut) Reflect.set(suspense, "memoizedState", { dehydrated: null });
    linkChildren(primary, primaryChildren);
    linkChildren(fallback, fallbackChildren);
    linkChildren(suspense, [primary, fallback]);
    const visited: Fiber[] = [];
    traverseRenderedFibers(suspense, (fiber, phase) => {
      expect(phase).toBe("mount");
      visited.push(fiber);
    });
    expect(visited).toEqual([suspense, ...(isTimedOut ? fallbackChildren : primaryChildren)]);
  });
});

describe("DevTools change detection", () => {
  it.each([null, false, 0, "", undefined])(
    "does not invent changes for equal %s props",
    (props) => {
      const previous = createFiber({ tag: workTags.HostRoot });
      const current = createFiber({ tag: workTags.HostRoot, alternate: previous });
      Reflect.set(previous, "memoizedProps", props);
      Reflect.set(current, "memoizedProps", props);
      expect(didFiberRender(current)).toBe(false);
    },
  );

  it.each([
    workTags.FunctionComponent,
    workTags.ClassComponent,
    workTags.ContextConsumer,
    workTags.ForwardRef,
    workTags.MemoComponent,
    workTags.SimpleMemoComponent,
  ])("uses PerformedWork, not changed props, for composite tag %s", (tag) => {
    const previous = createFiber({ tag });
    const current = createFiber({ tag, alternate: previous, flags: 0 });
    expect(didFiberRender(current)).toBe(false);
    current.flags = 1;
    expect(didFiberRender(current)).toBe(true);
  });
});
