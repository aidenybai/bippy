import { StateSpaceError } from "../errors.js";
import {
  matchPatternToRuntime,
  type ComparisonDivergence,
  type ComparisonOptions,
  type ComparisonReport,
  type ComparisonStatus,
  type DecisionConstraint,
  type MatchDecision,
  type PatternMatch,
} from "./compare.js";
import type { RuntimeFiberSnapshot } from "./snapshot.js";
import {
  branchCondition,
  conditionValue,
  enumerateClusters,
  enumerateCommitStates,
  repeatCondition,
  stateIndexOf,
  type CommitStateSpace,
  type GuardCluster,
} from "./enumerate-states.js";
import { GuardSolver } from "./guard-solver.js";
import type { PatternNode } from "./static-pattern.js";
import type { GuardCoverage } from "./guard-coverage.js";
import {
  buildSymbolicTree,
  decisionGuard,
  type SymbolicTree,
  type SymbolicTreeStats,
} from "./symbolic-tree.js";

// A static render describes a set of concrete fiber trees, one per assignment
// of its decision variables (branches, repeat counts) per committed render.
// The symbolic tree is the artifact; the states are a view derived from it on
// demand, bounded by a budget, and every state left out is recorded so the
// view is never mistaken for complete.

/** A branch predicate took one alternative; `state-update` when the predicate is a state cell's value. */
export interface BranchCondition {
  kind: "branch" | "state-update";
  variable: string;
  reason: string;
  location: string | null;
  alternativeIndex: number;
  alternativeCount: number;
}

export interface RepeatCondition {
  kind: "repeat";
  variable: string;
  location: string | null;
  count: number;
}

/** The tree is the one React committed at `commit` (0-based) while effects, state updates and timers settled. */
export interface TransitionCondition {
  kind: "transition";
  commit: number;
  commitCount: number;
}

export type StateCondition = BranchCondition | RepeatCondition | TransitionCondition;

export interface StaticState {
  /** A concrete pattern: no branches or repeats remain, only fibers, text, opaque subtrees and wildcards. */
  tree: PatternNode[];
  conditions: StateCondition[];
}

export interface StateSpaceBudget {
  maxStates: number;
  /** Cardinalities enumerated above a repeat's minimum; larger counts are omitted. */
  maxRepeat: number;
}

/** An alternative never expanded, under the decisions in `conditions`, because the state budget ran out first. */
export interface OmittedBranchStates {
  kind: "branch";
  variable: string;
  reason: string;
  location: string | null;
  alternativeIndex: number;
  conditions: StateCondition[];
}

/**
 * Repeat counts above `countsAbove` (up to `max`, unbounded when null) were not
 * enumerated: everywhere when `conditions` is empty (the repeat bound), else
 * under those decisions (the state budget).
 */
export interface OmittedRepeatStates {
  kind: "repeat";
  variable: string;
  location: string | null;
  countsAbove: number;
  max: number | null;
  conditions: StateCondition[];
}

/** A fully decided state dropped because the state budget was already full. */
export interface OmittedState {
  kind: "state";
  conditions: StateCondition[];
}

/** A subtree the materializer did not render, so whatever states it holds are missing. */
export interface OmittedSubtree {
  kind: "subtree";
  reason: string;
}

export type StateOmission =
  | OmittedBranchStates
  | OmittedRepeatStates
  | OmittedState
  | OmittedSubtree;

export interface OmittedStateSpace {
  /** What the tree itself lacks: alternatives, repeat counts, cluster states or subtrees never enumerated. */
  omissions: StateOmission[];
  /** Whole states of a complete tree beyond `budget.maxStates`, counted without being instantiated. */
  droppedStates: number;
}

export interface StaticStateSpace {
  tree: SymbolicTree;
  /** The distinct committed patterns, in commit order; the trees of `tree.commits`. */
  commits: PatternNode[][];
  /** Per commit, its independent guard clusters, each enumerated within the budget. */
  commitStates: CommitStateSpace[];
  budget: StateSpaceBudget;
  /** Consistent states over all commits, whether or not `states` holds them. */
  stateCount: number;
  /** The first `budget.maxStates` states, instantiated when first read. */
  readonly states: StaticState[];
  /** Non-null whenever some reachable state is not in `states`. */
  readonly omitted: OmittedStateSpace | null;
}

export const DEFAULT_STATE_SPACE_BUDGET: StateSpaceBudget = { maxStates: 256, maxRepeat: 2 };

/** Omissions kept verbatim in a summary; the rest are only counted in `total`. */
const MAX_SUMMARIZED_OMISSIONS = 32;

const dedupeCommits = (commits: PatternNode[][]): PatternNode[][] => {
  const seen = new Set<string>();
  return commits.filter((pattern) => {
    const key = JSON.stringify(pattern);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

class DerivedStateSpace implements StaticStateSpace {
  readonly commits: PatternNode[][];
  readonly commitStates: CommitStateSpace[];
  readonly stateCount: number;
  private enumerated: StaticState[] | null = null;
  private omittedView: OmittedStateSpace | null | undefined;

  constructor(
    readonly tree: SymbolicTree,
    readonly budget: StateSpaceBudget,
  ) {
    this.commits = tree.commits.map((commit) => commit.tree);
    this.commitStates = enumerateClusters(tree, budget);
    this.stateCount = this.commitStates.reduce((sum, commit) => sum + commit.stateCount, 0);
  }

  get states(): StaticState[] {
    this.enumerated ??= [...enumerateCommitStates(this.commitStates, this.budget)];
    return this.enumerated;
  }

  get omitted(): OmittedStateSpace | null {
    if (this.omittedView === undefined) {
      const droppedStates = Math.max(0, this.stateCount - this.budget.maxStates);
      const omissions = this.commitStates.flatMap((commit) => commit.omissions);
      this.omittedView =
        omissions.length === 0 && droppedStates === 0 ? null : { omissions, droppedStates };
    }
    return this.omittedView;
  }
}

/**
 * The state space of the committed patterns, derived from their symbolic tree.
 * Independent clusters of decisions are enumerated apart and only multiplied
 * into whole states on demand; a variable met again inside one tree takes the
 * value already chosen for it; decisions inside a repeat are made per
 * iteration. Whole states stop at `budget.maxStates` and repeat counts at
 * `budget.maxRepeat` above the known minimum, and both are reported in `omitted`.
 */
export const enumerateStateSpace = (
  commitPatterns: PatternNode[][],
  budget: StateSpaceBudget = DEFAULT_STATE_SPACE_BUDGET,
): StaticStateSpace =>
  new DerivedStateSpace(buildSymbolicTree(dedupeCommits(commitPatterns)), budget);

export interface MatchedState {
  /** Index into `states`; null when the state lies beyond the budget or in the omitted part of the space. */
  index: number | null;
  conditions: StateCondition[];
}

export interface ClosestState {
  index: number;
  divergence: ComparisonDivergence;
}

export interface StateSpaceMatch {
  status: ComparisonStatus;
  report: ComparisonReport;
  matched: MatchedState | null;
  /** On a mismatch, the enumerated state that agrees with the furthest-reaching attempt on the most decisions. */
  closest: ClosestState | null;
}

export interface OmittedStateSummary {
  total: number;
  omissions: StateOmission[];
}

/** What a comparison learned about the state space, small enough to persist alongside the report. */
export interface StateSpaceSummary {
  /** States instantiated within the budget. */
  states: number;
  /** Consistent states in the tree, counted from its clusters. */
  stateCount: number;
  clusters: number;
  tree: SymbolicTreeStats;
  matchedState: MatchedState | null;
  closestState: ClosestState | null;
  omitted: OmittedStateSummary | null;
  coverage: GuardCoverage;
}

export const summarizeOmissions = (omitted: OmittedStateSpace | null): OmittedStateSummary | null =>
  omitted && {
    total: omitted.omissions.length + omitted.droppedStates,
    omissions: omitted.omissions.slice(0, MAX_SUMMARIZED_OMISSIONS),
  };

const toCondition = (decision: MatchDecision): StateCondition =>
  decision.node.kind === "branch"
    ? branchCondition(decision.node, decision.choice)
    : repeatCondition(decision.node, decision.choice);

const conditionKey = (condition: StateCondition): string =>
  condition.kind === "transition" ? "transition" : condition.variable;

const conditionValues = (conditions: StateCondition[]): Map<string, number> =>
  new Map(conditions.map((condition) => [conditionKey(condition), conditionValue(condition)]));

const isSubsetOf = (state: StateCondition[], values: ReadonlyMap<string, number>): boolean =>
  state.every((condition) => values.get(conditionKey(condition)) === conditionValue(condition));

/** The index of the cluster state whose decisions `values` all carries; null when the cluster enumerated none such. */
const findClusterState = (
  cluster: GuardCluster,
  values: ReadonlyMap<string, number>,
): number | null => {
  const index = cluster.states.findIndex((state) => isSubsetOf(state, values));
  return index === -1 ? null : index;
};

const commitOffset = (stateSpace: StaticStateSpace, commit: number): number =>
  stateSpace.commitStates.slice(0, commit).reduce((sum, earlier) => sum + earlier.stateCount, 0);

interface StatePosition {
  /** Whether every cluster enumerated the decisions taken: the state exists, in `states` or beyond the budget. */
  isMember: boolean;
  index: number | null;
}

/** Where the state deciding exactly `conditions` sits among all states, located cluster by cluster without instantiating any. */
const findState = (
  stateSpace: StaticStateSpace,
  commit: number,
  conditions: StateCondition[],
): StatePosition => {
  const commitStates = stateSpace.commitStates[commit];
  const values = conditionValues(conditions);
  const indices: number[] = [];
  let covered = 0;
  for (const cluster of commitStates.clusters) {
    const index = findClusterState(cluster, values);
    if (index === null) return { isMember: false, index: null };
    indices.push(index);
    covered += cluster.states[index].length;
  }
  if (covered !== conditions.length) return { isMember: false, index: null };
  const index = commitOffset(stateSpace, commit) + stateIndexOf(commitStates, indices);
  return { isMember: true, index: index < stateSpace.budget.maxStates ? index : null };
};

const agreement = (state: StateCondition[], assignment: ReadonlyMap<string, number>): number =>
  state.filter((condition) => assignment.get(conditionKey(condition)) === conditionValue(condition))
    .length;

/** The enumerated state agreeing with `assignment` on the most decisions, cluster by cluster. */
const findClosestState = (
  stateSpace: StaticStateSpace,
  commit: number,
  assignment: ReadonlyMap<string, number>,
): number | null => {
  const commitStates = stateSpace.commitStates[commit];
  const indices = commitStates.clusters.map((cluster) => {
    let closest = 0;
    let closestAgreement = -1;
    cluster.states.forEach((state, index) => {
      const agreed = agreement(state, assignment);
      if (agreed > closestAgreement) {
        closest = index;
        closestAgreement = agreed;
      }
    });
    return closest;
  });
  if (commitStates.clusters.some((cluster) => cluster.states.length === 0)) return null;
  const index = commitOffset(stateSpace, commit) + stateIndexOf(commitStates, indices);
  return index < stateSpace.budget.maxStates ? index : null;
};

/** A member of a tree whose clusters are complete is exact even when whole states were dropped from `states`; anything missing from the tree itself is a truncation. */
const classifyMatch = (
  report: ComparisonReport,
  stateSpace: StaticStateSpace,
  position: StatePosition,
): ComparisonStatus => {
  if (report.status !== "exact") return report.status;
  if (!position.isMember) return "truncated";
  return (stateSpace.omitted?.omissions.length ?? 0) > 0 ? "truncated" : "exact";
};

/** Lets the comparer take only decisions whose guards are jointly satisfiable. */
const guardedDecisions = (): DecisionConstraint => {
  const solver = new GuardSolver();
  return {
    decide: (node, choice) => solver.push(decisionGuard(node, choice)),
    release: () => solver.pop(),
  };
};

interface CommitAttempt {
  commit: number;
  match: PatternMatch;
}

/**
 * Decides whether the runtime tree is a state of the symbolic tree by walking
 * both together and taking only decisions whose guards stay jointly
 * satisfiable; no whole state is instantiated. The latest commit is tried
 * first, as a settled runtime most often shows it. A member beyond
 * `budget.maxStates` is reported with `index: null`; a runtime tree that
 * matches only under decisions the tree omitted is `truncated`, never exact.
 */
export const matchStateSpace = (
  stateSpace: StaticStateSpace,
  runtime: RuntimeFiberSnapshot[],
  options: ComparisonOptions = {},
): StateSpaceMatch => {
  let furthest: CommitAttempt | null = null;
  for (let commit = stateSpace.commits.length - 1; commit >= 0; commit--) {
    const match = matchPatternToRuntime(stateSpace.commits[commit], runtime, {
      ...options,
      constraint: guardedDecisions(),
    });
    if (match.report.status !== "mismatch") {
      const transition = stateSpace.commitStates[commit].transition;
      const decided = match.decisions.map(toCondition);
      const conditions: StateCondition[] = [...(transition ? [transition] : []), ...decided];
      const position = findState(stateSpace, commit, decided);
      const status = classifyMatch(match.report, stateSpace, position);
      return {
        status,
        report: { ...match.report, status },
        matched: { index: position.index, conditions },
        closest: null,
      };
    }
    const position = match.failure?.position ?? -1;
    if (!furthest || position > (furthest.match.failure?.position ?? -1)) {
      furthest = { commit, match };
    }
  }
  if (!furthest) {
    throw new StateSpaceError(
      "a state space needs at least one committed pattern to match against",
    );
  }
  const { failure } = furthest.match;
  const closestIndex = failure
    ? findClosestState(stateSpace, furthest.commit, failure.assignment)
    : null;
  return {
    status: "mismatch",
    report: furthest.match.report,
    matched: null,
    closest:
      closestIndex !== null && failure
        ? { index: closestIndex, divergence: failure.divergence }
        : null,
  };
};
