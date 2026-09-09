import type { ComparisonDivergence, ComparisonReport, WildcardAbsorption } from "./compare.js";
import { enumerateClusters, type GuardCluster } from "./enumerate-states.js";
import { formatGuardCoverage, type GuardCoverage } from "./guard-coverage.js";
import {
  DEFAULT_STATE_SPACE_BUDGET,
  type StateCondition,
  type StateOmission,
  type StateSpaceBudget,
  type StateSpaceSummary,
  type StaticState,
} from "./state-space.js";
import { formatRepeatBounds, type PatternNode } from "./static-pattern.js";
import {
  formatGuard,
  formatVariable,
  type InputVariable,
  type SymbolicTree,
} from "./symbolic-tree.js";

const percent = (value: number): string => `${(value * 100).toFixed(1)}%`;

const MAX_REPORTED_WILDCARDS = 5;
const MAX_REPORTED_HEADS = 3;
const MAX_REPORTED_STATES = 8;
const MAX_PATH_SEGMENTS = 6;
const MAX_REPORTED_SIDES = 12;
const MAX_TABLE_ROWS = 16;

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

const formatSideStatus = (
  coverage: GuardCoverage,
  status: "possible" | "unreachable",
): string[] => {
  const sides = coverage.sides.filter((side) => side.status === status);
  if (sides.length === 0) return [];
  return [
    `${status} guard sides (${sides.length}):`,
    ...sides
      .slice(0, MAX_REPORTED_SIDES)
      .map(
        (side) =>
          `  ${side.kind}(${side.reason})${formatLocation(side.location)} |${side.side} ${side.guard}`,
      ),
    ...(sides.length > MAX_REPORTED_SIDES
      ? [`  … and ${sides.length - MAX_REPORTED_SIDES} more`]
      : []),
  ];
};

export const formatGuardCoverageLines = (coverage: GuardCoverage): string[] => [
  `guards: ${formatGuardCoverage(coverage)}`,
  ...formatSideStatus(coverage, "possible"),
  ...formatSideStatus(coverage, "unreachable"),
];

export const formatStateSpaceSummary = (
  summary: StateSpaceSummary,
  states: StaticState[] = [],
): string[] => {
  const { tree } = summary;
  const lines = [
    `symbolic tree: ${tree.nodes} nodes, ${tree.inputs} inputs, ${tree.guards} guards (${tree.branches} branches, ${tree.repeats} repeats, ${tree.opaque} opaque, ${tree.wildcards} wildcards)`,
    `states: ${summary.stateCount} in ${summary.clusters} clusters${summary.states === summary.stateCount ? "" : `, ${summary.states} enumerated`}${summary.omitted ? " (incomplete)" : ""}`,
    ...formatGuardCoverageLines(summary.coverage),
  ];
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

export const formatComparisonReport = (
  report: ComparisonReport,
  stateSpace: StateSpaceSummary | null = null,
  states: StaticState[] = [],
): string => {
  const lines = [
    `status: ${report.status}`,
    `coverage: ${percent(report.coverage)} (${report.matchedFibers} fibers + ${report.matchedText} text of ${report.runtimeFibers} runtime nodes; ${report.staticFibers} static)`,
    `uncertainty: branches=${report.branchesResolved} repeats=${report.repeatIterations} opaque=${report.opaqueSubtrees} (${report.opaqueSkippedFibers} skipped, ${report.opaqueRenamed} renamed, slots ${report.slotsMatched} matched/${report.slotsUnmatched} unmatched) wildcard=${report.wildcardAbsorbedFibers}`,
    `steps: ${report.stepsUsed}${report.budgetExhausted ? " (budget exhausted)" : ""}`,
  ];
  if (stateSpace) lines.push(...formatStateSpaceSummary(stateSpace, states));
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

const formatInput = (input: InputVariable): string =>
  `${input.id} = ${input.label} <${input.source}>${formatLocation(input.location)}`;

class DecisionHandles {
  private readonly handles = new Map<string, string>();

  of(variable: string): string {
    let handle = this.handles.get(variable);
    if (handle === undefined) {
      handle = `d${this.handles.size + 1}`;
      this.handles.set(variable, handle);
    }
    return handle;
  }
}

const formatSymbolicNodes = (
  nodes: PatternNode[],
  depth: number,
  handles: DecisionHandles,
): string[] => {
  const indent = "  ".repeat(depth);
  return nodes.flatMap((node): string[] => {
    switch (node.kind) {
      case "fiber": {
        const key = node.key === null ? "" : ` key=${JSON.stringify(node.key)}`;
        return [
          `${indent}<${node.name ?? node.tag}>${key}`,
          ...formatSymbolicNodes(node.children, depth + 1, handles),
        ];
      }
      case "text":
        return [`${indent}${node.text === null ? "?text" : JSON.stringify(node.text)}`];
      case "branch":
        return [
          `${indent}?${handles.of(node.variable)} ${node.reason}${formatLocation(node.location)}`,
          ...node.alternatives.flatMap((alternative, index) => [
            `${indent}  |${index} ${formatGuard(node.guards[index])}${index === node.preferredIndex ? " (preferred)" : ""}`,
            ...formatSymbolicNodes(alternative, depth + 2, handles),
          ]),
        ];
      case "repeat":
        return [
          `${indent}*${handles.of(node.variable)} ${formatVariable(node.cardinality)} in ${formatRepeatBounds(node.count)}${formatLocation(node.location)}`,
          ...formatSymbolicNodes(node.children, depth + 1, handles),
        ];
      case "opaque":
        return [
          `${indent}?opaque <${node.name}> (${node.reason})`,
          ...formatSymbolicNodes(node.passedChildren, depth + 1, handles),
        ];
      case "wildcard":
        return [`${indent}~wildcard (${node.reason})${node.isTruncated ? " truncated" : ""}`];
    }
  });
};

const formatDecisionRow = (conditions: StateCondition[], handles: DecisionHandles): string =>
  conditions
    .map((condition) => {
      switch (condition.kind) {
        case "branch":
        case "state-update":
          return `${handles.of(condition.variable)}|${condition.alternativeIndex}`;
        case "repeat":
          return `${handles.of(condition.variable)}×${condition.count}`;
        case "transition":
          return `commit=${condition.commit}`;
      }
    })
    .join("  ");

/** One decision table per independent cluster: each row is one consistent assignment of its decisions. */
const formatDecisionTable = (cluster: GuardCluster, handles: DecisionHandles): string[] => [
  `  over ${cluster.inputs.join(", ")}: ${cluster.states.length} states${cluster.isTruncated ? " (truncated)" : ""}`,
  ...cluster.states
    .slice(0, MAX_TABLE_ROWS)
    .map((state) => `    ${formatDecisionRow(state, handles)}`),
  ...(cluster.states.length > MAX_TABLE_ROWS
    ? [`    … and ${cluster.states.length - MAX_TABLE_ROWS} more`]
    : []),
];

/**
 * The agent-facing rendering: every input with its provenance, the tree with
 * guards inline at each uncertain node, and per commit the decision table of
 * each independent guard cluster.
 */
export const formatSymbolicTree = (
  tree: SymbolicTree,
  budget: StateSpaceBudget = DEFAULT_STATE_SPACE_BUDGET,
): string => {
  const lines = [
    `inputs (${tree.inputs.length}):`,
    ...tree.inputs.map((input) => `  ${formatInput(input)}`),
  ];
  const commits = enumerateClusters(tree, budget);
  const handles = new DecisionHandles();
  tree.commits.forEach((commit, index) => {
    lines.push(
      tree.commits.length > 1
        ? `commit ${index + 1} of ${tree.commits.length} [${formatGuard(commit.guard)}]:`
        : "tree:",
    );
    lines.push(...formatSymbolicNodes(commit.tree, 1, handles));
    const { clusters } = commits[index];
    if (clusters.length > 0) {
      lines.push(`decisions (${clusters.length} independent clusters):`);
      for (const cluster of clusters) lines.push(...formatDecisionTable(cluster, handles));
    }
  });
  return lines.join("\n");
};
