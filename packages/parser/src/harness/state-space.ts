import { StateSpaceError } from "../errors.js";
import {
  FALSY_OUTCOME,
  TRUTHY_OUTCOME,
  getCountVariable,
  parseCountVariable,
  parsePredicate,
  readPolarity,
  type CountPredicate,
} from "../evaluate/predicates.js";
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

/**
 * A predicate that branches derive from (a state cell's value, a comparison)
 * took one alternative. Decided while enumerating, but not part of a state:
 * the runtime tree only shows which alternatives the branches took.
 */
interface DecisionCondition {
  kind: "decision";
  variable: string;
  alternativeIndex: number;
  alternativeCount: number;
}

type Decided = BranchCondition | DecisionCondition;

type ConditionMap = ReadonlyMap<string, StateCondition | DecisionCondition>;

interface Emit {
  (nodes: PatternNode[], conditions: ConditionMap): void;
}

interface OnDecided {
  (alternativeIndex: number, conditions: ConditionMap): void;
}

interface OnTruthiness {
  (isTruthy: boolean, conditions: ConditionMap): void;
}

const isDecided = (
  condition: StateCondition | DecisionCondition | undefined | null,
): condition is Decided =>
  condition !== undefined &&
  condition !== null &&
  condition.kind !== "repeat" &&
  condition.kind !== "transition";

const isStateCondition = (
  condition: StateCondition | DecisionCondition,
): condition is StateCondition => condition.kind !== "decision";

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

const SCOPE_SEPARATOR = "@";

/**
 * The decision taken for `variable` in the iteration named by `scope`, or in
 * an enclosing iteration or outside every repeat when the variable was
 * decided there (a value from outside a loop tested inside it).
 */
const findCondition = (
  variable: string,
  scope: string,
  conditions: ConditionMap,
): StateCondition | DecisionCondition | null => {
  for (let suffix = scope; ; suffix = suffix.slice(0, suffix.lastIndexOf(SCOPE_SEPARATOR))) {
    const condition = conditions.get(`${variable}${suffix}`);
    if (condition) return condition;
    if (!suffix.includes(SCOPE_SEPARATOR)) return null;
  }
};

const findDecision = (variable: string, scope: string, conditions: ConditionMap): Decided | null => {
  const condition = findCondition(variable, scope, conditions);
  return isDecided(condition) ? condition : null;
};

interface CountDecision {
  predicate: CountPredicate;
  isAbove: boolean;
}

/** The `countAbove` decisions taken in `scope` about the repeat count `subject`. */
const getCountDecisions = (
  subject: string,
  scope: string,
  conditions: ConditionMap,
): CountDecision[] => {
  const decisions: CountDecision[] = [];
  for (const condition of conditions.values()) {
    if (!isDecided(condition)) continue;
    const parsed = parsePredicate(condition.variable);
    if (
      parsed?.predicate.kind === "count" &&
      parsed.predicate.subject === subject &&
      parsed.scope === scope
    ) {
      decisions.push({ predicate: parsed.predicate, isAbove: condition.alternativeIndex === 0 });
    }
  }
  return decisions;
};

/** Whether a repeat can have `count` items given what was decided about its count before it was reached. */
const isCountAllowed = (node: PatternRepeat, count: number, conditions: ConditionMap): boolean => {
  const parsed = parseCountVariable(node.variable);
  if (!parsed) return true;
  return getCountDecisions(parsed.subject, parsed.scope, conditions).every(
    ({ predicate, isAbove }) => count > predicate.threshold === isAbove,
  );
};

const resolveCount = (
  { subject, threshold }: CountPredicate,
  scope: string,
  conditions: ConditionMap,
): boolean | null => {
  const repeat = findCondition(getCountVariable(subject), scope, conditions);
  if (repeat?.kind === "repeat") return repeat.count > threshold;
  for (const { predicate, isAbove } of getCountDecisions(subject, scope, conditions)) {
    if (isAbove && predicate.threshold >= threshold) return true;
    if (!isAbove && predicate.threshold <= threshold) return false;
  }
  return null;
};

const resolveOutcome = (outcome: string, scope: string, conditions: ConditionMap): boolean | null => {
  if (outcome === TRUTHY_OUTCOME) return true;
  if (outcome === FALSY_OUTCOME) return false;
  const { predicate, isNegated } = readPolarity(outcome);
  const truthiness = resolveTruthiness(predicate, scope, conditions);
  return truthiness === null ? null : truthiness !== isNegated;
};

/**
 * Whether a truthiness predicate already follows from the decisions taken: a
 * two-way branch on it took its truthy (first) alternative, the value it
 * derives from is decided, a strict comparison of the same value with a
 * different literal already holds, or the repeat count it compares is known.
 */
const resolveTruthiness = (
  predicate: string,
  scope: string,
  conditions: ConditionMap,
): boolean | null => {
  const decided = findDecision(predicate, scope, conditions);
  if (decided && decided.alternativeCount === 2) return decided.alternativeIndex === 0;
  const parsed = parsePredicate(predicate);
  if (!parsed) return null;
  const innerScope = `${parsed.scope}${scope}`;
  if (parsed.predicate.kind === "derived") {
    const decision = findDecision(parsed.predicate.decision, innerScope, conditions);
    if (!decision) return null;
    const outcome = parsed.predicate.outcomes[decision.alternativeIndex];
    return outcome === undefined ? null : resolveOutcome(outcome, innerScope, conditions);
  }
  if (parsed.predicate.kind === "count") return resolveCount(parsed.predicate, innerScope, conditions);
  const { subject, key, isNegated } = parsed.predicate;
  for (const condition of conditions.values()) {
    if (!isDecided(condition)) continue;
    const other = parsePredicate(condition.variable);
    if (
      other?.predicate.kind !== "equality" ||
      other.predicate.subject !== subject ||
      other.scope !== innerScope
    ) {
      continue;
    }
    const isEqual = (condition.alternativeIndex === 0) !== other.predicate.isNegated;
    if (other.predicate.key === key) return isEqual !== isNegated;
    if (isEqual) return isNegated;
  }
  return null;
};

class StateEnumerator {
  readonly states: StaticState[] = [];
  private readonly omissions = new Map<string, StateOmission>();
  private readonly stateKeys = new Set<string>();
  private isExhausted = false;

  constructor(private readonly budget: StateSpaceBudget) {}

  get omitted(): OmittedStateSpace | null {
    return this.omissions.size === 0 ? null : { omissions: [...this.omissions.values()] };
  }

  enumerate(pattern: PatternNode[], transition: TransitionCondition | null): void {
    this.isExhausted = this.states.length >= this.budget.maxStates;
    this.expandList(pattern, 0, [], new Map(), (tree, conditions) => {
      const decided = [...conditions.values()].filter(isStateCondition);
      const stateConditions = transition ? [transition, ...decided] : decided;
      const key = describeConditions(stateConditions);
      if (this.stateKeys.has(key)) return;
      if (this.states.length >= this.budget.maxStates) {
        this.isExhausted = true;
        this.omit(`state|${describeConditions(stateConditions)}`, {
          kind: "state",
          conditions: stateConditions,
        });
        return;
      }
      this.stateKeys.add(key);
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
    const under = [...conditions.values()].filter(isStateCondition);
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
    this.decideBranch(node, conditions, (alternativeIndex, decided) => {
      const next = new Map(decided).set(node.variable, branchCondition(node, alternativeIndex));
      this.expandList(node.alternatives[alternativeIndex] ?? [], 0, [], next, emit);
    });
  }

  /**
   * The alternative a branch takes under the decisions made so far; a branch on
   * a predicate derived from other decisions (the truthiness of a state cell's
   * value) is settled by enumerating those, so every branch reading the same
   * decision follows it.
   */
  private decideBranch(node: PatternBranch, conditions: ConditionMap, onDecided: OnDecided): void {
    const decided = conditions.get(node.variable);
    if (isDecided(decided)) {
      onDecided(decided.alternativeIndex, conditions);
      return;
    }
    if (node.alternatives.length === 2) {
      this.enumerateTruthiness(node.variable, "", node, conditions, (isTruthy, next) =>
        onDecided(isTruthy ? 0 : 1, next),
      );
      return;
    }
    this.enumerateDecision(node.variable, node.alternatives.length, node, conditions, onDecided);
  }

  private enumerateTruthiness(
    predicate: string,
    scope: string,
    node: PatternBranch,
    conditions: ConditionMap,
    onDecided: OnTruthiness,
  ): void {
    const known = resolveTruthiness(predicate, scope, conditions);
    if (known !== null) {
      onDecided(known, conditions);
      return;
    }
    const parsed = parsePredicate(predicate);
    if (parsed?.predicate.kind !== "derived") {
      this.enumerateDecision(`${predicate}${scope}`, 2, node, conditions, (index, next) =>
        onDecided(index === 0, next),
      );
      return;
    }
    const { decision, outcomes } = parsed.predicate;
    const innerScope = `${parsed.scope}${scope}`;
    this.enumerateDecision(
      `${decision}${innerScope}`,
      outcomes.length,
      node,
      conditions,
      (index, next) => {
        const outcome = outcomes[index];
        if (outcome === TRUTHY_OUTCOME || outcome === FALSY_OUTCOME) {
          onDecided(outcome === TRUTHY_OUTCOME, next);
          return;
        }
        const { predicate: outcomePredicate, isNegated } = readPolarity(outcome);
        this.enumerateTruthiness(outcomePredicate, innerScope, node, next, (isTruthy, after) =>
          onDecided(isTruthy !== isNegated, after),
        );
      },
    );
  }

  private enumerateDecision(
    variable: string,
    alternativeCount: number,
    node: PatternBranch,
    conditions: ConditionMap,
    onDecided: OnDecided,
  ): void {
    for (let alternativeIndex = 0; alternativeIndex < alternativeCount; alternativeIndex++) {
      if (this.isExhausted) {
        this.omitUnderBudget(conditions, {
          kind: "branch",
          variable,
          reason: node.reason,
          location: node.location,
          alternativeIndex,
          conditions: [],
        });
        continue;
      }
      const next = new Map(conditions).set(variable, {
        kind: "decision",
        variable,
        alternativeIndex,
        alternativeCount,
      });
      onDecided(alternativeIndex, next);
    }
  }

  private expandRepeat(node: PatternRepeat, conditions: ConditionMap, emit: Emit): void {
    const decided = conditions.get(node.variable);
    if (decided?.kind === "repeat") {
      this.expandIterations(node, decided.count, 0, [], conditions, emit);
      return;
    }
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
      if (!isCountAllowed(node, count, conditions)) continue;
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
