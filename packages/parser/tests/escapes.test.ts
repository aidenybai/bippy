import { describe, expect, it } from "vite-plus/test";
import { describeFixtureRun, listFixtures, runFixture } from "./helpers/fixture-runner.js";

/**
 * Handlers the analysis cannot see run (observer callbacks, listeners for
 * events the browser may dispatch on load) escape together with every setter
 * reachable from them, however deep the closure chain; the state they reach
 * must stay a branch rather than be decided at its initial value.
 */
describe("escaped handlers widen the state they reach", () => {
  for (const name of ["observer-callback-ref", "pointer-hover-listener"]) {
    it(`keeps ${name} uncertain`, async () => {
      const fixture = listFixtures().find((candidate) => candidate.name === name);
      if (!fixture) throw new Error(`missing ${name} fixture`);
      const run = await runFixture({
        ...fixture,
        manifest: { ...fixture.manifest, skipRuntime: true },
      });
      const detail = describeFixtureRun(fixture, run);
      expect(run.staticResult.stats.branchCount, detail).toBe(1);
    });
  }
});
