import { describe, expect, it } from "vite-plus/test";
import { sumMetrics, toMetric } from "../../src/branch-coverage/report.js";

describe("toMetric", () => {
  it("reports a normal ratio as a rounded percentage", () => {
    expect(toMetric(1, 2)).toEqual({ pct: 50, covered: 1, total: 2 });
    expect(toMetric(2, 3).pct).toBe(66.67);
  });

  it("reports zero coverage when there is something to cover", () => {
    expect(toMetric(0, 5)).toEqual({ pct: 0, covered: 0, total: 5 });
  });

  // A metric over zero items is vacuously fully covered, matching istanbul/nyc.
  // This keeps branchless files (icons, constant tables, barrels) out of the
  // least-covered worklist instead of pinning them at a misleading 0%.
  it("treats zero-of-zero as 100% (vacuously covered)", () => {
    expect(toMetric(0, 0)).toEqual({ pct: 100, covered: 0, total: 0 });
  });

  it("aggregates covered/total before computing the percentage", () => {
    expect(sumMetrics([toMetric(1, 2), toMetric(2, 2)])).toEqual({
      pct: 75,
      covered: 3,
      total: 4,
    });
  });
});
