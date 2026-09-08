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
 * subtrees. A fixture exporting `isExact` must leave no uncertainty at all; one
 * exporting `isPartial` must keep uncertainty happy-dom cannot exhibit (browser
 * facts it only answers with placeholders).
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
      if (run.isExact) expect(report.status, detail).toBe("exact");
      if (run.isPartial) expect(report.status, detail).toBe("partial");
    });
  }
});
