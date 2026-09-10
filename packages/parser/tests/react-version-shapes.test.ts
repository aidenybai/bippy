import { describe, expect, it } from "vite-plus/test";
import {
  compareStaticToRuntime,
  enumerateStaticStates,
  formatCompareRenderResult,
} from "../src/harness/index.js";
import type { RuntimeFiberSnapshot, RuntimeSnapshot } from "../src/harness/snapshot.js";
import { listComponentFixtures, runComponentFixture } from "./helpers/component-runner.js";

const spliceOffscreenFibers = (fibers: RuntimeFiberSnapshot[]): RuntimeFiberSnapshot[] =>
  fibers.flatMap((fiber) =>
    fiber.name === "Offscreen"
      ? spliceOffscreenFibers(fiber.children)
      : [{ ...fiber, children: spliceOffscreenFibers(fiber.children) }],
  );

describe("fiber shapes that differ between React versions", () => {
  it("matches a React 16 capture whose Suspense children have no Offscreen fiber", async () => {
    const fixture = listComponentFixtures().find((candidate) => candidate.name === "builtins.tsx");
    if (!fixture) throw new Error("builtins fixture is missing");
    const run = await runComponentFixture(fixture);
    expect(run.comparison.report.status).toBe("exact");

    const legacyCapture: RuntimeSnapshot = {
      ...run.runtime,
      reactVersion: "16.13.1",
      roots: run.runtime.roots.map((root) => ({
        ...root,
        children: spliceOffscreenFibers(root.children),
      })),
    };
    const unaware = compareStaticToRuntime(enumerateStaticStates(run.staticResult), legacyCapture);
    expect(unaware.report.status, formatCompareRenderResult(unaware)).toBe("mismatch");

    const aware = compareStaticToRuntime(
      enumerateStaticStates(run.staticResult, {
        runtimeReactVersion: legacyCapture.reactVersion,
      }),
      legacyCapture,
    );
    expect(aware.report.status, formatCompareRenderResult(aware)).toBe("exact");
    expect(aware.report.strictCoverage).toBe(1);
  });
});
