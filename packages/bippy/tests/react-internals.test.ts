import { expect, expectTypeOf, it } from "vite-plus/test";
import {
  getReactWorkTagsForFiber,
  getReactWorkTagsForRenderer,
  getReactWorkTags,
  setReactWorkTagsForFiber,
} from "../src/react-internals/index.js";
import type { Fiber, ReactRenderer } from "../src/react-internals/index.js";

it("selects React work tags by their version baseline", () => {
  const react16WorkTags = getReactWorkTags("16.0.0");
  const react164WorkTags = getReactWorkTags("16.4.3-alpha");
  const react166WorkTags = getReactWorkTags("16.6.0-beta.0");
  const react17AlphaWorkTags = getReactWorkTags("17.0.0-alpha");
  const latestWorkTags = getReactWorkTags("17.0.2");

  expect(getReactWorkTags("16.4.2")).toBe(react16WorkTags);
  expect(getReactWorkTags("16.6.0-alpha")).toBe(react164WorkTags);
  expect(getReactWorkTags("16.6.0-beta.0")).toBe(react166WorkTags);
  expect(getReactWorkTags("17.0.1")).toBe(react17AlphaWorkTags);
  expect(getReactWorkTags("17.0.1+build.1")).toBe(react17AlphaWorkTags);
  expect(getReactWorkTags("17.0.2-rc.0")).toBe(latestWorkTags);
  expect(getReactWorkTags("18.3.1")).toBe(latestWorkTags);
  expect(getReactWorkTags("19.2.0-canary")).toBe(latestWorkTags);
  expect(getReactWorkTags("invalid")).toBe(latestWorkTags);
  expect(getReactWorkTags()).toBe(latestWorkTags);
});

it("preserves AOT literal types for known React work-tag baselines", () => {
  const dynamicVersion: string = "17.0.2";
  expectTypeOf(getReactWorkTags("17.0.2").HostRoot).toEqualTypeOf<3>();
  expectTypeOf(getReactWorkTags(dynamicVersion).HostRoot).toEqualTypeOf<number>();
});

it("prefers the renderer reconciler version", () => {
  const rendererVersion: ReactRenderer = {
    bundleType: 1,
    rendererPackageName: "test-renderer",
    version: "17.0.1",
  };
  const reconcilerVersion: ReactRenderer = {
    bundleType: 1,
    reconcilerVersion: "19.2.0",
    rendererPackageName: "test-renderer",
    version: "17.0.1",
  };

  expect(getReactWorkTagsForRenderer(rendererVersion)).toBe(getReactWorkTags("17.0.0-alpha"));
  expect(getReactWorkTagsForRenderer(reconcilerVersion)).toBe(getReactWorkTags("17.0.2"));
  expect(getReactWorkTagsForRenderer({ ...rendererVersion, reconcilerVersion: "not-semver" })).toBe(
    getReactWorkTags("17.0.0-alpha"),
  );
  expect(getReactWorkTagsForRenderer()).toBe(getReactWorkTags());
});

it("retains old renderer work tags after a Fiber is detached", () => {
  const rootFiber: Fiber = {
    alternate: null,
    child: null,
    childLanes: 0,
    deletions: null,
    dependencies: null,
    elementType: null,
    firstEffect: null,
    flags: 0,
    index: 0,
    key: null,
    lanes: 0,
    lastEffect: null,
    memoizedProps: {},
    memoizedState: null,
    mode: 0,
    nextEffect: null,
    pendingProps: {},
    ref: null,
    return: null,
    sibling: null,
    stateNode: null,
    subtreeFlags: 0,
    tag: getReactWorkTags("17.0.0-alpha").HostRoot,
    type: null,
    updateQueue: null,
  };
  const childFiber: Fiber = {
    ...rootFiber,
    return: rootFiber,
    tag: getReactWorkTags("17.0.0-alpha").FunctionComponent,
  };
  rootFiber.child = childFiber;
  const renderer: ReactRenderer = {
    bundleType: 1,
    rendererPackageName: "react-17-renderer",
    version: "17.0.1",
  };

  setReactWorkTagsForFiber(rootFiber, renderer);
  expect(getReactWorkTagsForFiber(childFiber)).toBe(getReactWorkTags("17.0.0-alpha"));
  childFiber.return = null;
  expect(getReactWorkTagsForFiber(childFiber)).toBe(getReactWorkTags("17.0.0-alpha"));
});
