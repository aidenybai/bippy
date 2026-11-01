import { evaluateNextValue, evaluatePredicate } from "./predicates";
import { NO_VIEW } from "./views";
import type {
  Action,
  Predicate,
  StateSpace,
  Variable,
  View,
  ViewTransition,
  TraceStep,
} from "./types";

const MAX_STATES = 20_000;

const MAX_VARIABLES = 64;

const MAX_SUCCESSORS = 400_000;

const MAX_WRITE_COMBINATIONS = 20_000;

const MAX_TRANSITION_STEPS = 3;

const MAX_TRANSITION_SUCCESSORS = 50_000;

interface Visit {
  state: string[];
  parent: string | null;
  action: string | null;
}

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

const forEachProduct = (
  options: string[][],
  visit: (state: string[]) => void,
  limit: number,
): boolean => {
  let count = 0;
  const walk = (index: number, state: string[]): boolean => {
    if (index === options.length) {
      count++;
      visit([...state]);
      return count < limit;
    }
    for (const value of options[index]) {
      state.push(value);
      const isUnderLimit = walk(index + 1, state);
      state.pop();
      if (!isUnderLimit) return false;
    }
    return true;
  };
  return walk(0, []);
};

export const exploreModel = (
  variables: Variable[],
  actions: Action[],
  views: View[],
): StateGraph => {
  const variableIndexes = new Map(variables.map((variable, index) => [variable.name, index]));
  const observedIndexes = variables.flatMap((variable, index) =>
    variable.source === "control" ? [] : [index],
  );
  const visits = new Map<string, Visit>();
  const queue: string[] = [];
  const effectiveActions = new Set<string>();
  const edges = new Map<string, ViewTransition>();
  let isTruncated = false;

  const valueGetter =
    (state: string[]) =>
    (variable: string): string | undefined => {
      const index = variableIndexes.get(variable);
      return index === undefined ? undefined : state[index];
    };

  const getView = (state: string[]): string => getViewLabel(views, valueGetter(state));

  const forEachSuccessor = (
    state: string[],
    action: Action,
    visit: (next: string[]) => void,
  ): void => {
    const valueOf = valueGetter(state);
    if (evaluatePredicate(action.guard, valueOf) !== true) return;
    const writeIndexes = action.writes.map((write) => variableIndexes.get(write.variable) ?? -1);
    const options = action.writes.map((write, writeIndex) =>
      evaluateNextValue(write.next, state[writeIndexes[writeIndex]], valueOf),
    );
    const isExhaustive = forEachProduct(
      options,
      (written) => {
        const next = [...state];
        written.forEach((value, writeIndex) => {
          next[writeIndexes[writeIndex]] = value;
        });
        visit(next);
      },
      MAX_WRITE_COMBINATIONS,
    );
    if (!isExhaustive) isTruncated = true;
  };

  const enqueue = (state: string[], parent: string | null, action: string | null): string => {
    const key = state.join("\0");
    if (visits.has(key)) return key;
    if (visits.size >= MAX_STATES) {
      isTruncated = true;
      return key;
    }
    visits.set(key, { state, parent, action });
    queue.push(key);
    return key;
  };

  const isTooWide = variables.length > MAX_VARIABLES;
  const isComplete =
    !isTooWide &&
    forEachProduct(
      variables.map((variable) => variable.initial),
      (state) => enqueue(state, null, null),
      MAX_STATES,
    );
  if (!isComplete) isTruncated = true;
  let successorCount = 0;

  for (let index = 0; index < queue.length && successorCount < MAX_SUCCESSORS; index++) {
    const key = queue[index];
    const visit = visits.get(key);
    if (!visit) continue;
    const fromView = getView(visit.state);
    for (const action of actions) {
      forEachSuccessor(visit.state, action, (next) => {
        successorCount++;
        enqueue(next, key, action.name);
        const isChanged =
          action.hasRenderedWrite ||
          observedIndexes.some(
            (variableIndex) => next[variableIndex] !== visit.state[variableIndex],
          );
        if (!isChanged) return;
        effectiveActions.add(action.name);
        const toView = getView(next);
        if (action.phase === "input" && toView === fromView) return;
        const edgeKey = `${fromView}\0${action.label}\0${toView}`;
        if (!edges.has(edgeKey))
          edges.set(edgeKey, {
            from: fromView,
            to: toView,
            action: action.label,
            actionName: action.name,
            handlerId: action.handlerId,
            isAsync: action.phase === "fulfilled" || action.phase === "rejected",
            isInput: action.phase === "input",
          });
      });
    }
  }

  if (successorCount >= MAX_SUCCESSORS) isTruncated = true;
  const initialViews = [
    ...new Set(
      [...visits.values()]
        .filter((visit) => visit.parent === null)
        .map((visit) => getView(visit.state)),
    ),
  ];
  const reachableViews = [...new Set([...visits.values()].map((visit) => getView(visit.state)))];

  const toTrace = (key: string): TraceStep[] => {
    const steps: TraceStep[] = [];
    for (let current: string | null = key; current !== null;) {
      const visit = visits.get(current);
      if (!visit) break;
      steps.push({
        action: visit.action,
        state: Object.fromEntries(
          variables.map((variable, index) => [variable.name, visit.state[index]]),
        ),
        view: getView(visit.state),
      });
      current = visit.parent;
    }
    return steps.reverse();
  };

  const findTrace = (predicate: Predicate): TraceStep[] | null => {
    for (const [key, visit] of visits)
      if (evaluatePredicate(predicate, valueGetter(visit.state)) === true) return toTrace(key);
    return null;
  };

  const findTransition = (
    from: Predicate,
    to: Predicate,
    canTake: (action: Action, taken: Action[]) => boolean,
  ): boolean | null => {
    if (isTruncated) return null;
    let budget = MAX_TRANSITION_SUCCESSORS;
    for (const visit of visits.values()) {
      if (evaluatePredicate(from, valueGetter(visit.state)) !== true) continue;
      let frontier = [{ state: visit.state, taken: [] as Action[] }];
      const seen = new Set<string>();
      for (let step = 0; step < MAX_TRANSITION_STEPS && frontier.length > 0; step++) {
        const nextFrontier: typeof frontier = [];
        let isFound = false;
        for (const node of frontier)
          for (const action of actions) {
            if (!canTake(action, node.taken)) continue;
            forEachSuccessor(node.state, action, (next) => {
              budget--;
              if (evaluatePredicate(to, valueGetter(next)) === true) isFound = true;
              const nextTaken = [...node.taken, action];
              const key = [
                next.join("\0"),
                ...nextTaken.map((takenAction) => takenAction.name).sort(),
              ].join("\n");
              if (seen.has(key)) return;
              seen.add(key);
              nextFrontier.push({ state: next, taken: nextTaken });
            });
          }
        if (isFound) return true;
        if (budget <= 0) return null;
        frontier = nextFrontier;
      }
    }
    return false;
  };

  return {
    stateSpace: {
      stateCount: visits.size,
      isTruncated,
      initialViews,
      reachableViews,
      edges: [...edges.values()],
    },
    findTrace,
    isActionEffective: (action) => effectiveActions.has(action.name),
    findTransition,
  };
};

export const getViewLabel = (
  views: View[],
  valueOf: (variable: string) => string | undefined,
): string =>
  views.find((view) => evaluatePredicate(view.predicate, valueOf) === true)?.label ?? NO_VIEW;
