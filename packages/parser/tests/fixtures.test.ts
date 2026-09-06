import { describe, expect, it } from "vite-plus/test";
import { describeFixtureRun, listFixtures, runFixture } from "./helpers/fixture-runner.js";

const STATUS_RANK = { exact: 3, partial: 2, mismatch: 0, unresolved: 0, skipped: 0 };

describe("synthetic fixtures: static fiber tree vs react-dom", () => {
  for (const fixture of listFixtures()) {
    it(fixture.name, async () => {
      const run = await runFixture(fixture);
      const detail = describeFixtureRun(fixture, run);
      if (process.env.BIPPY_PARSER_DEBUG) process.stdout.write(`${detail}\n`);
      expect(run.staticResult.diagnostics.filter((diagnostic) => diagnostic.severity === "error"), detail).toEqual([]);
      if (!run.comparison) return;
      const { report } = run.comparison;
      expect(report.status, detail).not.toBe("mismatch");
      expect(STATUS_RANK[report.status], detail).toBeGreaterThanOrEqual(STATUS_RANK[fixture.manifest.expectedStatus]);
      expect(report.coverage, detail).toBeGreaterThanOrEqual(fixture.manifest.minCoverage);
    });
  }
});
