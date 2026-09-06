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
  for (let index = nodes.length - 1; index >= 0; index--) entry = compileNode(nodes[index], states, entry);
  return entry;
};

const compileNode = (node: NodeSnapshot, states: State[], exit: number): number => {
  switch (node.kind) {
    case "fiber":
      return states.push({ kind: "fiber", fiber: node, next: [exit] }) - 1;
    case "unknown":
      return states.push({ kind: "any", next: [exit] }) - 1;
    case "branch": {
      const alternatives = node.alternatives.map((alternative) => compileSequence(alternative, states, exit));
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

const closure = (automaton: Automaton, seeds: Iterable<number>): Set<number> => {
  const reached = new Set<number>();
  const pending = [...seeds];
  while (pending.length > 0) {
    const stateId = pending.pop();
    if (stateId === undefined || reached.has(stateId)) continue;
    reached.add(stateId);
    const state = automaton.states[stateId];
    if (state.kind === "epsilon" || state.kind === "any") pending.push(...state.next);
  }
  return reached;
};

interface Matcher {
  results: Map<FiberSnapshot, WeakMap<FiberSnapshot, boolean>>;
  /** Why `expected` rejected `actual`, for the pair most recently compared. */
  reasons: Map<FiberSnapshot, WeakMap<FiberSnapshot, Mismatch[]>>;
}

const remember = <Value>(
  table: Map<FiberSnapshot, WeakMap<FiberSnapshot, Value>>,
  expected: FiberSnapshot,
  actual: FiberSnapshot,
  value: Value,
): Value => {
  let row = table.get(expected);
  if (!row) {
    row = new WeakMap();
    table.set(expected, row);
  }
  row.set(actual, value);
  return value;
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

const matchFiber = (
  matcher: Matcher,
  expected: FiberSnapshot,
  actual: FiberSnapshot,
  path: string,
): boolean => {
  const cached = matcher.results.get(expected)?.get(actual);
  if (cached !== undefined) return cached;
  const attributeMismatch = compareAttributes(expected, actual);
  if (attributeMismatch) {
    remember(matcher.reasons, expected, actual, [{ path, message: attributeMismatch }]);
    return remember(matcher.results, expected, actual, false);
  }
  const childPath = path ? `${path} › ${formatFiberLabel(actual)}` : formatFiberLabel(actual);
  const children = runtimeChildren(actual);
  const mismatches =
    expected.tag === "SuspenseComponent" && expected.fallback && isSuspendedShape(actual)
      ? matchChildren(matcher, expected.fallback, runtimeChildren(children[1]), `${childPath} › fallback`)
      : matchChildren(matcher, expected.children, children, childPath);
  remember(matcher.reasons, expected, actual, mismatches);
  return remember(matcher.results, expected, actual, mismatches.length === 0);
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

const describeExpectation = (automaton: Automaton, alive: Set<number>): string => {
  const labels = new Set<string>();
  for (const stateId of alive) {
    const state = automaton.states[stateId];
    if (state.kind === "fiber") labels.add(formatFiberLabel(state.fiber));
    else if (state.kind === "accept") labels.add("end of children");
  }
  return [...labels].join(" | ") || "nothing";
};

/** Simulates the children automaton over the runtime siblings; empty result means a match. */
const matchChildren = (
  matcher: Matcher,
  expected: NodeSnapshot[],
  actual: FiberSnapshot[],
  path: string,
): Mismatch[] => {
  const automaton = compile(expected);
  let alive = closure(automaton, [automaton.start]);
  for (const [position, fiber] of actual.entries()) {
    const next = new Set<number>();
    const nestedMismatches: Mismatch[] = [];
    for (const stateId of alive) {
      const state = automaton.states[stateId];
      if (state.kind === "any") next.add(stateId);
      if (state.kind !== "fiber") continue;
      if (matchFiber(matcher, state.fiber, fiber, path)) for (const target of state.next) next.add(target);
      else nestedMismatches.push(...(matcher.reasons.get(state.fiber)?.get(fiber) ?? []));
    }
    if (next.size === 0) {
      const deeper = dedupe(nestedMismatches.filter((mismatch) => mismatch.path !== path));
      if (deeper.length > 0) return deeper.slice(0, MAX_MISMATCHES);
      const message = `child ${position + 1} is ${formatFiberLabel(fiber)}; expected ${describeExpectation(automaton, alive)}`;
      return dedupe([{ path, message }, ...nestedMismatches]).slice(0, MAX_MISMATCHES);
    }
    alive = closure(automaton, next);
  }
  if (alive.has(automaton.accept)) return [];
  return [
    {
      path,
      message: `children ended after ${actual.length}; expected ${describeExpectation(automaton, alive)}`,
    },
  ];
};

const countFibers = (fiber: FiberSnapshot): number =>
  1 + runtimeChildren(fiber).reduce((total, child) => total + countFibers(child), 0);

/**
 * Checks that a runtime tree is one of the trees the static snapshot
 * describes. Unknown nodes match any siblings, branches match any of their
 * alternatives and lists match any number of repetitions.
 */
export const matchSnapshots = (expected: FiberSnapshot, actual: FiberSnapshot): MatchResult => {
  const matcher: Matcher = { results: new Map(), reasons: new Map() };
  const isMatch = matchFiber(matcher, expected, actual, "");
  return {
    isMatch,
    mismatches: isMatch ? [] : (matcher.reasons.get(expected)?.get(actual) ?? []),
    runtimeFiberCount: countFibers(actual),
  };
};

export const formatMismatches = (mismatches: Mismatch[]): string =>
  mismatches.map((mismatch) => `${mismatch.path || "<root>"}\n    ${mismatch.message}`).join("\n");
