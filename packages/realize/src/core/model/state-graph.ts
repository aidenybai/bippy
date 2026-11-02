import { check } from "tla-ts";
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

const NODE_PATTERN = /^(-?\d+) \[label="((?:[^"\\]|\\.)*)"(,style = filled)?/;

const EDGE_PATTERN = /^(-?\d+) -> (-?\d+) \[label="((?:[^"\\]|\\.)*)"/;

const ASSIGNMENT_PATTERN = /^(?:\/\\ )?(\w+) = "((?:[^"\\]|\\.)*)"$/;

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
  values: string[];
  initialCount: number;
  parents: number[];
  parentActions: number[];
  edgeSources: number[];
  edgeTargets: number[];
  edgeActions: number[];
  isTruncated: boolean;
}

const unescape = (text: string): string =>
  text.replace(/\\(.)/g, (_match, character: string) => (character === "n" ? "\n" : character));

const countInitialStates = (spec: ModelSpec): number =>
  spec.variables.reduce(
    (count, variable) => Math.min(count * variable.initial.length, MAX_STATES),
    1,
  );

const createGraph = (): Graph => ({
  values: [],
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
  graph.initialCount = 1;
  graph.parents.push(NONE);
  graph.parentActions.push(NONE);
  spec.actions.forEach((action, index) => {
    if (evaluatePredicate(action.guard, () => undefined) !== true) return;
    graph.edgeSources.push(0);
    graph.edgeTargets.push(0);
    graph.edgeActions.push(index);
  });
  return graph;
};

const readDump = (dot: string, spec: ModelSpec): Graph => {
  const width = spec.variables.length;
  const variableIndexes = new Map(spec.variables.map((variable, index) => [variable.name, index]));
  const actionIndexes = new Map(spec.actions.map((action, index) => [action.name, index]));
  const stateIndexes = new Map<string, number>();
  const graph = createGraph();
  const edges: Array<{ source: number; target: string; action: number }> = [];
  for (const line of dot.split("\n")) {
    const edge = EDGE_PATTERN.exec(line);
    if (edge) {
      edges.push({
        source: stateIndexes.get(edge[1]) ?? NONE,
        target: edge[2],
        action: actionIndexes.get(unescape(edge[3])) ?? NONE,
      });
      continue;
    }
    const node = NODE_PATTERN.exec(line);
    if (!node) continue;
    const offset = graph.values.length;
    graph.values.length += width;
    for (const assignment of unescape(node[2]).split("\n")) {
      const match = ASSIGNMENT_PATTERN.exec(assignment);
      const index = match ? variableIndexes.get(match[1]) : undefined;
      if (match && index !== undefined) graph.values[offset + index] = unescape(match[2]);
    }
    const discoveredBy = node[3] === undefined ? edges.at(-1) : undefined;
    if (!discoveredBy) graph.initialCount++;
    graph.parents.push(discoveredBy?.source ?? NONE);
    graph.parentActions.push(discoveredBy?.action ?? NONE);
    stateIndexes.set(node[1], stateIndexes.size);
  }
  for (const { source, target, action } of edges) {
    const targetIndex = stateIndexes.get(target);
    if (action === NONE || targetIndex === undefined) continue;
    graph.edgeSources.push(source);
    graph.edgeTargets.push(targetIndex);
    graph.edgeActions.push(action);
  }
  return graph;
};

const exploreSpec = async (name: string, spec: ModelSpec): Promise<Graph> => {
  if (spec.variables.length === 0) return createConstantGraph(spec);
  if (countInitialStates(spec) >= MAX_STATES) return { ...createGraph(), isTruncated: true };
  let dot = "";
  const result = await check({
    source: formatTla(name, spec, BOUNDS),
    config: "INIT Init\nNEXT Next\nCONSTRAINT IsBounded\nCHECK_DEADLOCK FALSE",
    dump: { path: "states.dot", dot: true, actionLabels: true },
    writeFile: (_path, content) => {
      dot = content;
    },
    onPrint: () => {},
  });
  if (result.status !== "success")
    throw new Error(`tla-ts could not check ${name}: ${result.failure?.message ?? result.status}`);
  const graph = readDump(dot, spec);
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
  const viewIndexes = Array.from({ length: stateCount }, (_, state) => {
    const index = views.findIndex((view) => isTrue(view.predicate, state));
    return index === NONE ? views.length : index;
  });
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
