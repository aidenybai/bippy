import { describe, expect, it } from "vite-plus/test";
import { REACT_ROUTER_PROFILE } from "../src/frameworks/profiles.js";
import { flattenTransparentFibers } from "../src/frameworks/framework-profile.js";
import { isBundledDefaultExportName, isBundlerDedupedName } from "../src/harness/bundler-names.js";
import type {
  RuntimeFiberSnapshot,
  RuntimeSnapshot,
  SnapshotWorkTag,
} from "../src/harness/snapshot.js";

const fiber = (
  name: string,
  children: RuntimeFiberSnapshot[] = [],
  tag: SnapshotWorkTag = "FunctionComponent",
): RuntimeFiberSnapshot => ({
  tag,
  name,
  key: null,
  text: null,
  props: {},
  children,
});

const provider = (name: string, children: RuntimeFiberSnapshot[]): RuntimeFiberSnapshot =>
  fiber(name, children, "ContextProvider");

const snapshotOf = (children: RuntimeFiberSnapshot[]): RuntimeSnapshot => ({
  reactVersion: null,
  rendererName: null,
  buildType: null,
  capturedAt: "",
  roots: [{ ...fiber("HostRoot", children), tag: "HostRoot", name: null }],
});

const names = (fibers: RuntimeFiberSnapshot[]): unknown[] =>
  fibers.map((item) => [item.name, names(item.children)]);

describe("bundler-renamed fibers", () => {
  it("accepts esbuild and rollup dedupe suffixes only", () => {
    expect(isBundlerDedupedName("ScrollRestoration", "ScrollRestoration2")).toBe(true);
    expect(isBundlerDedupedName("ScrollRestoration", "ScrollRestoration$1")).toBe(true);
    expect(isBundlerDedupedName("ScrollRestoration", "ScrollRestoration")).toBe(false);
    expect(isBundlerDedupedName("Scroll", "ScrollRestoration")).toBe(false);
  });

  it("matches esbuild's bundled name for an anonymous default export", () => {
    expect(isBundledDefaultExportName("default", "root_default")).toBe(true);
    expect(isBundledDefaultExportName("default", "contact_default")).toBe(true);
    expect(isBundledDefaultExportName("default", "default")).toBe(false);
    expect(isBundledDefaultExportName("App", "App_default")).toBe(false);
  });

  it("matches webpack's and rspack's local for an anonymous default export", () => {
    expect(isBundledDefaultExportName("default", "__WEBPACK_DEFAULT_EXPORT__")).toBe(true);
    expect(isBundledDefaultExportName("default", "__rspack_default_export")).toBe(true);
    expect(isBundledDefaultExportName("Noop", "__rspack_default_export")).toBe(false);
  });

  it("splices out a re-export wrapper around the fiber it was renamed against", () => {
    const flattened = flattenTransparentFibers(
      snapshotOf([
        fiber("RouterProvider2", [
          fiber("RouterProvider", [provider("DataRouter", [fiber("App")])]),
        ]),
      ]),
      REACT_ROUTER_PROFILE,
    );
    expect(names(flattened.roots[0].children)).toEqual([["RouterProvider", [["App", []]]]]);
  });

  it("keeps a renamed fiber that is the only provider (react-router-dom 6)", () => {
    const flattened = flattenTransparentFibers(
      snapshotOf([fiber("RouterProvider2", [provider("DataRouter", [fiber("App")])])]),
      REACT_ROUTER_PROFILE,
    );
    expect(names(flattened.roots[0].children)).toEqual([["RouterProvider2", [["App", []]]]]);
  });
});
