import { getLatestFiber, getReactWorkTags } from "bippy";
import { expect, it } from "vite-plus/test";
import { createFiber, linkChildren } from "./fiber-fixture.js";

it.each(["separate", "previous", "current"])(
  "resolves both alternates with %s return pointers across root swaps",
  (returnMode) => {
    const previousRoot = createFiber({ tag: getReactWorkTags().HostRoot });
    const currentRoot = createFiber({ tag: getReactWorkTags().HostRoot, alternate: previousRoot });
    previousRoot.alternate = currentRoot;
    const root = { current: currentRoot };
    previousRoot.stateNode = currentRoot.stateNode = root;
    const previousParent = createFiber();
    const currentParent = createFiber({ alternate: previousParent });
    previousParent.alternate = currentParent;
    linkChildren(previousRoot, [previousParent]);
    linkChildren(currentRoot, [currentParent]);
    const previousChild = createFiber();
    const currentChild = createFiber({ alternate: previousChild });
    previousChild.alternate = currentChild;
    linkChildren(previousParent, [createFiber(), previousChild]);
    linkChildren(currentParent, [createFiber(), currentChild]);
    if (returnMode === "previous") currentChild.return = previousParent;
    if (returnMode === "current") previousChild.return = currentParent;
    for (let iteration = 0; iteration < 8; iteration++) {
      const isCurrent = iteration % 2 === 0;
      root.current = isCurrent ? currentRoot : previousRoot;
      const expected = isCurrent ? currentChild : previousChild;
      expect(getLatestFiber(previousChild)).toBe(expected);
      expect(getLatestFiber(currentChild)).toBe(expected);
    }
  },
);

it("keeps a shared bailout child current even when its return points to the other root", () => {
  const previousRoot = createFiber({ tag: getReactWorkTags().HostRoot });
  const currentRoot = createFiber({ tag: getReactWorkTags().HostRoot, alternate: previousRoot });
  previousRoot.alternate = currentRoot;
  const root = { current: currentRoot };
  previousRoot.stateNode = currentRoot.stateNode = root;
  const previousChild = createFiber({ return: previousRoot });
  const currentChild = createFiber({ alternate: previousChild });
  previousChild.alternate = currentChild;
  linkChildren(previousRoot, [currentChild]);
  currentRoot.child = currentChild;
  expect(getLatestFiber(previousChild)).toBe(currentChild);
  expect(getLatestFiber(currentChild)).toBe(currentChild);
});

it("skips a Suspense fragment without an alternate", () => {
  const previousRoot = createFiber({ tag: getReactWorkTags().HostRoot });
  const currentRoot = createFiber({ tag: getReactWorkTags().HostRoot, alternate: previousRoot });
  previousRoot.alternate = currentRoot;
  const root = { current: currentRoot };
  previousRoot.stateNode = currentRoot.stateNode = root;
  const fragment = createFiber({ tag: getReactWorkTags().Fragment });
  const previousChild = createFiber();
  const currentChild = createFiber({ alternate: previousChild });
  previousChild.alternate = currentChild;
  linkChildren(previousRoot, [previousChild]);
  linkChildren(currentRoot, [fragment]);
  linkChildren(fragment, [currentChild]);
  expect(getLatestFiber(previousChild)).toBe(currentChild);
  expect(getLatestFiber(currentChild)).toBe(currentChild);
});
