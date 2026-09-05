import {
  getFiber,
  getLatestFiber,
  getReactWorkTags,
  getReactWorkTagsForFiber,
  setReactWorkTagsForFiber,
  type Fiber,
} from "bippy";
import { expect, it } from "vite-plus/test";
import { createFiber, linkChildren } from "./fiber-fixture.js";

it("reuses cached ancestor work tags with linear parent reads", () => {
  const root = createFiber({ tag: getReactWorkTags().HostRoot });
  setReactWorkTagsForFiber(root, {
    version: "19.2.4",
    bundleType: 1,
    rendererPackageName: "react-dom",
  });
  const fibers: Fiber[] = [root];
  let parentReads = 0;
  for (let depth = 0; depth < 1000; depth++) {
    const parent = fibers[fibers.length - 1];
    const child = createFiber();
    Object.defineProperty(child, "return", {
      get: () => {
        parentReads++;
        return parent;
      },
    });
    fibers.push(child);
  }
  for (const fiber of fibers) expect(getReactWorkTagsForFiber(fiber).HostComponent).toBe(5);
  expect(parentReads).toBeLessThan(4000);
});

it("does not cache invalid host-instance property names", () => {
  for (let index = 0; index < 500; index++) {
    expect(getFiber({ [`__reactFiber$invalid${index}`]: null })).toBeNull();
  }
  let poisonedKeyReads = 0;
  const host = new Proxy(
    {},
    {
      get: (_target, property) => {
        if (typeof property === "string" && property.startsWith("__reactFiber$invalid"))
          poisonedKeyReads++;
        return undefined;
      },
    },
  );
  expect(getFiber(host)).toBeNull();
  expect(poisonedKeyReads).toBe(0);
});

it("resolves a current alternate without scanning unrelated subtrees", () => {
  const previousRoot = createFiber({ tag: getReactWorkTags().HostRoot });
  const currentRoot = createFiber({ tag: getReactWorkTags().HostRoot, alternate: previousRoot });
  previousRoot.alternate = currentRoot;
  const root = { current: currentRoot };
  previousRoot.stateNode = currentRoot.stateNode = root;
  const previous = createFiber();
  const current = createFiber({ alternate: previous });
  previous.alternate = current;
  const unrelated = Array.from({ length: 2000 }, () => createFiber());
  linkChildren(previousRoot, [previous]);
  linkChildren(currentRoot, [...unrelated, current]);
  let unrelatedReads = 0;
  for (const fiber of unrelated) {
    Object.defineProperty(fiber, "child", {
      get: () => {
        unrelatedReads++;
        return null;
      },
    });
  }
  expect(getLatestFiber(previous)).toBe(current);
  expect(unrelatedReads).toBe(0);
});
