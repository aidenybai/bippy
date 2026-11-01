import { evaluateChoice, evaluateCondition } from "./conditions";
import type {
  Action,
  Condition,
  Exploration,
  Lane,
  Screen,
  ScreenEdge,
  TraceStep,
} from "./types";

const MAX_STATES = 20_000;

const MAX_LANES = 64;

const MAX_SUCCESSORS = 400_000;

const NO_SCREEN = "nothing";

interface Visit {
  cells: string[];
  parent: string | null;
  action: string | null;
}

export interface ExploredModel {
  exploration: Exploration;
  findWitness: (condition: Condition) => TraceStep[] | null;
  isActionEffective: (action: Action) => boolean;
}

const forEachProduct = (
  options: string[][],
  visit: (cells: string[]) => void,
  limit: number,
): boolean => {
  let count = 0;
  const walk = (index: number, cells: string[]): boolean => {
    if (index === options.length) {
      count++;
      visit([...cells]);
      return count < limit;
    }
    for (const cell of options[index]) {
      cells.push(cell);
      const isUnderLimit = walk(index + 1, cells);
      cells.pop();
      if (!isUnderLimit) return false;
    }
    return true;
  };
  return walk(0, []);
};

export const exploreModel = (
  lanes: Lane[],
  actions: Action[],
  screens: Screen[],
): ExploredModel => {
  const laneIndexes = new Map(lanes.map((lane, index) => [lane.name, index]));
  const observedIndexes = lanes.flatMap((lane, index) => (lane.source === "pending" ? [] : [index]));
  const visits = new Map<string, Visit>();
  const queue: string[] = [];
  const effectiveActions = new Set<string>();
  const edges = new Map<string, ScreenEdge>();
  let isTruncated = false;

  const cellGetter =
    (cells: string[]) =>
    (lane: string): string | undefined => {
      const index = laneIndexes.get(lane);
      return index === undefined ? undefined : cells[index];
    };

  const getScreen = (cells: string[]): string => {
    const cellOf = cellGetter(cells);
    return (
      screens.find((screen) => evaluateCondition(screen.condition, cellOf) === true)?.label ??
      NO_SCREEN
    );
  };

  const enqueue = (cells: string[], parent: string | null, action: string | null): string => {
    const key = cells.join("\0");
    if (visits.has(key)) return key;
    if (visits.size >= MAX_STATES) {
      isTruncated = true;
      return key;
    }
    visits.set(key, { cells, parent, action });
    queue.push(key);
    return key;
  };

  const isTooWide = lanes.length > MAX_LANES;
  const isComplete =
    !isTooWide &&
    forEachProduct(
      lanes.map((lane) => lane.initial),
      (cells) => enqueue(cells, null, null),
      MAX_STATES,
    );
  if (!isComplete) isTruncated = true;
  let successorCount = 0;

  for (let index = 0; index < queue.length && successorCount < MAX_SUCCESSORS; index++) {
    const key = queue[index];
    const visit = visits.get(key);
    if (!visit) continue;
    const cellOf = cellGetter(visit.cells);
    const fromScreen = getScreen(visit.cells);
    for (const action of actions) {
      if (evaluateCondition(action.guard, cellOf) !== true) continue;
      const writeIndexes = action.writes.map(({ lane }) => laneIndexes.get(lane) ?? -1);
      const options = action.writes.map(({ choice }, writeIndex) =>
        evaluateChoice(choice, visit.cells[writeIndexes[writeIndex]], cellOf),
      );
      forEachProduct(
        options,
        (written) => {
          successorCount++;
          const next = [...visit.cells];
          written.forEach((cell, writeIndex) => {
            next[writeIndexes[writeIndex]] = cell;
          });
          enqueue(next, key, action.name);
          const isChanged =
            action.isVisible || observedIndexes.some((laneIndex) => next[laneIndex] !== visit.cells[laneIndex]);
          if (!isChanged) return;
          effectiveActions.add(action.name);
          const toScreen = getScreen(next);
          if (action.phase === "input" && toScreen === fromScreen) return;
          const edgeKey = `${fromScreen}\0${action.label}\0${toScreen}`;
          if (!edges.has(edgeKey))
            edges.set(edgeKey, {
              from: fromScreen,
              to: toScreen,
              action: action.label,
              actionName: action.name,
              handlerId: action.handlerId,
              isAsync: action.phase === "resolves" || action.phase === "rejects",
              isInput: action.phase === "input",
            });
        },
        MAX_STATES,
      );
    }
  }

  if (successorCount >= MAX_SUCCESSORS) isTruncated = true;
  const initialScreens = [
    ...new Set(
      [...visits.values()].filter((visit) => visit.parent === null).map((visit) => getScreen(visit.cells)),
    ),
  ];
  const reachableScreens = [
    ...new Set([...visits.values()].map((visit) => getScreen(visit.cells))),
  ];

  const toTrace = (key: string): TraceStep[] => {
    const steps: TraceStep[] = [];
    for (let current: string | null = key; current !== null; ) {
      const visit = visits.get(current);
      if (!visit) break;
      steps.push({
        action: visit.action,
        cells: Object.fromEntries(lanes.map((lane, index) => [lane.name, visit.cells[index]])),
        screen: getScreen(visit.cells),
      });
      current = visit.parent;
    }
    return steps.reverse();
  };

  const findWitness = (condition: Condition): TraceStep[] | null => {
    for (const [key, visit] of visits)
      if (evaluateCondition(condition, cellGetter(visit.cells)) === true) return toTrace(key);
    return null;
  };

  return {
    exploration: {
      stateCount: visits.size,
      isTruncated,
      initialScreens,
      reachableScreens,
      edges: [...edges.values()],
    },
    findWitness,
    isActionEffective: (action) => effectiveActions.has(action.name),
  };
};

export const getScreenLabel = (screens: Screen[], cells: Record<string, string>): string =>
  screens.find((screen) => evaluateCondition(screen.condition, (lane) => cells[lane]) === true)
    ?.label ?? NO_SCREEN;
