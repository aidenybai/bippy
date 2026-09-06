import { describe, expect, it } from "vite-plus/test";
import type { CapturedMutation, CapturedQuery } from "../src/index.js";
import { describeFixtureRun, listFixtures, runFixture } from "./helpers/fixture-runner.js";

const STATUS_RANK = { exact: 3, partial: 2, mismatch: 0, unresolved: 0, skipped: 0 };

const withoutTimestamps = (query: CapturedQuery | undefined): CapturedQuery | undefined =>
  query && { ...query, dataUpdatedAt: 0, errorUpdatedAt: 0 };

const withoutSubmittedAt = (mutation: CapturedMutation): CapturedMutation => ({
  ...mutation,
  submittedAt: 0,
});

describe("synthetic fixtures: static fiber tree vs react-dom", () => {
  for (const fixture of listFixtures()) {
    it(fixture.name, async () => {
      const run = await runFixture(fixture);
      const detail = describeFixtureRun(fixture, run);
      if (process.env.BIPPY_PARSER_DEBUG) process.stdout.write(`${detail}\n`);
      expect(
        run.staticResult.diagnostics.filter((diagnostic) => diagnostic.severity === "error"),
        detail,
      ).toEqual([]);
      if (!run.comparison) return;
      const { report } = run.comparison;
      expect(report.status, detail).not.toBe("mismatch");
      expect(STATUS_RANK[report.status], detail).toBeGreaterThanOrEqual(
        STATUS_RANK[fixture.manifest.expectedStatus],
      );
      expect(report.coverage, detail).toBeGreaterThanOrEqual(fixture.manifest.minCoverage);
      for (const observed of fixture.manifest.observations?.queries ?? []) {
        const captured = run.capturedCaches.queries.find(
          (query) => query.queryHash === observed.queryHash,
        );
        expect(withoutTimestamps(captured), detail).toEqual(withoutTimestamps(observed));
      }
      const observedMutations = fixture.manifest.observations?.mutations;
      if (observedMutations) {
        expect(run.capturedCaches.mutations.map(withoutSubmittedAt), detail).toEqual(
          observedMutations.map(withoutSubmittedAt),
        );
      }
    });
  }
});
