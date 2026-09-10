import { describe, expect, it } from "vite-plus/test";
import { describeFixtureRun, listFixtures, runFixture } from "./helpers/fixture-runner.js";

const countStaticBranches = async (name: string): Promise<number> => {
  const fixture = listFixtures().find((candidate) => candidate.name === name);
  if (!fixture) throw new Error(`missing ${name} fixture`);
  const run = await runFixture({
    ...fixture,
    manifest: { ...fixture.manifest, skipRuntime: true },
  });
  const detail = describeFixtureRun(fixture, run);
  expect(
    run.staticResult.diagnostics.filter((diagnostic) => diagnostic.severity === "error"),
    detail,
  ).toEqual([]);
  return run.staticResult.stats.branchCount;
};

describe("escaped handlers", () => {
  it("widen the state reachable from handlers that may run before the snapshot", async () => {
    expect(await countStaticBranches("observer-callback-ref")).toBe(1);
  });

  it("widen the state reachable from pointer position listeners, which Chromium dispatches to the element at the pointer once navigation commits", async () => {
    expect(await countStaticBranches("pointer-hover-listener")).toBe(1);
  });

  it("leave an instance handed to unresolved code as it was, since its methods run on a receiver of the caller's choosing", async () => {
    expect(await countStaticBranches("escaped-instance-methods")).toBe(0);
  });
});
