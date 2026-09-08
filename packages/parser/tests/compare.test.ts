import { describe, expect, it } from "vite-plus/test";
import { comparePatternToRuntime } from "../src/harness/compare.js";
import type { RuntimeFiberSnapshot } from "../src/harness/snapshot.js";
import type { PatternFiber, PatternOpaque } from "../src/harness/static-pattern.js";

const runtimeFiber = (
  name: string,
  children: RuntimeFiberSnapshot[] = [],
  tag: RuntimeFiberSnapshot["tag"] = "FunctionComponent",
): RuntimeFiberSnapshot => ({ tag, name, key: null, text: null, props: {}, children });

const patternFiber = (
  name: string,
  children: PatternFiber[] = [],
  tag: PatternFiber["tag"] = "FunctionComponent",
): PatternFiber => ({ kind: "fiber", tag, name, key: null, children });

describe("comparePatternToRuntime", () => {
  it("accepts a bundler-deconflicted `$N` suffix on the runtime name", () => {
    const report = comparePatternToRuntime(
      [patternFiber("Dialog", [patternFiber("Panel", [patternFiber("div", [], "HostComponent")])])],
      [
        runtimeFiber("Dialog$1", [
          runtimeFiber("Panel$12", [runtimeFiber("div", [], "HostComponent")]),
        ]),
      ],
    );
    expect(report.status).toBe("exact");
    expect(report.matchedFibers).toBe(3);
  });

  it("does not equate names that differ beyond a `$N` suffix", () => {
    const report = comparePatternToRuntime([patternFiber("Dialog")], [runtimeFiber("Dialog$1x")]);
    expect(report.status).toBe("mismatch");
  });
});

const opaque = (runtimeNames: string[] | null): PatternOpaque => ({
  kind: "opaque",
  name: "Menu",
  runtimeNames,
  key: null,
  reason: "external",
  passedChildren: [],
});

/**
 * Dependency pre-bundling renames a binding that collides in the merged chunk
 * (rolldown: `Ae` becomes `Ae$5`; esbuild: `TextareaAutosize` becomes
 * `TextareaAutosize2`); the static tree keeps the source name.
 */
describe("bundler-deduplicated component names", () => {
  it("matches a source name against its esbuild `<n>` suffixed runtime name", () => {
    const report = comparePatternToRuntime(
      [patternFiber("TextareaAutosize")],
      [runtimeFiber("TextareaAutosize2")],
    );
    expect(report.status).toBe("exact");
  });

  it("accepts a deduplicated runtime name for an opaque component", () => {
    const report = comparePatternToRuntime([opaque(["Menu"])], [runtimeFiber("Menu$2")]);
    expect(report.status).toBe("partial");
    expect(report.opaqueSubtrees).toBe(1);
  });

  it("keeps rejecting names that merely share a prefix", () => {
    for (const runtimeName of ["Ae$", "Ae$x", "AeX", "Ae2$1", "A"]) {
      const report = comparePatternToRuntime([patternFiber("Ae")], [runtimeFiber(runtimeName)]);
      expect(report.status, runtimeName).toBe("mismatch");
    }
  });
});
