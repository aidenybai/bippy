import { describe, expect, it } from "vite-plus/test";
import {
  flattenTransparentFibers,
  NEXT_APP_PROFILE,
  NEXT_PAGES_PROFILE,
} from "../src/frameworks/index.js";
import {
  formatRuntimeSnapshot,
  type RuntimeFiberSnapshot,
  type RuntimeSnapshot,
  type SnapshotWorkTag,
} from "../src/harness/index.js";

const fiber = (
  name: string,
  tag: SnapshotWorkTag,
  children: RuntimeFiberSnapshot[] = [],
  props: RuntimeFiberSnapshot["props"] = {},
): RuntimeFiberSnapshot => ({ tag, name, key: null, text: null, props, children });

const component = (name: string, ...children: RuntimeFiberSnapshot[]): RuntimeFiberSnapshot =>
  fiber(name, "FunctionComponent", children);

const host = (name: string, ...children: RuntimeFiberSnapshot[]): RuntimeFiberSnapshot =>
  fiber(name, "HostComponent", children);

const snapshot = (...children: RuntimeFiberSnapshot[]): RuntimeSnapshot => ({
  reactVersion: null,
  rendererName: null,
  buildType: null,
  roots: [fiber("HostRoot", "HostRoot", children)],
  capturedAt: "",
});

const lines = (flattened: RuntimeSnapshot): string[] =>
  flattened.roots.flatMap((root) =>
    formatRuntimeSnapshot(root)
      .split("\n")
      .map((line) => line.trim()),
  );

describe("next pages router runtime profile", () => {
  const announcerPortal = fiber(
    "Portal",
    "FunctionComponent",
    [fiber("Portal", "HostPortal", [component("RouteAnnouncer", host("p"))])],
    { type: "next-route-announcer" },
  );
  const app = component("MyApp", component("Index", host("main")));

  it("splices out Root's StrictMode and head-commit observer, keeps the page's next/head", () => {
    const runtime = snapshot(
      component(
        "Root",
        fiber("StrictMode", "Mode", [
          fiber("Head", "FunctionComponent", [], { callback: "[function]" }),
          component(
            "AppContainer",
            component("MyApp", component("Meta", component("Head", component("SideEffect")))),
            announcerPortal,
          ),
        ]),
      ),
    );
    expect(lines(flattenTransparentFibers(runtime, NEXT_PAGES_PROFILE))).toEqual([
      "<HostRoot> [HostRoot]",
      "<MyApp> [FunctionComponent]",
      "<Meta> [FunctionComponent]",
      "<Head> [FunctionComponent]",
      "<SideEffect> [FunctionComponent]",
    ]);
  });

  it("drops the route announcer portal without strict mode", () => {
    const runtime = snapshot(
      component("Root", component("Head"), component("AppContainer", app, announcerPortal)),
    );
    expect(lines(flattenTransparentFibers(runtime, NEXT_PAGES_PROFILE))).toEqual([
      "<HostRoot> [HostRoot]",
      "<MyApp> [FunctionComponent]",
      "<Index> [FunctionComponent]",
      "<main> [HostComponent]",
    ]);
  });

  it("keeps an application's own StrictMode and portals", () => {
    const ownPortal = fiber("Portal", "FunctionComponent", [host("dialog")], { type: "modal" });
    const runtime = snapshot(
      component(
        "Root",
        component(
          "AppContainer",
          component("MyApp", fiber("StrictMode", "Mode", [host("main")]), ownPortal),
        ),
      ),
    );
    expect(lines(flattenTransparentFibers(runtime, NEXT_PAGES_PROFILE))).toEqual([
      "<HostRoot> [HostRoot]",
      "<MyApp> [FunctionComponent]",
      "<StrictMode> [Mode]",
      "<main> [HostComponent]",
      "<Portal> [FunctionComponent]",
      "<dialog> [HostComponent]",
    ]);
  });
});

describe("next app router runtime profile", () => {
  it("splices out the Activity/Offscreen pair OuterLayoutRouter keeps a segment in", () => {
    const runtime = snapshot(
      component(
        "OuterLayoutRouter",
        fiber("Activity", "ActivityComponent", [
          fiber("Offscreen", "OffscreenComponent", [component("Page", host("main"))]),
        ]),
      ),
    );
    expect(lines(flattenTransparentFibers(runtime, NEXT_APP_PROFILE))).toEqual([
      "<HostRoot> [HostRoot]",
      "<Page> [FunctionComponent]",
      "<main> [HostComponent]",
    ]);
  });

  it("keeps an Activity the application renders itself", () => {
    const runtime = snapshot(
      component(
        "OuterLayoutRouter",
        component(
          "Page",
          fiber("Activity", "ActivityComponent", [
            fiber("Offscreen", "OffscreenComponent", [host("aside")]),
          ]),
        ),
      ),
    );
    expect(lines(flattenTransparentFibers(runtime, NEXT_APP_PROFILE))).toEqual([
      "<HostRoot> [HostRoot]",
      "<Page> [FunctionComponent]",
      "<Activity> [ActivityComponent]",
      "<Offscreen> [OffscreenComponent]",
      "<aside> [HostComponent]",
    ]);
  });
});
