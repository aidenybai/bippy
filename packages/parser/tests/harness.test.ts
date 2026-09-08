import { describe, expect, it } from "vite-plus/test";
import {
  flattenTransparentFibers,
  REACT_ROUTER_PROFILE,
  SPA_PROFILE,
} from "../src/frameworks/index.js";
import {
  comparePatternToRuntime,
  type PatternFiber,
  type RuntimeFiberSnapshot,
  type RuntimeSnapshot,
  type SnapshotWorkTag,
} from "../src/harness/index.js";

const fiber = (
  name: string | null,
  children: RuntimeFiberSnapshot[] = [],
  tag: SnapshotWorkTag = name === null ? "Fragment" : "FunctionComponent",
): RuntimeFiberSnapshot => ({ tag, name, key: null, text: null, props: {}, children });

const pattern = (
  name: string,
  children: PatternFiber[] = [],
  tag: SnapshotWorkTag = "FunctionComponent",
): PatternFiber => ({ kind: "fiber", tag, name, key: null, children });

const host = (name: string, children: RuntimeFiberSnapshot[] = []) =>
  fiber(name, children, "HostComponent");

const snapshot = (roots: RuntimeFiberSnapshot[]): RuntimeSnapshot => ({
  reactVersion: null,
  rendererName: null,
  buildType: "development",
  roots,
  capturedAt: "",
});

const names = (fibers: RuntimeFiberSnapshot[]): unknown[] =>
  fibers.map((child) => [child.name, names(child.children)]);

describe("fiber comparison", () => {
  it("matches a component the bundler renamed to avoid a scope collision", () => {
    for (const runtimeName of ["Toaster2", "Toaster$1", "Toaster"]) {
      const report = comparePatternToRuntime(
        [pattern("App", [pattern("Toaster", [pattern("section", [], "HostComponent")])])],
        [fiber("App", [fiber(runtimeName, [host("section")])])],
      );
      expect(report.status, runtimeName).toBe("exact");
      expect(report.strictCoverage, runtimeName).toBe(1);
    }
  });

  it("does not treat an unrelated longer name as a renamed binding", () => {
    for (const runtimeName of ["Toaster2Wrapper", "ToasterX", "toaster2"]) {
      const report = comparePatternToRuntime(
        [pattern("App", [pattern("Toaster")])],
        [fiber("App", [fiber(runtimeName)])],
      );
      expect(report.status, runtimeName).toBe("mismatch");
    }
  });
});

describe("framework profiles", () => {
  const routeModule = fiber("Layout", [
    fiber("App", [host("main")]),
    fiber(null, [fiber("TanStackDevtools", [host("div"), fiber(null, [fiber("Portal")])])]),
  ]);

  it("drops dev tooling the framework injects, along with its anonymous wrapper", () => {
    const flattened = flattenTransparentFibers(snapshot([routeModule]), REACT_ROUTER_PROFILE);
    expect(names(flattened.roots)).toEqual([["Layout", [["App", [["main", []]]]]]]);
  });

  it("keeps anonymous fragments that wrap only application fibers", () => {
    const tree = fiber("Layout", [fiber(null, [fiber("App"), fiber("Footer")])]);
    const flattened = flattenTransparentFibers(snapshot([tree]), REACT_ROUTER_PROFILE);
    expect(names(flattened.roots)).toEqual([
      [
        "Layout",
        [
          [
            null,
            [
              ["App", []],
              ["Footer", []],
            ],
          ],
        ],
      ],
    ]);
  });

  it("leaves everything in place for plain SPAs", () => {
    const flattened = flattenTransparentFibers(snapshot([routeModule]), SPA_PROFILE);
    expect(flattened.roots).toEqual([routeModule]);
  });

  it("splices out react-router's runtime wrappers", () => {
    const tree = fiber("RouterProvider", [
      fiber("DataRouter", [fiber("Location", [fiber("RenderErrorBoundary", [fiber("Home")])])]),
    ]);
    const flattened = flattenTransparentFibers(snapshot([tree]), REACT_ROUTER_PROFILE);
    expect(names(flattened.roots)).toEqual([["RouterProvider", [["Home", []]]]]);
  });
});
