import type { ComparisonReport } from "./compare.js";

const percent = (value: number): string => `${(value * 100).toFixed(1)}%`;

export const formatComparisonReport = (report: ComparisonReport): string => {
  const lines = [
    `status: ${report.status}`,
    `coverage: ${percent(report.coverage)} (${report.matchedFibers} fibers + ${report.matchedText} text of ${report.runtimeFibers} runtime nodes; ${report.staticFibers} static)`,
    `uncertainty: branches=${report.branchesResolved} repeats=${report.repeatIterations} opaque=${report.opaqueSubtrees} (${report.opaqueSkippedFibers} skipped, slots ${report.slotsMatched} matched/${report.slotsUnmatched} unmatched) wildcard=${report.wildcardAbsorbedFibers}`,
    `steps: ${report.stepsUsed}${report.budgetExhausted ? " (budget exhausted)" : ""}`,
  ];
  if (report.divergence) {
    const { path, expected, actual, location } = report.divergence;
    const where = location ? ` @ ${location.filePath}:${location.line}:${location.column}` : "";
    lines.push(`divergence at ${path}: expected ${expected}, saw ${actual}${where}`);
  }
  return lines.join("\n");
};
