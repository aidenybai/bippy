import type { ComparisonDivergence, ComparisonReport, WildcardAbsorption } from "./compare.js";
import type { StateReplaySummary } from "./state-replay.js";
import type {
  StateCondition,
  StateOmission,
  StateSpaceSummary,
  StaticState,
} from "./state-space.js";

const percent = (value: number): string => `${(value * 100).toFixed(1)}%`;

const MAX_REPORTED_WILDCARDS = 5;
const MAX_REPORTED_HEADS = 3;
const MAX_REPORTED_STATES = 8;
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

const formatLocation = (location: string | null): string => (location ? ` @${location}` : "");

export const formatStateCondition = (condition: StateCondition): string => {
  switch (condition.kind) {
    case "branch":
    case "state-update":
      return `${condition.kind}(${condition.reason})${formatLocation(condition.location)} = |${condition.alternativeIndex} of ${condition.alternativeCount}`;
    case "repeat":
      return `repeat${formatLocation(condition.location)} = ×${condition.count}`;
    case "transition":
      return `commit ${condition.commit + 1} of ${condition.commitCount}`;
  }
};

export const formatStateConditions = (conditions: StateCondition[]): string =>
  conditions.length === 0 ? "(unconditional)" : conditions.map(formatStateCondition).join(", ");

const formatOmissionScope = (conditions: StateCondition[]): string =>
  conditions.length === 0 ? "" : ` under ${formatStateConditions(conditions)}`;

const formatOmission = (omission: StateOmission): string => {
  switch (omission.kind) {
    case "branch":
      return `branch(${omission.reason})${formatLocation(omission.location)} alternative |${omission.alternativeIndex} not expanded${formatOmissionScope(omission.conditions)} (state budget)`;
    case "repeat":
      return `repeat${formatLocation(omission.location)} counts above ×${omission.countsAbove} not enumerated${formatOmissionScope(omission.conditions)} (${omission.max === null ? "unbounded" : `up to ×${omission.max}`}${omission.conditions.length === 0 ? "" : ", state budget"})`;
    case "state":
      return `state ${formatStateConditions(omission.conditions)} not recorded (state budget)`;
    case "subtree":
      return `subtree not materialized: ${omission.reason}`;
  }
};

const formatStateSpaceSummary = (
  summary: StateSpaceSummary,
  states: StaticState[] = [],
): string[] => {
  const lines = [`states: ${summary.states}${summary.omitted ? " (incomplete)" : ""}`];
  if (summary.matchedState) {
    const { index, conditions } = summary.matchedState;
    lines.push(
      `matched state: ${index === null ? "outside the enumerated set" : `#${index + 1}`} ${formatStateConditions(conditions)}`,
    );
  }
  if (summary.closestState) {
    lines.push(
      `closest state: #${summary.closestState.index + 1} ${formatStateConditions(states[summary.closestState.index]?.conditions ?? [])}`,
    );
    lines.push(`  diverged at ${formatDivergence(summary.closestState.divergence)}`);
  }
  const unobserved = states.filter((_, index) => index !== summary.matchedState?.index);
  if (unobserved.length > 0) {
    lines.push(`unobserved states (${unobserved.length}):`);
    for (const state of unobserved.slice(0, MAX_REPORTED_STATES))
      lines.push(`  ${formatStateConditions(state.conditions)}`);
    if (unobserved.length > MAX_REPORTED_STATES)
      lines.push(`  … and ${unobserved.length - MAX_REPORTED_STATES} more`);
  }
  if (summary.omitted) {
    const { total, omissions } = summary.omitted;
    lines.push(`omitted (${total}):`);
    for (const omission of omissions) lines.push(`  ${formatOmission(omission)}`);
    if (total > omissions.length) lines.push(`  … and ${total - omissions.length} more`);
  }
  return lines;
};

export const formatStateReplay = (replay: StateReplaySummary): string[] => {
  const sampled =
    replay.replayed < replay.assignments ? ` (sampled, max ${replay.maxReplayed})` : "";
  const lines = [
    `replayed: ${replay.replayed} of ${replay.assignments} decision assignments${sampled}, ${replay.mismatched.length} mismatched`,
  ];
  for (const mismatch of replay.mismatched) {
    lines.push(
      `  ${formatStateConditions(mismatch.conditions)}: claimed ${mismatch.claimedCommits} commits, replay produced ${mismatch.replayedCommits}${mismatch.isCorrected ? " (corrected)" : " (decisions left open)"}`,
    );
    lines.push(`    diverged at ${formatDivergence(mismatch.divergence)}`);
  }
  return lines;
};

export const formatComparisonReport = (
  report: ComparisonReport,
  stateSpace: StateSpaceSummary | null = null,
  states: StaticState[] = [],
  stateReplay: StateReplaySummary | null = null,
): string => {
  const lines = [
    `status: ${report.status}`,
    `coverage: ${percent(report.coverage)} (${report.matchedFibers} fibers + ${report.matchedText} text of ${report.runtimeFibers} runtime nodes; ${report.staticFibers} static)`,
    `uncertainty: branches=${report.branchesResolved} repeats=${report.repeatIterations} opaque=${report.opaqueSubtrees} (${report.opaqueSkippedFibers} skipped, ${report.opaqueRenamed} renamed, slots ${report.slotsMatched} matched/${report.slotsUnmatched} unmatched) wildcard=${report.wildcardAbsorbedFibers}`,
    `steps: ${report.stepsUsed}${report.budgetExhausted ? " (budget exhausted)" : ""}`,
  ];
  if (stateSpace) lines.push(...formatStateSpaceSummary(stateSpace, states));
  if (stateReplay) lines.push(...formatStateReplay(stateReplay));
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
  return lines.join("\n");
};
