import { describe, expect, it } from "vite-plus/test";
import { flattenTransparentFibers } from "../src/frameworks/framework-profile.js";
import { NEXT_PAGES_PROFILE, REACT_ROUTER_PROFILE } from "../src/frameworks/profiles.js";
import type { RuntimeFiberSnapshot, RuntimeSnapshot } from "../src/harness/snapshot.js";

const fiber = (
  tag: RuntimeFiberSnapshot["tag"],
  name: string,
  children: RuntimeFiberSnapshot[] = [],
  props: RuntimeFiberSnapshot["props"] = {},
): RuntimeFiberSnapshot => ({ tag, name, key: null, text: null, props, children });

const snapshotOf = (children: RuntimeFiberSnapshot[]): RuntimeSnapshot => ({
  reactVersion: "19.0.0",
  rendererName: "react-dom",
  buildType: "development",
  roots: [fiber("HostRoot", "HostRoot", children)],
  capturedAt: "1970-01-01T00:00:00.000Z",
});

const describeTree = (fibers: RuntimeFiberSnapshot[]): string[] =>
  fibers.flatMap((inner) => [
    `${inner.name}[${inner.tag}]`,
    ...describeTree(inner.children).map((line) => `  ${line}`),
  ]);

describe("framework profiles", () => {
  it("splices out a framework context provider but keeps an application component of the same name", () => {
    const snapshot = snapshotOf([
      fiber("FunctionComponent", "BrowserRouter", [
        fiber("FunctionComponent", "Router", [
          fiber("ContextProvider", "Navigation", [
            fiber("ContextProvider", "Location", [
              fiber("FunctionComponent", "App", [
                fiber("FunctionComponent", "Navigation", [fiber("HostComponent", "nav")]),
              ]),
            ]),
          ]),
        ]),
      ]),
    ]);
    const flattened = flattenTransparentFibers(snapshot, REACT_ROUTER_PROFILE);
    expect(describeTree(flattened.roots[0]?.children ?? [])).toEqual([
      "BrowserRouter[FunctionComponent]",
      "  App[FunctionComponent]",
      "    Navigation[FunctionComponent]",
      "      nav[HostComponent]",
    ]);
  });

  it("drops the pages router's dummy Head and route announcer but keeps the application's next/head", () => {
    const snapshot = snapshotOf([
      fiber("FunctionComponent", "Root", [
        fiber("FunctionComponent", "Head", [], { callback: "[function]" }),
        fiber("FunctionComponent", "AppContainer", [
          fiber("FunctionComponent", "App", [
            fiber("FunctionComponent", "Head", [fiber("FunctionComponent", "SideEffect")]),
            fiber("HostComponent", "main"),
          ]),
          fiber(
            "FunctionComponent",
            "Portal",
            [fiber("HostPortal", "Portal", [fiber("FunctionComponent", "RouteAnnouncer")])],
            { type: "next-route-announcer" },
          ),
        ]),
      ]),
    ]);
    const flattened = flattenTransparentFibers(snapshot, NEXT_PAGES_PROFILE);
    expect(describeTree(flattened.roots[0]?.children ?? [])).toEqual([
      "App[FunctionComponent]",
      "  Head[FunctionComponent]",
      "    SideEffect[FunctionComponent]",
      "  main[HostComponent]",
    ]);
  });
});
