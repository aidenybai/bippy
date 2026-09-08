import { describe, expect, it } from "vite-plus/test";
import { comparePatternToRuntime } from "../src/harness/compare.js";
import type { RuntimeFiberSnapshot } from "../src/harness/snapshot.js";
import type { PatternFiber, PatternOpaque } from "../src/harness/static-pattern.js";

const runtimeFiber = (
  name: string | null,
  children: RuntimeFiberSnapshot[] = [],
): RuntimeFiberSnapshot => ({
  tag: "FunctionComponent",
  name,
  key: null,
  text: null,
  props: {},
  children,
});

const patternFiber = (name: string | null, children: PatternFiber[] = []): PatternFiber => ({
  kind: "fiber",
  tag: "FunctionComponent",
  name,
  key: null,
  children,
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
  it("matches a source name against its rolldown `$<n>` suffixed runtime name", () => {
    const report = comparePatternToRuntime(
      [patternFiber("Ae", [patternFiber("Inner")])],
      [runtimeFiber("Ae$5", [runtimeFiber("Inner")])],
    );
    expect(report.status).toBe("exact");
    expect(report.matchedFibers).toBe(2);
  });

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
