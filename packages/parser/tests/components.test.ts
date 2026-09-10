import { describe, expect, it } from "vite-plus/test";
import {
  describeComponentRun,
  listComponentFixtures,
  runComponentFixture,
} from "./helpers/component-runner.js";

/**
 * Every component fixture renders its default export both ways. The runtime
 * tree must be one of the trees the static analysis describes, and unless the
 * fixture exports `minCoverage` every runtime fiber must be explained by a
 * concrete static fiber: a match cannot be bought with wildcards or opaque
 * subtrees. A fixture exporting `isExact` must leave no decision open (commits
 * are not decisions); one exporting `isPartial` must keep one, for uncertainty
 * happy-dom cannot exhibit (browser facts it only answers with placeholders).
 * One exporting `isEnumerated` may keep decisions but the runtime tree must be
 * a member of the enumerated state space: no state may be omitted by budget.
 * Every enumerated state is replayed with its decisions pinned and must be
 * reproduced, unless the fixture exports `isReplayCorrected`: its alternatives
 * interfere when materialized together, so the replay must contradict the
 * enumeration and replace the contradicted states with what it witnessed.
 */
describe("component fixtures: static fiber tree vs react-dom", () => {
  for (const fixture of listComponentFixtures()) {
    it(fixture.name, async () => {
      const run = await runComponentFixture(fixture);
      const detail = describeComponentRun(fixture, run);
      if (process.env.BIPPY_PARSER_DEBUG) process.stdout.write(`${detail}\n`);
      const { report } = run.comparison;
      expect(report.status, detail).not.toBe("mismatch");
      expect(report.status, detail).not.toBe("unresolved");
      expect(report.status, detail).not.toBe("skipped");
      expect(report.strictCoverage, detail).toBeGreaterThanOrEqual(run.minCoverage);
      const decisionCount = run.comparison.stateSpace.states.reduce(
        (count, state) =>
          count + state.conditions.filter((condition) => condition.kind !== "transition").length,
        0,
      );
      if (run.isExact) {
        expect(report.status, detail).toBe("exact");
        expect(decisionCount, detail).toBe(0);
      }
      if (run.isPartial) expect(decisionCount, detail).toBeGreaterThan(0);
      if (run.isEnumerated) expect(report.status, detail).toBe("exact");
      const replay = run.comparison.stateReplay;
      expect(replay, detail).not.toBeNull();
      if (replay === null) return;
      if (run.isReplayCorrected) {
        expect(replay.mismatched.length, detail).toBeGreaterThan(0);
        expect(
          replay.mismatched.every((mismatch) => mismatch.isCorrected),
          detail,
        ).toBe(true);
      } else {
        expect(replay.mismatched, detail).toEqual([]);
      }
    });
  }
});
