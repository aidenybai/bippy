import type { ComparisonDivergence, ComparisonReport, WildcardAbsorption } from "./compare.js";

const percent = (value: number): string => `${(value * 100).toFixed(1)}%`;

const MAX_REPORTED_WILDCARDS = 5;
const MAX_REPORTED_HEADS = 3;
const MAX_REPORTED_DEVIATIONS = 5;
const MAX_PATH_SEGMENTS = 6;

const shortenPath = (path: string): string => {
  const segments = path.split(" > ");
  return segments.length <= MAX_PATH_SEGMENTS
    ? path
    : ["…", ...segments.slice(-MAX_PATH_SEGMENTS)].join(" > ");
};

const formatDivergence = (divergence: ComparisonDivergence): string =>
  `${shortenPath(divergence.path)}: expected ${divergence.expected}, saw ${divergence.actual}`;

/** The wildcards standing in for the most runtime fibers, largest first. */
export const rankWildcards = (
  wildcards: WildcardAbsorption[],
  limit: number,
): WildcardAbsorption[] =>
  [...wildcards].sort((left, right) => right.absorbedFibers - left.absorbedFibers).slice(0, limit);

const formatWildcard = (wildcard: WildcardAbsorption): string => {
  const heads = wildcard.heads.slice(0, MAX_REPORTED_HEADS).join(", ");
  const more = wildcard.heads.length > MAX_REPORTED_HEADS ? ", …" : "";
  return `  ${wildcard.absorbedFibers} fibers ?unknown(${wildcard.reason}) at ${shortenPath(wildcard.path)}: ${heads}${more}`;
};

export const formatComparisonReport = (report: ComparisonReport): string => {
  const lines = [
    `status: ${report.status}`,
    `coverage: ${percent(report.coverage)} (${report.matchedFibers} fibers + ${report.matchedText} text of ${report.runtimeFibers} runtime nodes; ${report.staticFibers} static)`,
    `uncertainty: branches=${report.branchesResolved} repeats=${report.repeatIterations} opaque=${report.opaqueSubtrees} (${report.opaqueSkippedFibers} skipped, ${report.opaqueRenamed} renamed, slots ${report.slotsMatched} matched/${report.slotsUnmatched} unmatched) wildcard=${report.wildcardAbsorbedFibers}`,
    `steps: ${report.stepsUsed}${report.budgetExhausted ? " (budget exhausted)" : ""}`,
  ];
  if (report.divergence) lines.push(`divergence at ${formatDivergence(report.divergence)}`);
  if (report.wildcards.length > 0) {
    lines.push("largest wildcards:");
    for (const wildcard of rankWildcards(report.wildcards, MAX_REPORTED_WILDCARDS))
      lines.push(formatWildcard(wildcard));
  }
  if (report.unmatchedSlots.length > 0) {
    lines.push("unmatched slots:");
    for (const slot of report.unmatchedSlots) {
      lines.push(
        `  ${slot.skippedFibers} fibers under ${slot.head} at ${shortenPath(slot.path)} (${slot.reason})`,
      );
      if (slot.divergence) lines.push(`    furthest: ${formatDivergence(slot.divergence)}`);
    }
  }
  if (report.branchDeviations.length > 0) {
    lines.push(
      `branches resolved against the preferred alternative (${report.branchDeviations.length}):`,
    );
    for (const deviation of report.branchDeviations.slice(0, MAX_REPORTED_DEVIATIONS)) {
      lines.push(
        `  ?branch(${deviation.reason}) took |${deviation.chosenIndex} over |${deviation.preferredIndex} at ${shortenPath(deviation.path)}`,
      );
      if (deviation.divergence)
        lines.push(`    preferred failed at ${formatDivergence(deviation.divergence)}`);
    }
  }
  return lines.join("\n");
};
