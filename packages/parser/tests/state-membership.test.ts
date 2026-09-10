import { beforeAll, describe, expect, it } from "vite-plus/test";
import { compareStaticToRuntime, formatCompareRenderResult } from "../src/harness/index.js";
import type { RuntimeFiberSnapshot, RuntimeSnapshot } from "../src/harness/snapshot.js";
import { type FixtureRunResult, listFixtures, runFixture } from "./helpers/fixture-runner.js";

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

const runStatesTwoWay = async (): Promise<FixtureRunResult> => {
  const fixture = listFixtures().find((candidate) => candidate.name === "states-two-way");
  if (!fixture) throw new Error("states-two-way fixture is missing");
  return runFixture(fixture);
};

describe("runtime outside the enumerated states", () => {
  let run: FixtureRunResult;
  beforeAll(async () => {
    run = await runStatesTwoWay();
  });

  it("reports a mismatch with the closest state", () => {
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

  it("compares against the react-dom root even when another renderer committed a larger one", () => {
    if (!run.comparison || !run.runtime) throw new Error("states-two-way did not compare");
    const [domRoot] = run.runtime.roots;
    const canvasRoot: RuntimeFiberSnapshot = {
      ...domRoot,
      children: [
        {
          tag: "FunctionComponent",
          name: "Scene",
          key: null,
          text: null,
          props: {},
          children: renameHostFibers(domRoot.children, "small", "mesh"),
        },
      ],
    };
    const multiRenderer: RuntimeSnapshot = {
      ...run.runtime,
      rendererName: "@react-three/fiber",
      roots: [
        { ...canvasRoot, rendererName: "@react-three/fiber" },
        { ...domRoot, rendererName: "react-dom" },
      ],
    };
    const comparison = compareStaticToRuntime(run.comparison.stateSpace, multiRenderer);
    expect(comparison.report.status, formatCompareRenderResult(comparison)).toBe("exact");
  });
});
