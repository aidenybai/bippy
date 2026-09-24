import { describe, expect, it } from "vite-plus/test";
import { summarizeCompatibility } from "../scripts/compatibility-report.js";

const getMetrics = (covered = 2) => {
  const metric = { total: 2, covered, skipped: 0, pct: covered * 50 };
  return { statements: metric, branches: metric, functions: metric, lines: metric };
};
const getCoverage = () => ({ total: getMetrics(), "src/example.ts": getMetrics() });
const getResults = (fullName = "matches native behavior", status = "passed") => ({
  success: true,
  startTime: 0,
  testResults: [
    { name: "tests/example.test.ts", status: "passed", assertionResults: [{ fullName, status }] },
  ],
});

describe("compatibility evidence gate", () => {
  it("accepts a fully covered run with ordinary passing assertions", () => {
    expect(summarizeCompatibility(getResults(), getCoverage())).toMatchObject({
      meetsStrictGate: true,
      ordinaryPassedAssertions: 1,
      explicitKnownDefects: 0,
    });
  });

  it.each([
    "known divergence: copy isolation",
    "known precision gap: branch correlation",
    "known crash: generator next",
    "known limitation: reflection",
    "known unsupported: array method",
    "known defect: descriptor selection",
  ])("does not count defect label %# as supported behavior", (name) => {
    expect(summarizeCompatibility(getResults(name), getCoverage())).toMatchObject({
      meetsStrictGate: false,
      ordinaryPassedAssertions: 0,
      explicitKnownDefects: 1,
    });
  });

  it.each(["pending", "skipped", "todo", "unknown"])("rejects %s assertions", (status) => {
    expect(
      summarizeCompatibility(getResults("native comparison", status), getCoverage()),
    ).toMatchObject({ meetsStrictGate: false, notRunAssertions: 1 });
  });

  it("rejects failed assertions even if the top-level result claims success", () => {
    expect(
      summarizeCompatibility(getResults("native comparison", "failed"), getCoverage()),
    ).toMatchObject({ meetsStrictGate: false, failedAssertions: 1 });
  });

  it("rejects failed suites without failed assertions", () => {
    const results = getResults();
    results.testResults[0].status = "failed";
    expect(summarizeCompatibility(results, getCoverage()).meetsStrictGate).toBe(false);
  });

  it("rejects a failed run", () => {
    expect(
      summarizeCompatibility({ ...getResults(), success: false }, getCoverage()).meetsStrictGate,
    ).toBe(false);
  });

  it("does not hide an uncovered file behind aggregate coverage", () => {
    expect(
      summarizeCompatibility(getResults(), {
        ...getCoverage(),
        "src/unimported.ts": getMetrics(0),
      }),
    ).toMatchObject({
      meetsStrictGate: false,
      sourceFiles: 2,
      uncoveredFiles: [{ file: "src/unimported.ts" }],
    });
  });

  it("also checks aggregate coverage", () => {
    expect(
      summarizeCompatibility(getResults(), { ...getCoverage(), total: getMetrics(1) })
        .meetsStrictGate,
    ).toBe(false);
  });

  it("rejects skipped coverage and inconsistent rounded percentages", () => {
    const coverage = getCoverage();
    coverage["src/example.ts"].branches = { total: 2, covered: 1, skipped: 1, pct: 100 };
    expect(summarizeCompatibility(getResults(), coverage).meetsStrictGate).toBe(false);
  });

  it("rejects a filtered run that omits test files", () => {
    expect(
      summarizeCompatibility(getResults(), getCoverage(), {
        tests: ["tests/example.test.ts", "tests/missing.test.ts"],
      }),
    ).toMatchObject({
      meetsStrictGate: false,
      missingTestFiles: ["tests/missing.test.ts"],
    });
  });

  it("rejects a report that omits source files", () => {
    expect(
      summarizeCompatibility(getResults(), getCoverage(), {
        sources: ["src/example.ts", "src/missing.ts"],
      }),
    ).toMatchObject({
      meetsStrictGate: false,
      missingSourceFiles: ["src/missing.ts"],
    });
  });

  it("fails closed on missing or empty evidence", () => {
    expect(() => summarizeCompatibility({}, getCoverage())).toThrow();
    expect(() => summarizeCompatibility(getResults(), { total: getMetrics() })).toThrow(
      "no source files",
    );
    expect(() => summarizeCompatibility(getResults(), { "src/example.ts": getMetrics() })).toThrow(
      "no total",
    );
    expect(() =>
      summarizeCompatibility({ ...getResults(), testResults: [] }, getCoverage()),
    ).toThrow("no assertions");
  });
});
