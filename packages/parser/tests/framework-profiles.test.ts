import { describe, expect, it } from "vite-plus/test";
import { flattenTransparentFibers, NEXT_PAGES_PROFILE } from "../src/frameworks/index.js";
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
