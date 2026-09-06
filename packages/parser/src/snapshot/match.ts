import { formatFiberLabel } from "./render.js";
import type { FiberSnapshot, NodeSnapshot } from "./types.js";

export interface Mismatch {
  /** Runtime path of the parent whose children failed to match, e.g. `App › div`. */
  path: string;
  message: string;
}

export interface MatchResult {
  isMatch: boolean;
  mismatches: Mismatch[];
  runtimeFiberCount: number;
  /**
   * Runtime fibers matched by a concrete static fiber rather than absorbed
   * by an unknown wildcard; equals `runtimeFiberCount` for a fully
   * explained tree. Zero when the trees do not match.
   */
  explainedFiberCount: number;
}

interface FiberState {
  kind: "fiber";
  fiber: FiberSnapshot;
  next: number[];
}

interface AnyState {
  kind: "any";
  next: number[];
}

interface EpsilonState {
  kind: "epsilon" | "accept";
  next: number[];
}

type State = FiberState | AnyState | EpsilonState;

interface Automaton {
  states: State[];
  start: number;
  accept: number;
}

/** Tags whose runtime name is meaningful; built-ins and contexts carry none. */
const NAMED_TAGS = new Set<FiberSnapshot["tag"]>([
  "FunctionComponent",
  "ClassComponent",
  "ForwardRef",
  "MemoComponent",
  "SimpleMemoComponent",
  "HostComponent",
  "HostHoistable",
  "HostSingleton",
]);

const MAX_MISMATCHES = 25;

const compileSequence = (nodes: NodeSnapshot[], states: State[], exit: number): number => {
  let entry = exit;
  for (let index = nodes.length - 1; index >= 0; index--)
    entry = compileNode(nodes[index], states, entry);
  return entry;
};

const compileNode = (node: NodeSnapshot, states: State[], exit: number): number => {
  switch (node.kind) {
    case "fiber":
      return states.push({ kind: "fiber", fiber: node, next: [exit] }) - 1;
    case "unknown":
      return states.push({ kind: "any", next: [exit] }) - 1;
    case "branch": {
      const alternatives = node.alternatives.map((alternative) =>
        compileSequence(alternative, states, exit),
      );
      return states.push({ kind: "epsilon", next: alternatives }) - 1;
    }
    case "list": {
      const loop: EpsilonState = { kind: "epsilon", next: [exit] };
      const loopId = states.push(loop) - 1;
      loop.next.push(compileSequence(node.items, states, loopId));
      return loopId;
    }
  }
};

const compile = (nodes: NodeSnapshot[]): Automaton => {
  const states: State[] = [];
  const accept = states.push({ kind: "accept", next: [] }) - 1;
  return { states, start: compileSequence(nodes, states, accept), accept };
};

/** Alive automaton states, each with the best number of explained fibers on a path reaching it. */
type Frontier = Map<number, number>;

const advance = (frontier: Frontier, stateId: number, score: number): void => {
  const known = frontier.get(stateId);
  if (known === undefined || known < score) frontier.set(stateId, score);
};

const closure = (automaton: Automaton, seeds: Frontier): Frontier => {
  const reached: Frontier = new Map();
  const pending = [...seeds];
  while (pending.length > 0) {
    const entry = pending.pop();
    if (!entry) continue;
    const [stateId, score] = entry;
    const known = reached.get(stateId);
    if (known !== undefined && known >= score) continue;
    reached.set(stateId, score);
    const state = automaton.states[stateId];
    if (state.kind === "epsilon" || state.kind === "any") {
      for (const target of state.next) pending.push([target, score]);
    }
  }
  return reached;
};

interface Comparison {
  mismatches: Mismatch[];
  /** Fibers under (and including) the runtime fiber explained by concrete static fibers. */
  explained: number;
}

interface Matcher {
  results: Map<FiberSnapshot, WeakMap<FiberSnapshot, Comparison>>;
}

const remember = (
  matcher: Matcher,
  expected: FiberSnapshot,
  actual: FiberSnapshot,
  comparison: Comparison,
): Comparison => {
  let row = matcher.results.get(expected);
  if (!row) {
    row = new WeakMap();
    matcher.results.set(expected, row);
  }
  row.set(actual, comparison);
  return comparison;
};

const isSuspendedShape = (actual: FiberSnapshot): boolean =>
  actual.children.length === 2 &&
  actual.children[0].kind === "fiber" &&
  actual.children[0].tag === "OffscreenComponent" &&
  actual.children[1].kind === "fiber" &&
  actual.children[1].tag === "Fragment";

const compareAttributes = (expected: FiberSnapshot, actual: FiberSnapshot): string | null => {
  if (expected.tag !== null && expected.tag !== actual.tag) {
    return `tag ${actual.tag ?? "?"} where ${expected.tag} was expected`;
  }
  if (
    NAMED_TAGS.has(expected.tag) &&
    expected.name !== null &&
    actual.name !== null &&
    expected.name !== actual.name
  ) {
    return `name ${actual.name} where ${expected.name} was expected`;
  }
  if (expected.key !== null && expected.key !== actual.key) {
    return `key ${JSON.stringify(actual.key)} where ${JSON.stringify(expected.key)} was expected`;
  }
  if (expected.tag === "HostText" && expected.text !== null && expected.text !== actual.text) {
    return `text ${JSON.stringify(actual.text)} where ${JSON.stringify(expected.text)} was expected`;
  }
  return null;
};

const runtimeChildren = (fiber: FiberSnapshot): FiberSnapshot[] =>
  fiber.children.filter((child): child is FiberSnapshot => child.kind === "fiber");

const compareFibers = (
  matcher: Matcher,
  expected: FiberSnapshot,
  actual: FiberSnapshot,
  path: string,
): Comparison => {
  const cached = matcher.results.get(expected)?.get(actual);
  if (cached) return cached;
  const attributeMismatch = compareAttributes(expected, actual);
  if (attributeMismatch) {
    return remember(matcher, expected, actual, {
      mismatches: [{ path, message: attributeMismatch }],
      explained: 0,
    });
  }
  const childPath = path ? `${path} › ${formatFiberLabel(actual)}` : formatFiberLabel(actual);
  const children = runtimeChildren(actual);
  const isSuspended =
    expected.tag === "SuspenseComponent" && expected.fallback !== null && isSuspendedShape(actual);
  const comparison = isSuspended
    ? matchChildren(
        matcher,
        expected.fallback ?? [],
        runtimeChildren(children[1]),
        `${childPath} › fallback`,
      )
    : matchChildren(matcher, expected.children, children, childPath);
  if (comparison.mismatches.length > 0) return remember(matcher, expected, actual, comparison);
  const isIdentified = expected.tag !== null;
  const structuralFibers = isSuspended ? children.length : 0;
  return remember(matcher, expected, actual, {
    mismatches: [],
    explained: comparison.explained + (isIdentified ? 1 : 0) + structuralFibers,
  });
};

const dedupe = (mismatches: Mismatch[]): Mismatch[] => {
  const seen = new Set<string>();
  return mismatches.filter((mismatch) => {
    const key = `${mismatch.path}\n${mismatch.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

/** States are allocated back to front, so descending ids read in source order. */
const describeExpectation = (automaton: Automaton, alive: Frontier): string => {
  const labels = new Set<string>();
  for (const stateId of [...alive.keys()].sort((left, right) => right - left)) {
    const state = automaton.states[stateId];
    if (state.kind === "fiber") labels.add(formatFiberLabel(state.fiber));
    else if (state.kind === "accept") labels.add("end of children");
  }
  return [...labels].join(" | ") || "nothing";
};

/**
 * Simulates the children automaton over the runtime siblings. Among all
 * accepting paths the one explaining the most runtime fibers wins, so
 * wildcards only absorb what no concrete fiber can account for.
 */
const matchChildren = (
  matcher: Matcher,
  expected: NodeSnapshot[],
  actual: FiberSnapshot[],
  path: string,
): Comparison => {
  const automaton = compile(expected);
  let alive = closure(automaton, new Map([[automaton.start, 0]]));
  for (const [position, fiber] of actual.entries()) {
    const next: Frontier = new Map();
    const nestedMismatches: Mismatch[] = [];
    for (const [stateId, score] of alive) {
      const state = automaton.states[stateId];
      if (state.kind === "any") advance(next, stateId, score);
      if (state.kind !== "fiber") continue;
      const comparison = compareFibers(matcher, state.fiber, fiber, path);
      if (comparison.mismatches.length === 0) {
        for (const target of state.next) advance(next, target, score + comparison.explained);
      } else nestedMismatches.push(...comparison.mismatches);
    }
    if (next.size === 0) {
      const deeper = dedupe(nestedMismatches.filter((mismatch) => mismatch.path !== path));
      if (deeper.length > 0) return { mismatches: deeper.slice(0, MAX_MISMATCHES), explained: 0 };
      const message = `child ${position + 1} is ${formatFiberLabel(fiber)}; expected ${describeExpectation(automaton, alive)}`;
      return { mismatches: [{ path, message }], explained: 0 };
    }
    alive = closure(automaton, next);
  }
  const accepted = alive.get(automaton.accept);
  if (accepted !== undefined) return { mismatches: [], explained: accepted };
  return {
    mismatches: [
      {
        path,
        message: `children ended after ${actual.length}; expected ${describeExpectation(automaton, alive)}`,
      },
    ],
    explained: 0,
  };
};

const countFibers = (fiber: FiberSnapshot): number =>
  1 + runtimeChildren(fiber).reduce((total, child) => total + countFibers(child), 0);

/**
 * Checks that a runtime tree is one of the trees the static snapshot
 * describes. Unknown nodes match any siblings, branches match any of their
 * alternatives and lists match any number of repetitions.
 */
export const matchSnapshots = (expected: FiberSnapshot, actual: FiberSnapshot): MatchResult => {
  const matcher: Matcher = { results: new Map() };
  const comparison = compareFibers(matcher, expected, actual, "");
  return {
    isMatch: comparison.mismatches.length === 0,
    mismatches: comparison.mismatches,
    runtimeFiberCount: countFibers(actual),
    explainedFiberCount: comparison.explained,
  };
};

export const formatMismatches = (mismatches: Mismatch[]): string =>
  mismatches.map((mismatch) => `${mismatch.path || "<root>"}\n    ${mismatch.message}`).join("\n");
