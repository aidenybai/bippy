import { describe, expect, it } from "vite-plus/test";
import { compareStaticToRuntime, formatCompareRenderResult } from "../src/harness/index.js";
import type { RuntimeFiberSnapshot, RuntimeSnapshot } from "../src/harness/snapshot.js";
import { listFixtures, runFixture } from "./helpers/fixture-runner.js";

const renameHostFibers = (
  fibers: RuntimeFiberSnapshot[],
  from: string,
  to: string,
): RuntimeFiberSnapshot[] =>
  fibers.map((fiber) => ({
    ...fiber,
    name: fiber.tag === "HostComponent" && fiber.name === from ? to : fiber.name,
    children: renameHostFibers(fiber.children, from, to),
  }));

describe("runtime outside the enumerated states", () => {
  it("reports a mismatch with the closest state", async () => {
    const fixture = listFixtures().find((candidate) => candidate.name === "states-two-way");
    if (!fixture) throw new Error("states-two-way fixture is missing");
    const run = await runFixture(fixture);
    if (!run.comparison || !run.runtime) throw new Error("states-two-way did not compare");
    expect(run.comparison.report.status).toBe("exact");

    const unreachable: RuntimeSnapshot = {
      ...run.runtime,
      roots: run.runtime.roots.map((root) => ({
        ...root,
        children: renameHostFibers(root.children, "small", "em"),
      })),
    };
    const comparison = compareStaticToRuntime(run.comparison.stateSpace, unreachable);
    const detail = formatCompareRenderResult(comparison);
    expect(comparison.report.status, detail).toBe("mismatch");
    expect(comparison.matchedState, detail).toBeNull();
    expect(comparison.closestState?.divergence, detail).toMatchObject({
      expected: expect.stringContaining("small"),
      actual: expect.stringContaining("em"),
    });
    expect(comparison.stateSpace.states.length, detail).toBe(2);
  });
});
