import { StateSpaceError } from "../errors.js";
import {
  matchPatternToRuntime,
  type ComparisonDivergence,
  type ComparisonOptions,
  type ComparisonReport,
  type ComparisonStatus,
  type MatchDecision,
  type PatternMatch,
} from "./compare.js";
import type { RuntimeFiberSnapshot } from "./snapshot.js";
import {
  hasPatternDecisions,
  scopePatternVariables,
  type PatternBranch,
  type PatternNode,
  type PatternRepeat,
} from "./static-pattern.js";

// A static render describes a set of concrete fiber trees, one per assignment
// of its decision variables (branches, repeat counts) per committed render.
// The set is enumerated here, bounded by a budget, and every state left out is
// recorded so the enumeration is never mistaken for complete.

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
  omissions: StateOmission[];
}

export interface StaticStateSpace {
  states: StaticState[];
  budget: StateSpaceBudget;
  /** Non-null whenever some reachable state is not in `states`. */
  omitted: OmittedStateSpace | null;
  /** The distinct committed patterns the states were expanded from, in commit order. */
  commits: PatternNode[][];
}

export const DEFAULT_STATE_SPACE_BUDGET: StateSpaceBudget = { maxStates: 256, maxRepeat: 2 };

const STATE_PREDICATE_PREFIX = "state(";

type ConditionMap = ReadonlyMap<string, StateCondition>;

interface Emit {
  (nodes: PatternNode[], conditions: ConditionMap): void;
}

const branchCondition = (node: PatternBranch, alternativeIndex: number): BranchCondition => ({
  kind: node.variable.startsWith(STATE_PREDICATE_PREFIX) ? "state-update" : "branch",
  variable: node.variable,
  reason: node.reason,
  location: node.location,
  alternativeIndex,
  alternativeCount: node.alternatives.length,
});

const repeatCondition = (node: PatternRepeat, count: number): RepeatCondition => ({
  kind: "repeat",
  variable: node.variable,
  location: node.location,
  count,
});

/** A single commit needs no transition to select it. */
const transitionCondition = (commit: number, commitCount: number): TransitionCondition | null =>
  commitCount > 1 ? { kind: "transition", commit, commitCount } : null;

const iterationScope = (node: PatternRepeat, iteration: number): string =>
  `${node.variable}[${iteration}]`;

class StateEnumerator {
  readonly states: StaticState[] = [];
  private readonly omissions = new Map<string, StateOmission>();
  private isExhausted = false;

  constructor(private readonly budget: StateSpaceBudget) {}

  get omitted(): OmittedStateSpace | null {
    return this.omissions.size === 0 ? null : { omissions: [...this.omissions.values()] };
  }

  enumerate(pattern: PatternNode[], transition: TransitionCondition | null): void {
    this.isExhausted = this.states.length >= this.budget.maxStates;
    this.expandList(pattern, 0, [], new Map(), (tree, conditions) => {
      const stateConditions = transition
        ? [transition, ...conditions.values()]
        : [...conditions.values()];
      if (this.states.length >= this.budget.maxStates) {
        this.isExhausted = true;
        this.omit(`state|${describeConditions(stateConditions)}`, {
          kind: "state",
          conditions: stateConditions,
        });
        return;
      }
      this.states.push({ tree, conditions: stateConditions });
    });
  }

  private omit(key: string, omission: StateOmission): void {
    const existing = this.omissions.get(key);
    if (existing?.kind === "repeat" && omission.kind === "repeat") {
      omission = { ...omission, countsAbove: Math.min(existing.countsAbove, omission.countsAbove) };
    }
    this.omissions.set(key, omission);
  }

  private omitUnderBudget(
    conditions: ConditionMap,
    omission: OmittedBranchStates | OmittedRepeatStates,
  ): void {
    const under = [...conditions.values()];
    const subject =
      omission.kind === "branch"
        ? `${omission.variable}|${omission.alternativeIndex}`
        : omission.variable;
    this.omit(`${subject}|${describeConditions(under)}`, { ...omission, conditions: under });
  }

  private expandList(
    nodes: PatternNode[],
    index: number,
    prefix: PatternNode[],
    conditions: ConditionMap,
    emit: Emit,
  ): void {
    if (this.isExhausted) return;
    const expanded = [...prefix];
    let cursor = index;
    while (cursor < nodes.length && !hasPatternDecisions(nodes[cursor])) {
      expanded.push(nodes[cursor++]);
    }
    if (cursor === nodes.length) {
      emit(expanded, conditions);
      return;
    }
    this.expandNode(nodes[cursor], conditions, (expandedNode, next) =>
      this.expandList(nodes, cursor + 1, [...expanded, ...expandedNode], next, emit),
    );
  }

  private expandNode(node: PatternNode, conditions: ConditionMap, emit: Emit): void {
    switch (node.kind) {
      case "text":
        emit([node], conditions);
        return;
      case "wildcard":
        if (node.isTruncated) this.omit(node.reason, { kind: "subtree", reason: node.reason });
        emit([node], conditions);
        return;
      case "fiber":
        this.expandList(node.children, 0, [], conditions, (children, next) =>
          emit([{ ...node, children }], next),
        );
        return;
      case "opaque":
        this.expandList(node.passedChildren, 0, [], conditions, (passedChildren, next) =>
          emit([{ ...node, passedChildren }], next),
        );
        return;
      case "branch":
        this.expandBranch(node, conditions, emit);
        return;
      case "repeat":
        this.expandRepeat(node, conditions, emit);
        return;
    }
  }

  private expandBranch(node: PatternBranch, conditions: ConditionMap, emit: Emit): void {
    const decided = conditions.get(node.variable);
    if (decided && decided.kind !== "repeat" && decided.kind !== "transition") {
      this.expandList(node.alternatives[decided.alternativeIndex] ?? [], 0, [], conditions, emit);
      return;
    }
    node.alternatives.forEach((alternative, alternativeIndex) => {
      if (this.isExhausted) {
        this.omitUnderBudget(conditions, {
          kind: "branch",
          variable: node.variable,
          reason: node.reason,
          location: node.location,
          alternativeIndex,
          conditions: [],
        });
        return;
      }
      const next = new Map(conditions).set(node.variable, branchCondition(node, alternativeIndex));
      this.expandList(alternative, 0, [], next, emit);
    });
  }

  private expandRepeat(node: PatternRepeat, conditions: ConditionMap, emit: Emit): void {
    const { min, max } = node.count;
    const enumeratedMax =
      max === null ? min + this.budget.maxRepeat : Math.min(max, min + this.budget.maxRepeat);
    const omittedCounts = (countsAbove: number): OmittedRepeatStates => ({
      kind: "repeat",
      variable: node.variable,
      location: node.location,
      countsAbove,
      max,
      conditions: [],
    });
    if (max === null || max > enumeratedMax) {
      this.omit(node.variable, omittedCounts(enumeratedMax));
    }
    for (let count = min; count <= enumeratedMax; count++) {
      if (this.isExhausted) {
        this.omitUnderBudget(conditions, omittedCounts(count - 1));
        return;
      }
      const next = new Map(conditions).set(node.variable, repeatCondition(node, count));
      this.expandIterations(node, count, 0, [], next, emit);
    }
  }

  private expandIterations(
    node: PatternRepeat,
    count: number,
    iteration: number,
    prefix: PatternNode[],
    conditions: ConditionMap,
    emit: Emit,
  ): void {
    if (this.isExhausted) return;
    if (iteration === count) {
      emit(prefix, conditions);
      return;
    }
    this.expandList(
      scopePatternVariables(node.children, iterationScope(node, iteration)),
      0,
      [],
      conditions,
      (nodes, next) =>
        this.expandIterations(node, count, iteration + 1, [...prefix, ...nodes], next, emit),
    );
  }
}

const dedupeCommits = (commits: PatternNode[][]): PatternNode[][] => {
  const seen = new Set<string>();
  return commits.filter((pattern) => {
    const key = JSON.stringify(pattern);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

/**
 * Expands every committed pattern into the concrete trees it stands for.
 * Independent decisions multiply; a variable met again inside one tree takes
 * the value already chosen for it; decisions inside a repeat are made per
 * iteration. Enumeration stops at `budget.maxStates` and repeat counts stop at
 * `budget.maxRepeat` above the known minimum, and both are reported in `omitted`.
 */
export const enumerateStateSpace = (
  commitPatterns: PatternNode[][],
  budget: StateSpaceBudget = DEFAULT_STATE_SPACE_BUDGET,
): StaticStateSpace => {
  const commits = dedupeCommits(commitPatterns);
  const enumerator = new StateEnumerator(budget);
  commits.forEach((pattern, commit) => {
    enumerator.enumerate(pattern, transitionCondition(commit, commits.length));
  });
  return { states: enumerator.states, budget, omitted: enumerator.omitted, commits };
};

export interface MatchedState {
  /** Index into `states`; null when the runtime tree lies in the omitted part of the state space. */
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

/** Omissions kept verbatim in a summary; the rest are only counted in `total`. */
const MAX_SUMMARIZED_OMISSIONS = 32;

export interface OmittedStateSummary {
  total: number;
  omissions: StateOmission[];
}

/** What a comparison learned about the state space, small enough to persist alongside the report. */
export interface StateSpaceSummary {
  states: number;
  matchedState: MatchedState | null;
  closestState: ClosestState | null;
  omitted: OmittedStateSummary | null;
}

export const summarizeOmissions = (omitted: OmittedStateSpace | null): OmittedStateSummary | null =>
  omitted && {
    total: omitted.omissions.length,
    omissions: omitted.omissions.slice(0, MAX_SUMMARIZED_OMISSIONS),
  };

const toCondition = (decision: MatchDecision): StateCondition =>
  decision.node.kind === "branch"
    ? branchCondition(decision.node, decision.choice)
    : repeatCondition(decision.node, decision.choice);

const conditionValue = (condition: StateCondition): number => {
  switch (condition.kind) {
    case "branch":
    case "state-update":
      return condition.alternativeIndex;
    case "repeat":
      return condition.count;
    case "transition":
      return condition.commit;
  }
};

const conditionKey = (condition: StateCondition): string =>
  condition.kind === "transition" ? "transition" : condition.variable;

const describeConditions = (conditions: StateCondition[]): string =>
  conditions
    .map((condition) => `${conditionKey(condition)}=${conditionValue(condition)}`)
    .join(",");

const haveSameConditions = (left: StateCondition[], right: StateCondition[]): boolean => {
  if (left.length !== right.length) return false;
  const values = new Map(
    left.map((condition) => [conditionKey(condition), conditionValue(condition)]),
  );
  return right.every(
    (condition) => values.get(conditionKey(condition)) === conditionValue(condition),
  );
};

const findState = (states: StaticState[], conditions: StateCondition[]): number | null => {
  const index = states.findIndex((state) => haveSameConditions(state.conditions, conditions));
  return index === -1 ? null : index;
};

const stateCommit = (state: StaticState): number =>
  state.conditions.find((condition) => condition.kind === "transition")?.commit ?? 0;

const findClosestState = (
  states: StaticState[],
  assignment: ReadonlyMap<string, number>,
  commit: number,
): number | null => {
  let closest: number | null = null;
  let closestAgreement = -1;
  states.forEach((state, index) => {
    if (stateCommit(state) !== commit) return;
    const agreement = state.conditions.filter(
      (condition) =>
        condition.kind !== "transition" &&
        assignment.get(condition.variable) === conditionValue(condition),
    ).length;
    if (agreement > closestAgreement) {
      closest = index;
      closestAgreement = agreement;
    }
  });
  return closest;
};

const classifyMatch = (
  report: ComparisonReport,
  stateSpace: StaticStateSpace,
): ComparisonStatus => {
  if (report.status !== "exact") return report.status;
  return stateSpace.omitted ? "truncated" : "exact";
};

interface CommitAttempt {
  commit: number;
  match: PatternMatch;
}

/**
 * Decides whether the runtime tree is one of the enumerated states. The
 * latest commit is tried first, as a settled runtime most often shows it.
 * A runtime tree that matches under decisions no enumerated state carries lies
 * in the omitted part of the space and is reported as such, never as exact.
 */
export const matchStateSpace = (
  stateSpace: StaticStateSpace,
  runtime: RuntimeFiberSnapshot[],
  options: ComparisonOptions = {},
): StateSpaceMatch => {
  let furthest: CommitAttempt | null = null;
  for (let commit = stateSpace.commits.length - 1; commit >= 0; commit--) {
    const match = matchPatternToRuntime(stateSpace.commits[commit], runtime, options);
    if (match.report.status !== "mismatch") {
      const transition = transitionCondition(commit, stateSpace.commits.length);
      const conditions: StateCondition[] = [
        ...(transition ? [transition] : []),
        ...match.decisions.map(toCondition),
      ];
      const index = findState(stateSpace.states, conditions);
      const classified = classifyMatch(match.report, stateSpace);
      const status = index === null && classified === "exact" ? "truncated" : classified;
      return {
        status,
        report: { ...match.report, status },
        matched: { index, conditions },
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
    ? findClosestState(stateSpace.states, failure.assignment, furthest.commit)
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
