import type { ComparisonReport, WildcardAbsorption } from "./compare.js";

const percent = (value: number): string => `${(value * 100).toFixed(1)}%`;

const MAX_REPORTED_WILDCARDS = 5;
const MAX_REPORTED_HEADS = 3;

/** The wildcards standing in for the most runtime fibers, largest first. */
export const rankWildcards = (
  wildcards: WildcardAbsorption[],
  limit: number,
): WildcardAbsorption[] =>
  [...wildcards].sort((left, right) => right.absorbedFibers - left.absorbedFibers).slice(0, limit);

const formatWildcard = (wildcard: WildcardAbsorption): string => {
  const heads = wildcard.heads.slice(0, MAX_REPORTED_HEADS).join(", ");
  const more = wildcard.heads.length > MAX_REPORTED_HEADS ? ", …" : "";
  return `  ${wildcard.absorbedFibers} fibers ?unknown(${wildcard.reason}) at ${wildcard.path}: ${heads}${more}`;
};

export const formatComparisonReport = (report: ComparisonReport): string => {
  const lines = [
    `status: ${report.status}`,
    `coverage: ${percent(report.coverage)} (${report.matchedFibers} fibers + ${report.matchedText} text of ${report.runtimeFibers} runtime nodes; ${report.staticFibers} static)`,
    `uncertainty: branches=${report.branchesResolved} repeats=${report.repeatIterations} opaque=${report.opaqueSubtrees} (${report.opaqueSkippedFibers} skipped, slots ${report.slotsMatched} matched/${report.slotsUnmatched} unmatched) wildcard=${report.wildcardAbsorbedFibers}`,
    `steps: ${report.stepsUsed}${report.budgetExhausted ? " (budget exhausted)" : ""}`,
  ];
  if (report.divergence) {
    const { path, expected, actual } = report.divergence;
    lines.push(`divergence at ${path}: expected ${expected}, saw ${actual}`);
  }
  if (report.wildcards.length > 0) {
    lines.push("largest wildcards:");
    for (const wildcard of rankWildcards(report.wildcards, MAX_REPORTED_WILDCARDS))
      lines.push(formatWildcard(wildcard));
  }
  return lines.join("\n");
};
