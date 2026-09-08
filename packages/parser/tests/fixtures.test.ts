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
        run.staticResult.diagnostics.filter(
          (diagnostic) => diagnostic.severity === "error" || diagnostic.code === "max-call-depth",
        ),
        detail,
      ).toEqual([]);
      if (!run.comparison) return;
      const { report } = run.comparison;
      expect(report.status, detail).not.toBe("mismatch");
      expect(STATUS_RANK[report.status], detail).toBeGreaterThanOrEqual(
        STATUS_RANK[fixture.manifest.expectedStatus],
      );
      expect(report.coverage, detail).toBeGreaterThanOrEqual(fixture.manifest.minCoverage);
      const replayed = fixture.manifest.observations;
      for (const observed of replayed?.queries ?? []) {
        const captured = run.observed.queries.find(
          (query) => query.queryHash === observed.queryHash,
        );
        expect(withoutTimestamps(captured), detail).toEqual(withoutTimestamps(observed));
      }
      if (replayed?.mutations) {
        expect(run.observed.mutations.map(withoutSubmittedAt), detail).toEqual(
          replayed.mutations.map(withoutSubmittedAt),
        );
      }
      if (replayed?.lingui) expect(run.observed.lingui, detail).toEqual(replayed.lingui);
      if (replayed?.router) expect(run.observed.router, detail).toEqual(replayed.router);
      if (replayed?.stores) expect(run.observed.stores, detail).toMatchObject(replayed.stores);
    });
  }
});

describe("browser facts stay uncertain", () => {
  it("keeps canvas rasterization results as explicit branches", async () => {
    const fixture = listFixtures().find((candidate) => candidate.name === "canvas-rasterization");
    if (!fixture) throw new Error("missing canvas-rasterization fixture");
    const run = await runFixture({
      ...fixture,
      manifest: { ...fixture.manifest, skipRuntime: true },
    });
    const detail = describeFixtureRun(fixture, run);
    expect(run.staticResult.stats.branchCount, detail).toBe(2);
    expect(run.staticResult.stats.unknownCount, detail).toBe(1);
  });
});
