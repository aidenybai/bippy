import type { PinnedDecisions, StaticRenderResult } from "../types.js";
import {
  describePatternNode,
  matchPatternToRuntime,
  type ComparisonDivergence,
  type ComparisonOptions,
  type ComparisonReport,
  type ComparisonStatus,
} from "./compare.js";
import {
  enumerateStaticStates,
  type CompareRenderResult,
  type StaticStateSpaceOptions,
} from "./compare-render.js";
import type { RuntimeFiberSnapshot } from "./snapshot.js";
import { hasPatternDecisions, type PatternNode } from "./static-pattern.js";
import {
  getStateCommit,
  pinDecisions,
  type DecisionCondition,
  type StateCondition,
  type StaticState,
  type StaticStateSpace,
} from "./state-space.js";

// The enumeration derives every state from one render in which all
// alternatives were materialized together, so module state, refs and effects
// of one alternative can leak into another's subtree. Replaying an assignment
// of the decision variables renders the static tree again, from a fresh
// interpreter, with only those alternatives and repeat counts selected; the
// trees it commits must be exactly the trees the enumeration claimed.

/**
 * How many decision assignments a replay renders at most; each is a full
 * static render. The runtime-matched assignment is always among them, the rest
 * are spread evenly over the enumeration order, and the summary reports the
 * count so a sampled replay is never mistaken for a complete one.
 */
export const DEFAULT_MAX_REPLAYED_ASSIGNMENTS = 16;

export interface StateReplayMismatch {
  /** The enumerated states (indices before correction) the assignment claims. */
  stateIndices: number[];
  conditions: DecisionCondition[];
  /** How many distinct trees the enumeration claimed for the assignment and how many the replay committed. */
  claimedCommits: number;
  replayedCommits: number;
  divergence: ComparisonDivergence;
  /**
   * The replay left no decision open, so its commits replace the claimed
   * states. Otherwise the replay met a decision the enumeration never
   * described and the assignment's states stay unaccounted for.
   */
  isCorrected: boolean;
}

export interface StateReplaySummary {
  /** Enumerated states before the replay corrected any. */
  states: number;
  /** Distinct assignments of the decision variables across the enumerated states. */
  assignments: number;
  replayed: number;
  maxReplayed: number;
  /** Replayed assignments whose claimed trees the reconciler did not produce. */
  mismatched: StateReplayMismatch[];
}

export interface StateReplayOptions {
  maxReplayed?: number;
  /** The options the state space was enumerated with, so the replay is read the same way. */
  enumerate?: StaticStateSpaceOptions;
  compare?: ComparisonOptions;
}

export type RenderPinnedDecisions = (decisions: PinnedDecisions) => Promise<StaticRenderResult>;

const END_OF_CHILDREN = "<end of children>";

const describeAt = (nodes: PatternNode[], index: number): string => {
  const node = nodes[index];
  return node === undefined ? END_OF_CHILDREN : describePatternNode(node);
};

const isSameNodeHead = (expected: PatternNode, actual: PatternNode): boolean => {
  switch (expected.kind) {
    case "fiber":
      return (
        actual.kind === "fiber" &&
        expected.tag === actual.tag &&
        expected.name === actual.name &&
        expected.key === actual.key
      );
    case "text":
      return actual.kind === "text" && expected.text === actual.text;
    case "opaque":
      return (
        actual.kind === "opaque" && expected.name === actual.name && expected.key === actual.key
      );
    case "wildcard":
      return actual.kind === "wildcard" && expected.reason === actual.reason;
    case "branch":
    case "repeat":
      return false;
  }
};

const childrenOf = (node: PatternNode): PatternNode[] => {
  switch (node.kind) {
    case "fiber":
      return node.children;
    case "opaque":
      return node.passedChildren;
    case "text":
    case "wildcard":
    case "branch":
    case "repeat":
      return [];
  }
};

/**
 * The first position where two patterns differ, node for node: a wildcard
 * only equals the same wildcard and a decision left open equals nothing.
 */
const diffPatterns = (
  expected: PatternNode[],
  actual: PatternNode[],
  path: string[],
): ComparisonDivergence | null => {
  const length = Math.max(expected.length, actual.length);
  for (let index = 0; index < length; index++) {
    const expectedNode = expected[index];
    const actualNode = actual[index];
    if (
      expectedNode === undefined ||
      actualNode === undefined ||
      !isSameNodeHead(expectedNode, actualNode)
    ) {
      return {
        path: `${path.join(" > ")}[${index}]`,
        expected: describeAt(expected, index),
        actual: describeAt(actual, index),
      };
    }
    const inside = diffPatterns(childrenOf(expectedNode), childrenOf(actualNode), [
      ...path,
      describePatternNode(expectedNode),
    ]);
    if (inside) return inside;
  }
  return null;
};

const isSameTree = (left: PatternNode[], right: PatternNode[]): boolean =>
  diffPatterns(left, right, []) === null;

const distinctTrees = (trees: PatternNode[][]): PatternNode[][] =>
  trees.filter((tree, index) => !trees.slice(0, index).some((seen) => isSameTree(seen, tree)));

/** The first commit position where the claimed and the witnessed tree sequences differ. */
const diffTreeSequences = (
  claimed: PatternNode[][],
  witnessed: PatternNode[][],
): ComparisonDivergence | null => {
  const length = Math.max(claimed.length, witnessed.length);
  for (let commit = 0; commit < length; commit++) {
    const divergence = diffPatterns(claimed[commit] ?? [], witnessed[commit] ?? [], [
      ...(length > 1 ? [`commit ${commit + 1}`] : []),
      "root",
    ]);
    if (divergence) return divergence;
  }
  return null;
};

const isDecisionCondition = (condition: StateCondition): condition is DecisionCondition =>
  condition.kind !== "transition";

const decisionValue = (condition: DecisionCondition): number =>
  condition.kind === "repeat" ? condition.count : condition.alternativeIndex;

/**
 * Which decision every variable stands for. Each commit names its variables
 * on its own, so the same decision (one materializer id at one position) can
 * carry different variables in different commits; the join treats those as
 * one variable, since a replay can pin the decision only once for all
 * commits. Decisions inside a repeat are per iteration and keep their own
 * variables.
 */
const collectDecisionVariables = (
  nodes: PatternNode[],
  position: string,
  variableOf: Map<string, string>,
): void => {
  for (const node of nodes) {
    switch (node.kind) {
      case "fiber":
        collectDecisionVariables(node.children, position, variableOf);
        break;
      case "opaque":
        collectDecisionVariables(node.passedChildren, position, variableOf);
        break;
      case "branch": {
        const decision = `${position}${node.decision}`;
        variableOf.set(decision, variableOf.get(decision) ?? node.variable);
        node.alternatives.forEach((alternative, alternativeIndex) => {
          collectDecisionVariables(alternative, `${decision}|${alternativeIndex}/`, variableOf);
        });
        break;
      }
      case "repeat": {
        const decision = `${position}${node.decision}`;
        variableOf.set(decision, variableOf.get(decision) ?? node.variable);
        break;
      }
      case "text":
      case "wildcard":
        break;
    }
  }
};

/** Variables that name the same decision in different commits, by union-find over the decision ids. */
const unifyDecisionVariables = (commits: PatternNode[][]): Map<string, string> => {
  const parents = new Map<string, string>();
  const resolve = (variable: string): string => {
    const parent = parents.get(variable) ?? variable;
    if (parent === variable) return variable;
    const root = resolve(parent);
    parents.set(variable, root);
    return root;
  };
  const variableOfDecision = new Map<string, string>();
  for (const commit of commits) {
    const variableOf = new Map<string, string>();
    collectDecisionVariables(commit, "", variableOf);
    for (const [decision, variable] of variableOf) {
      if (!parents.has(variable)) parents.set(variable, variable);
      const earlier = variableOfDecision.get(decision);
      if (earlier === undefined) variableOfDecision.set(decision, variable);
      else parents.set(resolve(variable), resolve(earlier));
    }
  }
  return new Map([...parents.keys()].map((variable) => [variable, resolve(variable)]));
};

/** One joint assignment: the conditions deciding each canonical variable, one per alias variable. */
interface Assignment extends ReadonlyMap<string, DecisionCondition[]> {}

const assignmentKey = (assignment: Assignment): string =>
  JSON.stringify(
    [...assignment]
      .map(([variable, [condition]]): [string, number] => [variable, decisionValue(condition)])
      .sort(([left], [right]) => left.localeCompare(right)),
  );

class AssignmentJoin {
  constructor(private readonly canonical: Map<string, string>) {}

  private decided(assignment: Assignment, condition: DecisionCondition): number | null {
    const [existing] = assignment.get(this.canonicalOf(condition)) ?? [];
    return existing === undefined ? null : decisionValue(existing);
  }

  private canonicalOf(condition: DecisionCondition): string {
    return this.canonical.get(condition.variable) ?? condition.variable;
  }

  agreesWith(assignment: Assignment, conditions: DecisionCondition[]): boolean {
    return conditions.every((condition) => {
      const value = this.decided(assignment, condition);
      return value === null || value === decisionValue(condition);
    });
  }

  isSubAssignment(assignment: Assignment, conditions: DecisionCondition[]): boolean {
    return conditions.every(
      (condition) => this.decided(assignment, condition) === decisionValue(condition),
    );
  }

  merge(assignment: Assignment, conditions: DecisionCondition[]): Assignment {
    const merged = new Map(assignment);
    for (const condition of conditions) {
      const variable = this.canonicalOf(condition);
      const aliases = merged.get(variable) ?? [];
      if (!aliases.some((alias) => alias.variable === condition.variable)) {
        merged.set(variable, [...aliases, condition]);
      }
    }
    return merged;
  }
}

export interface DecisionAssignment {
  conditions: DecisionCondition[];
  /** The enumerated states the assignment claims, in enumeration order. */
  stateIndices: number[];
}

/**
 * The joint assignments of every decision variable the enumeration met. Each
 * commit was enumerated on its own, so a variable that only exists in one
 * commit is joined with every agreeing assignment of the other commits; a
 * state belongs to each joint assignment its own conditions are part of. The
 * join is bounded like the enumeration itself.
 */
export const joinDecisionAssignments = (stateSpace: StaticStateSpace): DecisionAssignment[] => {
  const join = new AssignmentJoin(unifyDecisionVariables(stateSpace.commits));
  const decisionsOf = stateSpace.states.map((state) =>
    state.conditions.filter(isDecisionCondition),
  );
  const perCommit: DecisionCondition[][][] = stateSpace.commits.map(() => []);
  stateSpace.states.forEach((state, stateIndex) => {
    perCommit[getStateCommit(state)]?.push(decisionsOf[stateIndex]);
  });
  let joint: Assignment[] = [new Map()];
  for (const commitAssignments of perCommit) {
    const extended = new Map<string, Assignment>();
    for (const assignment of joint) {
      let isExtended = false;
      for (const conditions of commitAssignments) {
        if (!join.agreesWith(assignment, conditions)) continue;
        isExtended = true;
        const merged = join.merge(assignment, conditions);
        extended.set(assignmentKey(merged), merged);
      }
      if (!isExtended) extended.set(assignmentKey(assignment), assignment);
    }
    joint = [...extended.values()].slice(0, stateSpace.budget.maxStates);
  }
  return joint.map((assignment) => ({
    conditions: [...assignment.values()].flat(),
    stateIndices: decisionsOf.flatMap((conditions, stateIndex) =>
      join.isSubAssignment(assignment, conditions) ? [stateIndex] : [],
    ),
  }));
};

/**
 * Which assignments to replay: up to `maxReplayed` spread evenly over the
 * enumeration order, the slot nearest the runtime-matched assignment replaced
 * by it so the match itself is always re-witnessed.
 */
export const chooseReplaySample = (
  assignmentCount: number,
  matchedAssignment: number | null,
  maxReplayed: number,
): number[] => {
  if (assignmentCount <= maxReplayed) {
    return Array.from({ length: assignmentCount }, (_, index) => index);
  }
  const step = maxReplayed === 1 ? 0 : (assignmentCount - 1) / (maxReplayed - 1);
  const sample = Array.from({ length: maxReplayed }, (_, slot) => Math.round(slot * step));
  if (matchedAssignment !== null && !sample.includes(matchedAssignment)) {
    const nearest = sample.reduce(
      (best, index, slot) =>
        Math.abs(index - matchedAssignment) < Math.abs(sample[best] - matchedAssignment)
          ? slot
          : best,
      0,
    );
    sample[nearest] = matchedAssignment;
  }
  return sample.sort((left, right) => left - right);
};

const transitionConditions = (commit: number, commitCount: number): StateCondition[] =>
  commitCount > 1 ? [{ kind: "transition", commit, commitCount }] : [];

interface ReplayOutcome {
  mismatch: StateReplayMismatch | null;
  /** The assignment's states as the replay witnessed them; null when the claimed states were reproduced. */
  corrected: StaticState[] | null;
}

const replayAssignment = (
  states: StaticState[],
  assignment: DecisionAssignment,
  replay: StaticStateSpace,
): ReplayOutcome => {
  const claimed = distinctTrees(
    assignment.stateIndices.map((stateIndex) => states[stateIndex].tree),
  );
  const witnessed = distinctTrees(replay.commits);
  const divergence = diffTreeSequences(claimed, witnessed);
  if (divergence === null) return { mismatch: null, corrected: null };
  const isConcrete =
    witnessed.length > 0 && witnessed.every((commit) => !commit.some(hasPatternDecisions));
  return {
    mismatch: {
      stateIndices: assignment.stateIndices,
      conditions: assignment.conditions,
      claimedCommits: claimed.length,
      replayedCommits: witnessed.length,
      divergence,
      isCorrected: isConcrete,
    },
    corrected: isConcrete
      ? witnessed.map((tree, commit) => ({
          tree,
          conditions: [...transitionConditions(commit, witnessed.length), ...assignment.conditions],
        }))
      : null,
  };
};

interface CorrectedStateSpace {
  states: StaticState[];
  /** New index of every enumerated state still claimed by an uncorrected assignment. */
  kept: Map<number, number>;
  /** New indices of the states whose trees the corrected replays committed. */
  witnessed: number[];
}

interface CorrectedEntry {
  state: StaticState;
  /** Index in the enumeration; null for a state a corrected replay contributed. */
  origin: number | null;
}

/**
 * Drops the states only corrected assignments claimed and puts each
 * corrected assignment's witnessed trees where its first state was; a tree
 * some remaining state already describes is witnessed through that state.
 */
const correctStates = (
  states: StaticState[],
  assignments: DecisionAssignment[],
  corrections: Map<number, StaticState[]>,
): CorrectedStateSpace => {
  const claimedBy = states.map((): number[] => []);
  assignments.forEach((assignment, assignmentIndex) => {
    for (const stateIndex of assignment.stateIndices) claimedBy[stateIndex].push(assignmentIndex);
  });
  const isDropped = (stateIndex: number): boolean =>
    claimedBy[stateIndex].length > 0 &&
    claimedBy[stateIndex].every((assignmentIndex) => corrections.has(assignmentIndex));
  const keptTrees = states
    .filter((_, stateIndex) => !isDropped(stateIndex))
    .map((state) => state.tree);
  const witnessedTrees = [...corrections.values()].flat().map((state) => state.tree);
  const insertAt = new Map<number, number[]>();
  for (const assignmentIndex of corrections.keys()) {
    const first = assignments[assignmentIndex].stateIndices[0] ?? states.length;
    insertAt.set(first, [...(insertAt.get(first) ?? []), assignmentIndex]);
  }
  const entries: CorrectedEntry[] = [];
  const insert = (stateIndex: number): void => {
    for (const assignmentIndex of insertAt.get(stateIndex) ?? []) {
      for (const state of corrections.get(assignmentIndex) ?? []) {
        const isDescribed = [...keptTrees, ...entries.map((entry) => entry.state.tree)].some(
          (tree) => isSameTree(tree, state.tree),
        );
        if (!isDescribed) entries.push({ state, origin: null });
      }
    }
  };
  states.forEach((state, stateIndex) => {
    insert(stateIndex);
    if (!isDropped(stateIndex)) entries.push({ state, origin: stateIndex });
  });
  insert(states.length);
  const kept = new Map<number, number>();
  const witnessed: number[] = [];
  entries.forEach(({ state, origin }, index) => {
    if (origin !== null) kept.set(origin, index);
    if (origin === null || witnessedTrees.some((tree) => isSameTree(tree, state.tree))) {
      witnessed.push(index);
    }
  });
  return { states: entries.map((entry) => entry.state), kept, witnessed };
};

interface RuntimeMatch {
  index: number;
  report: ComparisonReport;
}

/** The latest state the runtime is an instance of, as the derived matching prefers later commits. */
const matchStates = (
  states: StaticState[],
  indices: number[],
  runtime: RuntimeFiberSnapshot[],
  options: ComparisonOptions | undefined,
): RuntimeMatch | null => {
  for (const index of [...indices].sort((left, right) => right - left)) {
    const match = matchPatternToRuntime(states[index].tree, runtime, options);
    if (match.report.status !== "mismatch") return { index, report: match.report };
  }
  return null;
};

const reindex = <T extends { index: number | null }>(
  state: T | null,
  kept: Map<number, number>,
): T | null => {
  if (state === null || state.index === null) return state;
  const index = kept.get(state.index);
  return index === undefined ? null : { ...state, index };
};

export interface StateSpaceReplay {
  summary: StateReplaySummary;
  /** The enumerated states with the contradicted ones replaced by what their replays committed. */
  states: StaticState[];
  /** New index of every enumerated state a replay did not contradict. */
  kept: Map<number, number>;
  /** New indices of the states some replay reproduced or committed. */
  reWitnessed: Set<number>;
}

/**
 * Independently replays the enumerated decision assignments in a bounded
 * sample that always includes the assignment of `preferredState`.
 * States a replay contradicts are replaced by the replayed commits.
 */
export const replayStateSpace = async (
  stateSpace: StaticStateSpace,
  render: RenderPinnedDecisions,
  preferredState: number | null,
  options: StateReplayOptions = {},
): Promise<StateSpaceReplay> => {
  const maxReplayed = options.maxReplayed ?? DEFAULT_MAX_REPLAYED_ASSIGNMENTS;
  const assignments = joinDecisionAssignments(stateSpace);
  const preferredAssignment = assignments.findIndex(
    (assignment) => preferredState !== null && assignment.stateIndices.includes(preferredState),
  );
  const sample = chooseReplaySample(
    assignments.length,
    preferredAssignment === -1 ? null : preferredAssignment,
    maxReplayed,
  );
  const mismatched: StateReplayMismatch[] = [];
  const corrections = new Map<number, StaticState[]>();
  const reproduced = new Set<number>();
  for (const assignmentIndex of sample) {
    const assignment = assignments[assignmentIndex];
    const rendered = await render(pinDecisions(stateSpace, assignment.conditions));
    const outcome = replayAssignment(
      stateSpace.states,
      assignment,
      enumerateStaticStates(rendered, options.enumerate),
    );
    if (outcome.mismatch) mismatched.push(outcome.mismatch);
    else for (const stateIndex of assignment.stateIndices) reproduced.add(stateIndex);
    if (outcome.corrected) corrections.set(assignmentIndex, outcome.corrected);
  }
  const { states, kept, witnessed } = correctStates(stateSpace.states, assignments, corrections);
  return {
    summary: {
      states: stateSpace.states.length,
      assignments: assignments.length,
      replayed: sample.length,
      maxReplayed,
      mismatched,
    },
    states,
    kept,
    reWitnessed: new Set([
      ...witnessed,
      ...[...reproduced].flatMap((stateIndex) => kept.get(stateIndex) ?? []),
    ]),
  };
};

/**
 * Replays the enumerated states and folds what they witnessed into the
 * comparison: the runtime must match a state some replay re-witnessed. A
 * match the combined render claimed but no replay reproduced is `unsound`,
 * while a tree only the replays produced can still be matched.
 */
export const replayEnumeratedStates = async (
  comparison: CompareRenderResult,
  render: RenderPinnedDecisions,
  options: StateReplayOptions = {},
): Promise<CompareRenderResult> => {
  const { stateSpace } = comparison;
  const matchedIndex = comparison.matchedState?.index ?? null;
  const { summary, states, kept, reWitnessed } = await replayStateSpace(
    stateSpace,
    render,
    matchedIndex,
    options,
  );
  const matchedState = reindex(comparison.matchedState, kept);
  const replayed: CompareRenderResult = {
    ...comparison,
    stateSpace: { ...stateSpace, states },
    matchedState,
    closestState: reindex(comparison.closestState, kept),
    stateReplay: summary,
  };
  if (matchedState !== null && matchedState.index !== null && reWitnessed.has(matchedState.index)) {
    return replayed;
  }
  const rematch = matchStates(states, [...reWitnessed], comparison.runtimeSubtree, options.compare);
  if (rematch) {
    const status: ComparisonStatus =
      rematch.report.status === "partial" ? "partial" : stateSpace.omitted ? "truncated" : "exact";
    return {
      ...replayed,
      report: { ...rematch.report, status },
      matchedState: { index: rematch.index, conditions: states[rematch.index].conditions },
      closestState: null,
    };
  }
  if (matchedIndex === null) return replayed;
  const contradiction = summary.mismatched.find((mismatch) =>
    mismatch.stateIndices.includes(matchedIndex),
  );
  const closestIndex = matchedState?.index ?? null;
  return {
    ...replayed,
    report: { ...comparison.report, status: "unsound" },
    matchedState: null,
    closestState:
      contradiction && closestIndex !== null
        ? { index: closestIndex, divergence: contradiction.divergence }
        : replayed.closestState,
  };
};
