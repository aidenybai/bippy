import { check, type Value } from "tla-ts";
import { evaluatePredicate } from "./predicates";
import { formatTla } from "./tla";
import { NO_VIEW } from "./views";
import type { Action, ModelSpec, Predicate, StateSpace, TraceStep, ViewTransition } from "./types";

const MAX_STATES = 20_000;

const MAX_SUCCESSORS = 400_000;

const MAX_TRANSITION_STEPS = 3;

const MAX_TRANSITION_SUCCESSORS = 50_000;

const NONE = -1;

const BOUNDS = [
  {
    name: "IsBounded",
    expression: `TLCGet("distinct") < ${MAX_STATES} /\\ TLCGet("generated") < ${MAX_SUCCESSORS}`,
  },
];

const VIEW_FIELD = "view";

export interface StateGraph {
  stateSpace: StateSpace;
  findTrace: (predicate: Predicate) => TraceStep[] | null;
  isActionEffective: (action: Action) => boolean;
  findTransition: (
    from: Predicate,
    to: Predicate,
    canTake: (action: Action, taken: Action[]) => boolean,
  ) => boolean | null;
}

interface Graph {
  values: Array<string | undefined>;
  views: string[];
  initialCount: number;
  parents: number[];
  parentActions: number[];
  edgeSources: number[];
  edgeTargets: number[];
  edgeActions: number[];
  isTruncated: boolean;
}

const countInitialStates = (spec: ModelSpec): number =>
  spec.variables.reduce(
    (count, variable) => Math.min(count * variable.initial.length, MAX_STATES),
    1,
  );

const createGraph = (): Graph => ({
  values: [],
  views: [],
  initialCount: 0,
  parents: [],
  parentActions: [],
  edgeSources: [],
  edgeTargets: [],
  edgeActions: [],
  isTruncated: false,
});

const createConstantGraph = (spec: ModelSpec): Graph => {
  const graph = createGraph();
  const isConstantTrue = (predicate: Predicate): boolean =>
    evaluatePredicate(predicate, () => undefined) === true;
  graph.initialCount = 1;
  graph.views.push(spec.views.find((view) => isConstantTrue(view.predicate))?.label ?? NO_VIEW);
  graph.parents.push(NONE);
  graph.parentActions.push(NONE);
  spec.actions.forEach((action, index) => {
    if (!isConstantTrue(action.guard)) return;
    graph.edgeSources.push(0);
    graph.edgeTargets.push(0);
    graph.edgeActions.push(index);
  });
  return graph;
};

const createAlias = (spec: ModelSpec) => ({
  name: "Alias",
  expression: `[${[...spec.variables.map((variable) => variable.name), VIEW_FIELD]
    .map((field) => `${field} |-> ${field}`)
    .join(", ")}]`,
});

const exploreSpec = async (name: string, spec: ModelSpec): Promise<Graph> => {
  if (spec.variables.length === 0) return createConstantGraph(spec);
  if (countInitialStates(spec) >= MAX_STATES) return { ...createGraph(), isTruncated: true };
  const graph = createGraph();
  const actionIndexes = new Map(spec.actions.map((action, index) => [action.name, index]));
  const getActionIndex = (action: string | undefined): number =>
    action === undefined ? NONE : (actionIndexes.get(action) ?? NONE);
  const toText = (value: Value | undefined): string | undefined =>
    typeof value === "string" ? value : undefined;
  const result = await check({
    source: formatTla(name, spec, [...BOUNDS, createAlias(spec)]),
    config: "INIT Init\nNEXT Next\nCONSTRAINT IsBounded\nALIAS Alias\nCHECK_DEADLOCK FALSE",
    onState: (state) => {
      for (const variable of spec.variables) graph.values.push(toText(state.state[variable.name]));
      graph.views.push(toText(state.state[VIEW_FIELD]) ?? NO_VIEW);
      if (state.parent === undefined) graph.initialCount++;
      graph.parents.push(state.parent ?? NONE);
      graph.parentActions.push(getActionIndex(state.action));
    },
    onStep: (step) => {
      const action = getActionIndex(step.action);
      if (action === NONE) return;
      graph.edgeSources.push(step.from);
      graph.edgeTargets.push(step.to);
      graph.edgeActions.push(action);
    },
    onPrint: () => {},
  });
  if (result.status !== "success")
    throw new Error(`tla-ts could not check ${name}: ${result.failure?.message ?? result.status}`);
  graph.isTruncated =
    result.distinctStates >= MAX_STATES || result.generatedStates >= MAX_SUCCESSORS;
  return graph;
};

export const checkStateGraph = async (name: string, spec: ModelSpec): Promise<StateGraph> => {
  const graph = await exploreSpec(name, spec);
  const { variables, actions, views } = spec;
  const width = variables.length;
  const stateCount = graph.parents.length;
  const variableIndexes = new Map(variables.map((variable, index) => [variable.name, index]));
  const getValueOf =
    (state: number) =>
    (variable: string): string | undefined => {
      const index = variableIndexes.get(variable);
      return index === undefined ? undefined : graph.values[state * width + index];
    };
  const isTrue = (predicate: Predicate, state: number): boolean =>
    evaluatePredicate(predicate, getValueOf(state)) === true;
  const viewLabels = [...views.map((view) => view.label), NO_VIEW];
  const viewIndexByLabel = new Map<string, number>();
  viewLabels.forEach((label, index) => {
    if (!viewIndexByLabel.has(label)) viewIndexByLabel.set(label, index);
  });
  const viewIndexes = graph.views.map((label) => viewIndexByLabel.get(label) ?? views.length);
  const observedIndexes = variables.flatMap((variable, index) =>
    variable.source === "control" ? [] : [index],
  );
  const isChanged = (source: number, target: number): boolean =>
    observedIndexes.some(
      (index) => graph.values[source * width + index] !== graph.values[target * width + index],
    );

  const effective = new Uint8Array(actions.length);
  const steps = new Map<string, { from: number; action: number; to: number }>();
  const outgoing: number[][] = Array.from({ length: stateCount }, () => []);
  graph.edgeActions.forEach((actionIndex, edge) => {
    const source = graph.edgeSources[edge];
    const target = graph.edgeTargets[edge];
    const action = actions[actionIndex];
    outgoing[source].push(edge);
    if (!action.hasRenderedWrite && !isChanged(source, target)) return;
    effective[actionIndex] = 1;
    const from = viewIndexes[source];
    const to = viewIndexes[target];
    if (action.phase === "input" && from === to) return;
    const key = `${from}:${action.label}:${to}`;
    if (!steps.has(key)) steps.set(key, { from, action: actionIndex, to });
  });
  const edges = [...steps.values()]
    .sort(
      (left, right) => left.from - right.from || left.action - right.action || left.to - right.to,
    )
    .map(({ from, action, to }): ViewTransition => ({
      from: viewLabels[from],
      to: viewLabels[to],
      action: actions[action].label,
      actionName: actions[action].name,
      handlerId: actions[action].handlerId,
      isAsync: actions[action].phase === "fulfilled" || actions[action].phase === "rejected",
      isInput: actions[action].phase === "input",
    }));

  const collectViews = (states: number[]): string[] => {
    const isReached = new Uint8Array(viewLabels.length);
    for (const state of states) isReached[viewIndexes[state]] = 1;
    return viewLabels.filter((_label, index) => isReached[index] === 1);
  };

  const toTrace = (state: number): TraceStep[] => {
    const steps: TraceStep[] = [];
    for (let index = state; index !== NONE; index = graph.parents[index]) {
      const valueOf = getValueOf(index);
      const actionIndex = graph.parentActions[index];
      steps.push({
        action: actionIndex === NONE ? null : actions[actionIndex].name,
        state: Object.fromEntries(
          variables.map((variable) => [variable.name, valueOf(variable.name) ?? ""]),
        ),
        view: viewLabels[viewIndexes[index]],
      });
    }
    return steps.reverse();
  };

  const findTrace = (predicate: Predicate): TraceStep[] | null => {
    for (let state = 0; state < stateCount; state++)
      if (isTrue(predicate, state)) return toTrace(state);
    return null;
  };

  const findTransition = (
    from: Predicate,
    to: Predicate,
    canTake: (action: Action, taken: Action[]) => boolean,
  ): boolean | null => {
    if (graph.isTruncated) return null;
    let budget = MAX_TRANSITION_SUCCESSORS;
    for (let start = 0; start < stateCount; start++) {
      if (!isTrue(from, start)) continue;
      let frontier = [{ state: start, taken: [] as number[] }];
      for (let step = 0; step < MAX_TRANSITION_STEPS && frontier.length > 0; step++) {
        const nextFrontier: typeof frontier = [];
        const seen = new Set<string>();
        let isFound = false;
        for (const { state, taken } of frontier) {
          const takenActions = taken.map((index) => actions[index]);
          for (const edge of outgoing[state]) {
            const actionIndex = graph.edgeActions[edge];
            if (!canTake(actions[actionIndex], takenActions)) continue;
            budget--;
            const target = graph.edgeTargets[edge];
            if (isTrue(to, target)) isFound = true;
            const nextTaken = [...taken, actionIndex];
            const key = `${target}:${nextTaken.toSorted((left, right) => left - right).join(",")}`;
            if (seen.has(key)) continue;
            seen.add(key);
            nextFrontier.push({ state: target, taken: nextTaken });
          }
        }
        if (isFound) return true;
        if (budget <= 0) return null;
        frontier = nextFrontier;
      }
    }
    return false;
  };

  const effectiveNames = new Set(
    actions.flatMap((action, index) => (effective[index] === 1 ? [action.name] : [])),
  );
  const states = Array.from({ length: stateCount }, (_, state) => state);

  return {
    stateSpace: {
      stateCount,
      isTruncated: graph.isTruncated,
      initialViews: collectViews(states.slice(0, graph.initialCount)),
      reachableViews: collectViews(states),
      edges,
    },
    findTrace,
    isActionEffective: (action) => effectiveNames.has(action.name),
    findTransition,
  };
};
