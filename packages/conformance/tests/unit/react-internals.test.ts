import { expect, expectTypeOf, it, vi } from "vite-plus/test";
import { createFiber, linkChildren } from "../fiber-fixture.js";
import {
  compareSemver,
  getReactWorkTagsForFiber,
  getReactWorkTagsForRenderer,
  getReactWorkTags,
  MutationMask,
  ReactBuildType,
  ReactFiberFlags,
  ReactSymbols,
  setReactWorkTagsForFiber,
} from "../../../bippy/src/index.js";
import type {
  Fiber,
  FiberRoot,
  ReactDevToolsGlobalHook,
  ReactRenderer,
  RendererDispatcherRef,
} from "../../../bippy/src/index.js";

const createRenderer = (version: string): ReactRenderer => ({
  bundleType: 1,
  rendererPackageName: "test-renderer",
  version,
});

it("updates cached descendants and alternates after late renderer association", () => {
  const previousRoot = createFiber();
  const nextRoot = createFiber({ alternate: previousRoot });
  previousRoot.alternate = nextRoot;
  const previousChild = createFiber();
  const nextChild = createFiber({ alternate: previousChild });
  previousChild.alternate = nextChild;
  linkChildren(previousRoot, [previousChild]);
  linkChildren(nextRoot, [nextChild]);
  const grandchild = createFiber();
  linkChildren(nextChild, [grandchild]);

  expect(getReactWorkTagsForFiber(grandchild)).toBe(getReactWorkTags());
  expect(getReactWorkTagsForFiber(previousChild)).toBe(getReactWorkTags());
  setReactWorkTagsForFiber(nextRoot, createRenderer("16.0.0"));
  for (const fiber of [previousRoot, nextRoot, previousChild, nextChild, grandchild]) {
    expect(getReactWorkTagsForFiber(fiber)).toBe(getReactWorkTags("16.0.0"));
  }
});

it("refreshes inherited tags when a renderer association changes", () => {
  const root = createFiber();
  const child = createFiber();
  linkChildren(root, [child]);
  for (const version of ["19.2.4", "16.0.0", "17.0.1", "19.2.4"]) {
    setReactWorkTagsForFiber(root, createRenderer(version));
    expect(getReactWorkTagsForFiber(child)).toBe(getReactWorkTags(version));
  }
});

it("keeps explicit subtree and unrelated root associations independent", () => {
  const root = createFiber();
  const child = createFiber();
  const sibling = createFiber();
  const grandchild = createFiber();
  const unrelatedRoot = createFiber();
  const unrelatedChild = createFiber();
  linkChildren(root, [child, sibling]);
  linkChildren(child, [grandchild]);
  linkChildren(unrelatedRoot, [unrelatedChild]);
  setReactWorkTagsForFiber(root, createRenderer("19.2.4"));
  setReactWorkTagsForFiber(unrelatedRoot, createRenderer("17.0.1"));
  expect(getReactWorkTagsForFiber(grandchild)).toBe(getReactWorkTags());
  expect(getReactWorkTagsForFiber(unrelatedChild)).toBe(getReactWorkTags("17.0.1"));

  setReactWorkTagsForFiber(child, createRenderer("16.0.0"));
  expect(getReactWorkTagsForFiber(grandchild)).toBe(getReactWorkTags("16.0.0"));
  expect(getReactWorkTagsForFiber(sibling)).toBe(getReactWorkTags());
  expect(getReactWorkTagsForFiber(unrelatedChild)).toBe(getReactWorkTags("17.0.1"));
  setReactWorkTagsForFiber(root, createRenderer("17.0.1"));
  expect(getReactWorkTagsForFiber(grandchild)).toBe(getReactWorkTags("16.0.0"));
  expect(getReactWorkTagsForFiber(sibling)).toBe(getReactWorkTags("17.0.1"));
});

it("retains detached tags when another root is associated", () => {
  const root = createFiber();
  const child = createFiber();
  linkChildren(root, [child]);
  setReactWorkTagsForFiber(root, createRenderer("16.0.0"));
  expect(getReactWorkTagsForFiber(child)).toBe(getReactWorkTags("16.0.0"));
  child.return = null;
  setReactWorkTagsForFiber(createFiber(), createRenderer("19.2.4"));
  expect(getReactWorkTagsForFiber(child)).toBe(getReactWorkTags("16.0.0"));
});

it("does not invalidate inherited tags for unchanged renderer associations", () => {
  const root = createFiber();
  const child = createFiber();
  const getParent = vi.fn(() => root);
  Object.defineProperty(child, "return", { get: getParent });
  setReactWorkTagsForFiber(root, createRenderer("16.0.0"));
  getReactWorkTagsForFiber(child);
  getParent.mockClear();
  setReactWorkTagsForFiber(root, createRenderer("16.0.0"));
  expect(getReactWorkTagsForFiber(child)).toBe(getReactWorkTags("16.0.0"));
  expect(getParent).not.toHaveBeenCalled();
});

it("exports React internals from the main entry point", () => {
  expect(compareSemver("18.0.0", "19.0.0")).toBe(-1);
  expect(ReactBuildType.Production).toBe(0);
  expect(ReactFiberFlags.Placement).toBe(2);
  expect(ReactSymbols.LEGACY_ELEMENT_SYMBOL_STRING).toBe("Symbol(react.element)");
  expect(MutationMask & ReactFiberFlags.Update).toBe(ReactFiberFlags.Update);
  expectTypeOf<FiberRoot>().toHaveProperty("current");
  expectTypeOf<ReactDevToolsGlobalHook>().toHaveProperty("renderers");
  expectTypeOf<RendererDispatcherRef>().toBeObject();
});

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

it("resolves experimental-channel versions to the modern work tags", () => {
  const experimentalRenderer: ReactRenderer = {
    bundleType: 1,
    rendererPackageName: "react-dom",
    version: "0.0.0-experimental-241c4467e-20200129",
  };

  expect(getReactWorkTagsForRenderer(experimentalRenderer)).toBe(getReactWorkTags());
  expect(
    getReactWorkTagsForRenderer({
      ...experimentalRenderer,
      reconcilerVersion: "0.0.0-experimental-241c4467e-20200129",
    }),
  ).toBe(getReactWorkTags());
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
