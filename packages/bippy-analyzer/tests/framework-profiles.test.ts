import { describe, expect, it } from "vite-plus/test";
import {
  flattenTransparentFibers,
  NEXT_APP_PROFILE,
  NEXT_PAGES_PROFILE,
} from "../src/frameworks/index.js";
import type { RuntimeFiberSnapshot, RuntimeSnapshot } from "../src/harness/snapshot.js";

const fiber = (
  name: string | null,
  children: RuntimeFiberSnapshot[] = [],
  props: RuntimeFiberSnapshot["props"] = {},
  tag: RuntimeFiberSnapshot["tag"] = "FunctionComponent",
): RuntimeFiberSnapshot => ({ tag, name, key: null, text: null, props, children });

const snapshotOf = (children: RuntimeFiberSnapshot[]): RuntimeSnapshot => ({
  reactVersion: "19.0.0",
  rendererName: "react-dom",
  buildType: "development",
  capturedAt: "2026-01-01T00:00:00.000Z",
  roots: [fiber(null, children, {}, "HostRoot")],
});

const describeTree = (fibers: RuntimeFiberSnapshot[]): string[] =>
  fibers.flatMap((node) => [
    node.name ?? node.tag,
    ...describeTree(node.children).map((line) => `  ${line}`),
  ]);

describe("next pages runtime profile", () => {
  it("splices out the dev-mode client wrappers and drops the fibers `next/dist/client/index` injects", () => {
    const page = fiber("SignIn", [fiber("form", [], {}, "HostComponent")]);
    const flattened = flattenTransparentFibers(
      snapshotOf([
        fiber("StrictMode", [
          fiber("Root", [
            fiber("Head", [], { callback: true }),
            fiber("AppContainer", [
              fiber("PagesDevOverlayBridge", [
                fiber("PagesDevOverlay", [
                  fiber("PagesDevOverlayErrorBoundary", [
                    fiber("Container", [fiber("App", [page])]),
                  ]),
                  fiber("FontStyles"),
                  fiber("DevOverlay", [fiber("div", [], {}, "HostComponent")]),
                ]),
              ]),
            ]),
            fiber("Portal", [fiber("p", [], {}, "HostComponent")], {
              type: "next-route-announcer",
            }),
          ]),
        ]),
      ]),
      NEXT_PAGES_PROFILE,
    );
    expect(describeTree(flattened.roots[0].children)).toEqual(["App", "  SignIn", "    form"]);
  });

  it("keeps the application's own <Head> (it always renders a SideEffect child) and other portals", () => {
    const flattened = flattenTransparentFibers(
      snapshotOf([
        fiber("Head", [fiber("SideEffect")], { callback: true }),
        fiber("Portal", [fiber("Dialog")], { type: "modal" }),
      ]),
      NEXT_PAGES_PROFILE,
    );
    expect(describeTree(flattened.roots[0].children)).toEqual([
      "Head",
      "  SideEffect",
      "Portal",
      "  Dialog",
    ]);
  });
});

describe("next app runtime profile", () => {
  const segment = (children: RuntimeFiberSnapshot[]): RuntimeFiberSnapshot =>
    fiber(
      "Activity",
      [fiber("Offscreen", children, {}, "OffscreenComponent")],
      {},
      "ActivityComponent",
    );

  it("splices out the Activity/Offscreen pair OuterLayoutRouter keeps a segment in", () => {
    const flattened = flattenTransparentFibers(
      snapshotOf([
        fiber("OuterLayoutRouter", [
          segment([fiber("Page", [fiber("main", [], {}, "HostComponent")])]),
        ]),
      ]),
      NEXT_APP_PROFILE,
    );
    expect(describeTree(flattened.roots[0].children)).toEqual(["Page", "  main"]);
  });

  it("keeps an Activity the application renders itself", () => {
    const flattened = flattenTransparentFibers(
      snapshotOf([
        fiber("OuterLayoutRouter", [
          fiber("Page", [segment([fiber("aside", [], {}, "HostComponent")])]),
        ]),
      ]),
      NEXT_APP_PROFILE,
    );
    expect(describeTree(flattened.roots[0].children)).toEqual([
      "Page",
      "  Activity",
      "    Offscreen",
      "      aside",
    ]);
  });

  it("drops the anonymous metadata/viewport boundaries Turbopack leaves unnamed, recognized by their `Next.*` Suspense", () => {
    const suspense = (name: string, children: RuntimeFiberSnapshot[] = []) =>
      fiber("Suspense", children, { name }, "SuspenseComponent");
    const flattened = flattenTransparentFibers(
      snapshotOf([
        fiber("StaticGenerationSearchParamsBailoutProvider", [
          fiber("Page", [fiber("main", [], {}, "HostComponent")]),
          fiber(null, [suspense("Next.Metadata", [fiber("title", [], {}, "HostComponent")])]),
          fiber(null, [suspense("Next.Viewport")]),
          fiber(null, [suspense("Fallback", [fiber("Spinner")])]),
          fiber(null, [fiber("Widget")]),
        ]),
      ]),
      NEXT_APP_PROFILE,
    );
    expect(describeTree(flattened.roots[0].children)).toEqual([
      "Page",
      "  main",
      "FunctionComponent",
      "  Suspense",
      "    Spinner",
      "FunctionComponent",
      "  Widget",
    ]);
  });
});
