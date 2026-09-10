import { GuardSolver } from "./guard-solver.js";
import type {
  BranchCondition,
  OmittedRepeatStates,
  RepeatCondition,
  StateCondition,
  StateOmission,
  StateSpaceBudget,
  StaticState,
  TransitionCondition,
} from "./state-space.js";
import {
  hasPatternDecisions,
  scopeRepeatIteration,
  type PatternBranch,
  type PatternNode,
  type PatternRepeat,
} from "./static-pattern.js";
import {
  collectGuardVariables,
  decisionGuard,
  formatVariable,
  type SymbolicCommit,
  type SymbolicTree,
  type SymbolicVariable,
} from "./symbolic-tree.js";

// States are derived from the symbolic tree on demand. Decisions that read a
// shared projection of an input, or nest inside one another, form a cluster and
// are enumerated together under the guard solver, so contradictory combinations
// never appear; the solver decides atoms per projection, so decisions over
// disjoint projections cannot constrain each other and are enumerated apart,
// only multiplied when a whole state is asked for.

/** Decisions over these inputs (by base id, before any iteration scope) decide together. */
export interface GuardCluster {
  inputs: string[];
  /** Every consistent assignment of the cluster's decisions, in enumeration order, up to the budget. */
  states: StateCondition[][];
  /** Whether the state budget stopped the enumeration before every assignment was listed. */
  isTruncated: boolean;
}

export interface CommitStateSpace {
  transition: TransitionCondition | null;
  tree: PatternNode[];
  clusters: GuardCluster[];
  /** The product of the cluster sizes: how many consistent states this commit has, enumerated or not. */
  stateCount: number;
  omissions: StateOmission[];
}

export const branchCondition = (
  node: PatternBranch,
  alternativeIndex: number,
): BranchCondition => ({
  kind: node.inputs.some((input) => input.source === "state") ? "state-update" : "branch",
  variable: node.variable,
  reason: node.reason,
  location: node.location,
  alternativeIndex,
  alternativeCount: node.alternatives.length,
});

export const repeatCondition = (node: PatternRepeat, count: number): RepeatCondition => ({
  kind: "repeat",
  variable: node.variable,
  location: node.location,
  count,
});

/** A single commit needs no transition to select it. */
export const transitionCondition = (
  commit: number,
  commitCount: number,
): TransitionCondition | null =>
  commitCount > 1 ? { kind: "transition", commit, commitCount } : null;

export const baseInputId = (input: string): string => {
  const scopeStart = input.indexOf("@");
  return scopeStart === -1 ? input : input.slice(0, scopeStart);
};

const decisionInputs = (node: PatternBranch | PatternRepeat): string[] =>
  node.inputs.map((input) => baseInputId(input.id));

const projectionKey = (variable: SymbolicVariable): string =>
  formatVariable({ ...variable, input: baseInputId(variable.input), measure: "value" });

/** The projections a decision's guards constrain; decisions over none fall back to their inputs. */
const decisionProjections = (node: PatternBranch | PatternRepeat): string[] => {
  const variables =
    node.kind === "branch"
      ? node.guards.flatMap((guard) => collectGuardVariables(guard))
      : [node.cardinality];
  const keys = [...new Set(variables.map(projectionKey))];
  return keys.length > 0 ? keys : decisionInputs(node);
};

class InputUnion {
  private readonly parents = new Map<string, string>();

  find(input: string): string {
    let root = input;
    while (true) {
      const parent = this.parents.get(root);
      if (parent === undefined || parent === root) break;
      root = parent;
    }
    this.parents.set(input, root);
    return root;
  }

  unite(inputs: string[]): void {
    const [first, ...rest] = inputs;
    if (first === undefined) return;
    const root = this.find(first);
    for (const input of rest) this.parents.set(this.find(input), root);
  }

  members(): string[][] {
    const groups = new Map<string, string[]>();
    for (const input of this.parents.keys()) {
      const root = this.find(input);
      const group = groups.get(root);
      if (group) group.push(input);
      else groups.set(root, [input]);
    }
    return [...groups.values()].map((group) => group.sort());
  }
}

const uniteDecisions = (nodes: PatternNode[], enclosing: string[], union: InputUnion): void => {
  for (const node of nodes) {
    switch (node.kind) {
      case "fiber":
        uniteDecisions(node.children, enclosing, union);
        break;
      case "opaque":
        uniteDecisions(node.passedChildren, enclosing, union);
        break;
      case "branch": {
        const projections = decisionProjections(node);
        union.unite([...enclosing, ...projections]);
        for (const alternative of node.alternatives) {
          uniteDecisions(alternative, projections, union);
        }
        break;
      }
      case "repeat": {
        const projections = decisionProjections(node);
        union.unite([...enclosing, ...projections]);
        uniteDecisions(node.children, projections, union);
        break;
      }
      case "text":
      case "wildcard":
        break;
    }
  }
};

/** Projections decided together: a decision reads several, or one decision only exists under another. */
export const clusterProjections = (tree: PatternNode[]): string[][] => {
  const union = new InputUnion();
  uniteDecisions(tree, [], union);
  return union.members().sort((left, right) => left[0].localeCompare(right[0]));
};

const inputsOfProjections = (projections: string[]): string[] => [
  ...new Set(projections.map((projection) => projection.split(".")[0])),
];

type ConditionMap = ReadonlyMap<string, StateCondition>;

interface Emit {
  (conditions: ConditionMap): void;
}

const describeConditions = (conditions: StateCondition[]): string =>
  conditions
    .map((condition) =>
      condition.kind === "transition"
        ? `transition=${condition.commit}`
        : `${condition.variable}=${conditionValue(condition)}`,
    )
    .join(",");

export const conditionValue = (condition: StateCondition): number => {
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

/** Enumerates the consistent assignments of one cluster's decisions, skipping every subtree that decides other clusters. */
class ClusterEnumerator {
  readonly states: StateCondition[][] = [];
  isTruncated = false;
  private readonly solver = new GuardSolver();

  constructor(
    private readonly cluster: ReadonlySet<string>,
    private readonly budget: StateSpaceBudget,
    private readonly omit: (key: string, omission: StateOmission) => void,
  ) {}

  enumerate(tree: PatternNode[]): void {
    this.expandList(tree, 0, new Map(), (conditions) => {
      if (this.states.length >= this.budget.maxStates) {
        this.isTruncated = true;
        const dropped = [...conditions.values()];
        this.omit(`state|${describeConditions(dropped)}`, { kind: "state", conditions: dropped });
        return;
      }
      this.states.push([...conditions.values()]);
    });
  }

  private owns(node: PatternBranch | PatternRepeat): boolean {
    return decisionProjections(node).some((projection) => this.cluster.has(projection));
  }

  private expandList(
    nodes: PatternNode[],
    index: number,
    conditions: ConditionMap,
    emit: Emit,
  ): void {
    if (this.isTruncated) return;
    let cursor = index;
    while (cursor < nodes.length && !hasPatternDecisions(nodes[cursor])) cursor++;
    if (cursor === nodes.length) {
      emit(conditions);
      return;
    }
    this.expandNode(nodes[cursor], conditions, (next) =>
      this.expandList(nodes, cursor + 1, next, emit),
    );
  }

  private expandNode(node: PatternNode, conditions: ConditionMap, emit: Emit): void {
    switch (node.kind) {
      case "text":
        emit(conditions);
        return;
      case "wildcard":
        emit(conditions);
        return;
      case "fiber":
        this.expandList(node.children, 0, conditions, emit);
        return;
      case "opaque":
        this.expandList(node.passedChildren, 0, conditions, emit);
        return;
      case "branch":
        if (this.owns(node)) this.expandBranch(node, conditions, emit);
        else emit(conditions);
        return;
      case "repeat":
        if (this.owns(node)) this.expandRepeat(node, conditions, emit);
        else emit(conditions);
        return;
    }
  }

  private decide(
    node: PatternBranch | PatternRepeat,
    choice: number,
    conditions: ConditionMap,
    condition: StateCondition,
    expand: (next: ConditionMap) => void,
  ): void {
    if (!this.solver.push(decisionGuard(node, choice))) return;
    try {
      expand(new Map(conditions).set(node.variable, condition));
    } finally {
      this.solver.pop();
    }
  }

  private expandBranch(node: PatternBranch, conditions: ConditionMap, emit: Emit): void {
    const decided = conditions.get(node.variable);
    if (decided && decided.kind !== "repeat" && decided.kind !== "transition") {
      this.expandList(node.alternatives[decided.alternativeIndex] ?? [], 0, conditions, emit);
      return;
    }
    node.alternatives.forEach((alternative, alternativeIndex) => {
      if (this.isTruncated) {
        const under = [...conditions.values()];
        this.omit(`${node.variable}|${alternativeIndex}|${describeConditions(under)}`, {
          kind: "branch",
          variable: node.variable,
          reason: node.reason,
          location: node.location,
          alternativeIndex,
          conditions: under,
        });
        return;
      }
      this.decide(
        node,
        alternativeIndex,
        conditions,
        branchCondition(node, alternativeIndex),
        (next) => this.expandList(alternative, 0, next, emit),
      );
    });
  }

  private expandRepeat(node: PatternRepeat, conditions: ConditionMap, emit: Emit): void {
    const { min, max } = node.count;
    const enumeratedMax =
      max === null ? min + this.budget.maxRepeat : Math.min(max, min + this.budget.maxRepeat);
    const omittedCounts = (countsAbove: number, under: StateCondition[]): OmittedRepeatStates => ({
      kind: "repeat",
      variable: node.variable,
      location: node.location,
      countsAbove,
      max,
      conditions: under,
    });
    if (max === null || max > enumeratedMax) {
      this.omit(node.variable, omittedCounts(enumeratedMax, []));
    }
    for (let count = min; count <= enumeratedMax; count++) {
      if (this.isTruncated) {
        const under = [...conditions.values()];
        this.omit(`${node.variable}|${describeConditions(under)}`, omittedCounts(count - 1, under));
        return;
      }
      this.decide(node, count, conditions, repeatCondition(node, count), (next) =>
        this.expandIterations(node, count, 0, next, emit),
      );
    }
  }

  private expandIterations(
    node: PatternRepeat,
    count: number,
    iteration: number,
    conditions: ConditionMap,
    emit: Emit,
  ): void {
    if (this.isTruncated) return;
    if (iteration === count) {
      emit(conditions);
      return;
    }
    this.expandList(scopeRepeatIteration(node, iteration), 0, conditions, (next) =>
      this.expandIterations(node, count, iteration + 1, next, emit),
    );
  }
}

class OmissionLog {
  private readonly omissions = new Map<string, StateOmission>();

  omit = (key: string, omission: StateOmission): void => {
    const existing = this.omissions.get(key);
    if (existing?.kind === "repeat" && omission.kind === "repeat") {
      omission = { ...omission, countsAbove: Math.min(existing.countsAbove, omission.countsAbove) };
    }
    this.omissions.set(key, omission);
  };

  list(): StateOmission[] {
    return [...this.omissions.values()];
  }
}

const omitTruncatedSubtrees = (nodes: PatternNode[], omit: OmissionLog["omit"]): void => {
  for (const node of nodes) {
    switch (node.kind) {
      case "wildcard":
        if (node.isTruncated) omit(node.reason, { kind: "subtree", reason: node.reason });
        break;
      case "fiber":
        omitTruncatedSubtrees(node.children, omit);
        break;
      case "opaque":
        omitTruncatedSubtrees(node.passedChildren, omit);
        break;
      case "branch":
        for (const alternative of node.alternatives) omitTruncatedSubtrees(alternative, omit);
        break;
      case "repeat":
        omitTruncatedSubtrees(node.children, omit);
        break;
      case "text":
        break;
    }
  }
};

const enumerateCommit = (
  commit: SymbolicCommit,
  transition: TransitionCondition | null,
  budget: StateSpaceBudget,
): CommitStateSpace => {
  const log = new OmissionLog();
  omitTruncatedSubtrees(commit.tree, log.omit);
  const clusters = clusterProjections(commit.tree).map((projections): GuardCluster => {
    const enumerator = new ClusterEnumerator(new Set(projections), budget, log.omit);
    enumerator.enumerate(commit.tree);
    return {
      inputs: inputsOfProjections(projections),
      states: enumerator.states,
      isTruncated: enumerator.isTruncated,
    };
  });
  return {
    transition,
    tree: commit.tree,
    clusters,
    stateCount: clusters.reduce((product, cluster) => product * cluster.states.length, 1),
    omissions: log.list(),
  };
};

/** The independent clusters of every commit, each enumerated within the budget. */
export const enumerateClusters = (
  tree: SymbolicTree,
  budget: StateSpaceBudget,
): CommitStateSpace[] =>
  tree.commits.map((commit, index) =>
    enumerateCommit(commit, transitionCondition(index, tree.commits.length), budget),
  );

const instantiate = (nodes: PatternNode[], conditions: ConditionMap): PatternNode[] =>
  nodes.flatMap((node): PatternNode[] => {
    switch (node.kind) {
      case "text":
      case "wildcard":
        return [node];
      case "fiber":
        return [{ ...node, children: instantiate(node.children, conditions) }];
      case "opaque":
        return [{ ...node, passedChildren: instantiate(node.passedChildren, conditions) }];
      case "branch": {
        const decided = conditions.get(node.variable);
        if (!decided || decided.kind === "repeat" || decided.kind === "transition") {
          throw new Error(`state leaves ${node.variable} undecided`);
        }
        return instantiate(node.alternatives[decided.alternativeIndex] ?? [], conditions);
      }
      case "repeat": {
        const decided = conditions.get(node.variable);
        if (decided?.kind !== "repeat") throw new Error(`state leaves ${node.variable} uncounted`);
        return Array.from({ length: decided.count }, (_, iteration) =>
          instantiate(scopeRepeatIteration(node, iteration), conditions),
        ).flat();
      }
    }
  });

/** The cluster states a global state index (within its commit) selects, most significant cluster first. */
export const clusterIndices = (commit: CommitStateSpace, index: number): number[] => {
  const indices: number[] = [];
  let remaining = index;
  for (let position = commit.clusters.length - 1; position >= 0; position--) {
    const size = commit.clusters[position].states.length;
    indices[position] = remaining % size;
    remaining = Math.floor(remaining / size);
  }
  return indices;
};

export const stateIndexOf = (commit: CommitStateSpace, indices: number[]): number =>
  indices.reduce(
    (index, clusterIndex, position) =>
      index * commit.clusters[position].states.length + clusterIndex,
    0,
  );

const stateAt = (commit: CommitStateSpace, index: number): StaticState => {
  const conditions = new Map<string, StateCondition>();
  clusterIndices(commit, index).forEach((clusterIndex, position) => {
    for (const condition of commit.clusters[position].states[clusterIndex]) {
      if (condition.kind !== "transition") conditions.set(condition.variable, condition);
    }
  });
  return {
    tree: instantiate(commit.tree, conditions),
    conditions: [...(commit.transition ? [commit.transition] : []), ...conditions.values()],
  };
};

/**
 * Yields whole states on demand: every combination of the clusters' states of
 * every commit, latest cluster varying fastest, up to `budget.maxStates` in total.
 */
export const enumerateCommitStates = function* (
  commits: CommitStateSpace[],
  budget: StateSpaceBudget,
): Generator<StaticState, void, undefined> {
  let yielded = 0;
  for (const commit of commits) {
    for (let index = 0; index < commit.stateCount; index++) {
      if (yielded >= budget.maxStates) return;
      yielded++;
      yield stateAt(commit, index);
    }
  }
};

/** The states of a symbolic tree, on demand: clusters are enumerated first, whole states only as pulled. */
export const enumerateStates = (
  tree: SymbolicTree,
  budget: StateSpaceBudget,
): Generator<StaticState, void, undefined> =>
  enumerateCommitStates(enumerateClusters(tree, budget), budget);
