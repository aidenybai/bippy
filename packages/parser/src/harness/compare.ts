import { countSnapshotFibers, type RuntimeFiberSnapshot } from "./snapshot.js";
import {
  countPatternFibers,
  formatRepeatBounds,
  hasPatternDecisions,
  scopePatternVariables,
  type PatternBranch,
  type PatternFiber,
  type PatternNode,
  type PatternOpaque,
  type PatternRepeat,
} from "./static-pattern.js";

/**
 * `exact`: the runtime tree is one enumerated state and no state was left out.
 * `truncated`: it is one enumerated state (or lies in the omitted region), but
 * the state space was bounded. `partial`: it matches only by letting wildcards
 * or opaque subtrees stand in for runtime fibers.
 */
export type ComparisonStatus =
  | "exact"
  | "truncated"
  | "partial"
  | "mismatch"
  | "unresolved"
  | "skipped";

// esbuild lowers `class X { static … }` to `var _a; _a = class {…}`, so pre-bundled
// library components can surface as `_a`, `_a2`, … with no identity to compare; swc
// lowers `const X = class { static … }` to `var _class; X = (_class = function _class …`.
const BUNDLER_PLACEHOLDER_NAME = /^_([a-z]\d*|class\d*)$/;

const isBundlerPlaceholderName = (name: string): boolean => BUNDLER_PLACEHOLDER_NAME.test(name);

// A binding that collides with another in the bundled scope is renamed with a
// counter: `Toaster2` by esbuild (Vite dev pre-bundling), `Toaster$1` by rollup.
const BUNDLER_DEDUPE_SUFFIX = /^\$?\d+$/;

const isBundlerDedupedName = (sourceName: string, runtimeName: string): boolean =>
  runtimeName.startsWith(sourceName) &&
  BUNDLER_DEDUPE_SUFFIX.test(runtimeName.slice(sourceName.length));

const WRAPPED_DISPLAY_NAME = /^([^()]+)\((.+)\)$/;

// A higher-order component's `displayName` embeds the wrapped component's name
// (`SideEffect(NullComponent)`), so the bundler's dedupe suffix lands inside it.
const isBundlerRenamedName = (sourceName: string, runtimeName: string): boolean => {
  if (isBundlerDedupedName(sourceName, runtimeName)) return true;
  const source = WRAPPED_DISPLAY_NAME.exec(sourceName);
  const runtime = WRAPPED_DISPLAY_NAME.exec(runtimeName);
  return (
    source !== null &&
    runtime !== null &&
    source[1] === runtime[1] &&
    isBundlerRenamedName(source[2], runtime[2])
  );
};

export interface ComparisonOptions {
  compareKeys?: boolean;
  compareTags?: boolean;
  compareText?: boolean;
  maxSteps?: number;
}

export interface ComparisonDivergence {
  path: string;
  expected: string;
  actual: string;
}

/** A runtime run of fibers a static wildcard stood in for. */
export interface WildcardAbsorption {
  path: string;
  reason: string;
  absorbedFibers: number;
  /** The runtime nodes at the head of the absorbed run. */
  heads: string[];
}

/** An opaque subtree whose passed children could not be located in the runtime output. */
export interface UnmatchedSlot {
  path: string;
  reason: string;
  head: string;
  skippedFibers: number;
  /** Where the most promising slot candidate stopped matching. */
  divergence: ComparisonDivergence | null;
}

/** The alternative (branch) or cardinality (repeat) a decision variable took to match. */
export interface MatchDecision {
  node: PatternBranch | PatternRepeat;
  choice: number;
}

export interface ComparisonTally {
  matchedFibers: number;
  matchedText: number;
  opaqueSubtrees: number;
  opaqueSkippedFibers: number;
  /** Opaque subtrees whose passed children were located and matched inside the library's runtime output. */
  slotsMatched: number;
  /** Opaque subtrees whose passed children could not be located; the whole subtree was skipped. */
  slotsUnmatched: number;
  /** Opaque subtrees matched by structure whose runtime component name disagreed with the static one. */
  opaqueRenamed: number;
  unmatchedSlots: UnmatchedSlot[];
  wildcardAbsorbedFibers: number;
  wildcards: WildcardAbsorption[];
  branchesResolved: number;
  repeatIterations: number;
}

interface MatchTally extends ComparisonTally {
  decisions: MatchDecision[];
  /** Runtime fibers the innermost open slot's passed children consumed; zeroed once that slot is tallied. */
  slotConsumedFibers: number;
}

export interface ComparisonReport extends ComparisonTally {
  status: ComparisonStatus;
  runtimeFibers: number;
  staticFibers: number;
  /** Explained fibers over the runtime fibers left after opaque and wildcard subtrees are set aside. */
  coverage: number;
  /** Explained fibers over every runtime fiber; wildcards and opaque subtrees cannot raise it. */
  strictCoverage: number;
  divergence: ComparisonDivergence | null;
  stepsUsed: number;
  budgetExhausted: boolean;
}

const DEFAULT_MAX_STEPS = 200_000;

const EMPTY_TALLY: MatchTally = {
  matchedFibers: 0,
  matchedText: 0,
  opaqueSubtrees: 0,
  opaqueSkippedFibers: 0,
  slotsMatched: 0,
  slotsUnmatched: 0,
  opaqueRenamed: 0,
  unmatchedSlots: [],
  wildcardAbsorbedFibers: 0,
  wildcards: [],
  branchesResolved: 0,
  repeatIterations: 0,
  decisions: [],
  slotConsumedFibers: 0,
};

const addTally = (left: MatchTally, right: Partial<MatchTally>): MatchTally => ({
  matchedFibers: left.matchedFibers + (right.matchedFibers ?? 0),
  matchedText: left.matchedText + (right.matchedText ?? 0),
  opaqueSubtrees: left.opaqueSubtrees + (right.opaqueSubtrees ?? 0),
  opaqueSkippedFibers: left.opaqueSkippedFibers + (right.opaqueSkippedFibers ?? 0),
  slotsMatched: left.slotsMatched + (right.slotsMatched ?? 0),
  slotsUnmatched: left.slotsUnmatched + (right.slotsUnmatched ?? 0),
  opaqueRenamed: left.opaqueRenamed + (right.opaqueRenamed ?? 0),
  unmatchedSlots: right.unmatchedSlots
    ? [...right.unmatchedSlots, ...left.unmatchedSlots]
    : left.unmatchedSlots,
  wildcardAbsorbedFibers: left.wildcardAbsorbedFibers + (right.wildcardAbsorbedFibers ?? 0),
  wildcards: right.wildcards ? [...right.wildcards, ...left.wildcards] : left.wildcards,
  branchesResolved: left.branchesResolved + (right.branchesResolved ?? 0),
  repeatIterations: left.repeatIterations + (right.repeatIterations ?? 0),
  decisions: right.decisions ? [...right.decisions, ...left.decisions] : left.decisions,
  slotConsumedFibers: left.slotConsumedFibers + (right.slotConsumedFibers ?? 0),
});

interface Continuation {
  (runtimeIndex: number): MatchTally | null;
}

/** Where matching got furthest before failing, with the decisions in force there. */
export interface FurthestFailure {
  position: number;
  divergence: ComparisonDivergence;
  assignment: Map<string, number>;
}

interface SlotMatch {
  tally: MatchTally;
  consumedFibers: number;
}

interface Attempt<Result> {
  result: Result;
  failure: FurthestFailure | null;
}

interface RankedAlternative {
  tally: MatchTally;
  index: number;
}

interface SlotSearchResult {
  match: SlotMatch | null;
  divergence: ComparisonDivergence | null;
}

interface FurthestSlotDivergence {
  progress: number;
  divergence: ComparisonDivergence;
}

class BudgetExceeded extends Error {}

// Any non-host fiber passes an opaque head check, so a slot candidate that
// merely leaves its own slots unmatched is only a fallback; the candidate
// explaining the most runtime fibers is the library's real slot.
const isSettledSlotMatch = ({ tally }: SlotMatch): boolean =>
  tally.slotsUnmatched === 0 && tally.opaqueRenamed === 0;

const isBetterSlotMatch = (candidate: SlotMatch, best: SlotMatch): boolean => {
  const matched = candidate.tally.matchedFibers + candidate.tally.matchedText;
  const bestMatched = best.tally.matchedFibers + best.tally.matchedText;
  if (matched !== bestMatched) return matched > bestMatched;
  if (candidate.tally.slotsUnmatched !== best.tally.slotsUnmatched) {
    return candidate.tally.slotsUnmatched < best.tally.slotsUnmatched;
  }
  return candidate.tally.opaqueRenamed < best.tally.opaqueRenamed;
};

export const describeRuntimeFiber = (fiber: RuntimeFiberSnapshot | undefined): string => {
  if (!fiber) return "<end of children>";
  if (fiber.tag === "HostText") return JSON.stringify(fiber.text ?? "");
  const key = fiber.key === null ? "" : ` key=${JSON.stringify(fiber.key)}`;
  return `<${fiber.name ?? fiber.tag}>${key} [${fiber.tag}]`;
};

export const describePatternNode = (node: PatternNode): string => {
  switch (node.kind) {
    case "fiber": {
      const key = node.key === null ? "" : ` key=${JSON.stringify(node.key)}`;
      return `<${node.name ?? node.tag}>${key} [${node.tag}]`;
    }
    case "text":
      return node.text === null ? "#text(dynamic)" : JSON.stringify(node.text);
    case "branch":
      return `?branch(${node.reason})`;
    case "repeat":
      return `*repeat(${formatRepeatBounds(node.count)})`;
    case "opaque":
      return `<${node.name}> (opaque)`;
    case "wildcard":
      return `?unknown(${node.reason})`;
  }
};

const TAG_EQUIVALENTS: Record<string, string[]> = {
  HostComponent: ["HostComponent", "HostSingleton", "HostHoistable"],
  HostSingleton: ["HostComponent", "HostSingleton"],
  HostHoistable: ["HostComponent", "HostHoistable"],
  FunctionComponent: ["FunctionComponent", "SimpleMemoComponent", "IncompleteFunctionComponent"],
  SimpleMemoComponent: ["SimpleMemoComponent", "FunctionComponent"],
  ClassComponent: ["ClassComponent", "IncompleteClassComponent"],
};

const HOST_TAGS = new Set(["HostComponent", "HostSingleton", "HostHoistable", "HostText"]);

const isHostTag = (tag: string): boolean => HOST_TAGS.has(tag);

const isClassTag = (tag: string): boolean => TAG_EQUIVALENTS.ClassComponent.includes(tag);

const tagsCompatible = (expected: string, actual: string): boolean =>
  expected === actual || (TAG_EQUIVALENTS[expected]?.includes(actual) ?? false);

// Pre-order positions over the runtime tree; a failure is reported at the
// furthest position any alternative reached, as parsers report their
// furthest-failure, so backtracked branches do not hide the real divergence.
// Isolated attempts (slot searches, preferred branches) get their own frame so
// their failures can be inspected without polluting the enclosing frame.
interface RuntimePositions {
  start: Map<RuntimeFiberSnapshot, number>;
  end: Map<RuntimeFiberSnapshot[], number>;
}

const indexRuntime = (roots: RuntimeFiberSnapshot[]): RuntimePositions => {
  const positions: RuntimePositions = { start: new Map(), end: new Map() };
  let position = 0;
  const visitList = (fibers: RuntimeFiberSnapshot[]): void => {
    for (const fiber of fibers) {
      positions.start.set(fiber, position++);
      visitList(fiber.children);
    }
    positions.end.set(fibers, position);
  };
  visitList(roots);
  return positions;
};

class Matcher {
  private steps = 0;
  private readonly furthest: (FurthestFailure | null)[] = [null];
  private positions: RuntimePositions = { start: new Map(), end: new Map() };
  /** Decisions in force on the path being tried; a variable met again must agree. */
  private readonly assignment = new Map<string, number>();
  private readonly scopedRepeatChildren = new Map<PatternRepeat, PatternNode[][]>();
  private readonly compareKeys: boolean;
  private readonly compareTags: boolean;
  private readonly compareText: boolean;
  private readonly maxSteps: number;

  constructor(options: ComparisonOptions) {
    this.compareKeys = options.compareKeys ?? true;
    this.compareTags = options.compareTags ?? true;
    this.compareText = options.compareText ?? true;
    this.maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
  }

  get stepsUsed(): number {
    return this.steps;
  }

  get failure(): FurthestFailure | null {
    return this.furthest[this.furthest.length - 1];
  }

  indexRuntime(roots: RuntimeFiberSnapshot[]): void {
    this.positions = indexRuntime(roots);
  }

  recordFailure(
    path: string[],
    runtime: RuntimeFiberSnapshot[],
    index: number,
    expected: PatternNode | null,
  ): void {
    const actual = runtime[index];
    const position =
      (actual ? this.positions.start.get(actual) : this.positions.end.get(runtime)) ?? 0;
    const level = this.furthest.length - 1;
    const current = this.furthest[level];
    if (current && current.position >= position) return;
    this.furthest[level] = {
      position,
      divergence: {
        path: `${path.join(" > ")}[${index}]`,
        expected: expected ? describePatternNode(expected) : "<end of children>",
        actual: describeRuntimeFiber(actual),
      },
      assignment: new Map(this.assignment),
    };
  }

  private tick(): void {
    this.steps++;
    if (this.steps > this.maxSteps) throw new BudgetExceeded();
  }

  private attempt<Result>(run: () => Result): Attempt<Result> {
    this.furthest.push(null);
    try {
      const result = run();
      return { result, failure: this.furthest[this.furthest.length - 1] };
    } finally {
      this.furthest.pop();
    }
  }

  matchList(
    patterns: PatternNode[],
    index: number,
    runtime: RuntimeFiberSnapshot[],
    runtimeIndex: number,
    path: string[],
    continuation: Continuation,
  ): MatchTally | null {
    let prefix = EMPTY_TALLY;
    let nextIndex = index;
    let nextRuntimeIndex = runtimeIndex;
    while (nextIndex < patterns.length && !hasPatternDecisions(patterns[nextIndex])) {
      const nodeTally = this.matchNode(
        patterns[nextIndex],
        runtime,
        nextRuntimeIndex,
        path,
        () => EMPTY_TALLY,
      );
      if (!nodeTally) return null;
      prefix = addTally(prefix, nodeTally);
      nextIndex++;
      nextRuntimeIndex++;
    }
    const rest =
      nextIndex === patterns.length
        ? continuation(nextRuntimeIndex)
        : this.matchNode(patterns[nextIndex], runtime, nextRuntimeIndex, path, (restIndex) =>
            this.matchList(patterns, nextIndex + 1, runtime, restIndex, path, continuation),
          );
    return rest ? addTally(rest, prefix) : null;
  }

  // Nothing backtracks into a decision-free subtree, so matching it eagerly
  // keeps the continuation chain (and the call stack) proportional to the
  // decisions rather than to the size of the tree.
  private matchDecisionFreeList(
    patterns: PatternNode[],
    runtime: RuntimeFiberSnapshot[],
    path: string[],
  ): MatchTally | null {
    let tally = EMPTY_TALLY;
    for (const [index, pattern] of patterns.entries()) {
      const nodeTally = this.matchNode(pattern, runtime, index, path, () => EMPTY_TALLY);
      if (!nodeTally) return null;
      tally = addTally(tally, nodeTally);
    }
    if (patterns.length !== runtime.length) {
      this.recordFailure(path, runtime, patterns.length, null);
      return null;
    }
    return tally;
  }

  private matchNode(
    pattern: PatternNode,
    runtime: RuntimeFiberSnapshot[],
    runtimeIndex: number,
    path: string[],
    continuation: Continuation,
  ): MatchTally | null {
    this.tick();
    const actual = runtime[runtimeIndex];
    switch (pattern.kind) {
      case "fiber": {
        if (!actual || !this.headMatches(pattern, actual)) {
          this.recordFailure(path, runtime, runtimeIndex, pattern);
          return null;
        }
        const childPath = [...path, describePatternNode(pattern)];
        if (!hasPatternDecisions(pattern)) {
          const children = this.matchDecisionFreeList(pattern.children, actual.children, childPath);
          if (!children) return null;
          const rest = continuation(runtimeIndex + 1);
          return rest ? addTally(addTally(rest, children), { matchedFibers: 1 }) : null;
        }
        const tally = this.matchList(
          pattern.children,
          0,
          actual.children,
          0,
          childPath,
          (nextIndex) => {
            if (nextIndex === actual.children.length) return continuation(runtimeIndex + 1);
            this.recordFailure(childPath, actual.children, nextIndex, null);
            return null;
          },
        );
        return tally ? addTally(tally, { matchedFibers: 1 }) : null;
      }
      case "text": {
        if (
          !actual ||
          actual.tag !== "HostText" ||
          (this.compareText && pattern.text !== null && pattern.text !== actual.text)
        ) {
          this.recordFailure(path, runtime, runtimeIndex, pattern);
          return null;
        }
        const rest = continuation(runtimeIndex + 1);
        return rest ? addTally(rest, { matchedText: 1 }) : null;
      }
      case "opaque": {
        if (!actual || !this.opaqueHeadMatches(pattern, actual)) {
          this.recordFailure(path, runtime, runtimeIndex, pattern);
          return null;
        }
        const rest = continuation(runtimeIndex + 1);
        if (!rest) return null;
        const head: Partial<MatchTally> = {
          opaqueSubtrees: 1,
          opaqueRenamed: this.opaqueNameAgrees(pattern, actual) ? 0 : 1,
        };
        const skippedFibers = countSnapshotFibers(actual);
        if (pattern.passedChildren.length === 0) {
          return addTally(rest, { ...head, opaqueSkippedFibers: skippedFibers });
        }
        const slotPath = [...path, describePatternNode(pattern)];
        const slot = this.matchSlot(pattern, actual, slotPath);
        if (slot.match) {
          return addTally(addTally(rest, slot.match.tally), {
            ...head,
            slotsMatched: 1,
            opaqueSkippedFibers: skippedFibers - slot.match.consumedFibers,
          });
        }
        return addTally(rest, {
          ...head,
          slotsUnmatched: 1,
          opaqueSkippedFibers: skippedFibers,
          unmatchedSlots: [
            {
              path: slotPath.join(" > "),
              reason: pattern.reason,
              head: describeRuntimeFiber(actual),
              skippedFibers,
              divergence: slot.divergence,
            },
          ],
        });
      }
      case "wildcard": {
        for (let absorbed = 0; runtimeIndex + absorbed <= runtime.length; absorbed++) {
          const rest = continuation(runtimeIndex + absorbed);
          if (rest) {
            const absorbedRun = runtime.slice(runtimeIndex, runtimeIndex + absorbed);
            const absorbedFibers = absorbedRun.reduce(
              (total, fiber) => total + countSnapshotFibers(fiber),
              0,
            );
            if (absorbedFibers === 0) return rest;
            return addTally(rest, {
              wildcardAbsorbedFibers: absorbedFibers,
              wildcards: [
                {
                  path: path.join(" > "),
                  reason: pattern.reason,
                  absorbedFibers,
                  heads: absorbedRun.map(describeRuntimeFiber),
                },
              ],
            });
          }
        }
        this.recordFailure(path, runtime, runtimeIndex, pattern);
        return null;
      }
      case "branch": {
        const decided = this.assignment.get(pattern.variable);
        if (decided !== undefined) {
          const alternative = pattern.alternatives[decided];
          if (!alternative) {
            this.recordFailure(path, runtime, runtimeIndex, pattern);
            return null;
          }
          return this.matchList(alternative, 0, runtime, runtimeIndex, path, continuation);
        }
        const order = pattern.alternatives.map((_, alternativeIndex) => alternativeIndex);
        if (pattern.preferredIndex !== null && pattern.preferredIndex < order.length) {
          order.splice(order.indexOf(pattern.preferredIndex), 1);
          order.unshift(pattern.preferredIndex);
        }
        const resolve = (result: MatchTally, choice: number): MatchTally =>
          addTally(result, { branchesResolved: 1, decisions: [{ node: pattern, choice }] });
        // Alternatives are tried in preference order, but one that explains the
        // runtime without leaning on wildcards beats an earlier one that does.
        let best: RankedAlternative | null = null;
        for (const alternativeIndex of order) {
          this.assignment.set(pattern.variable, alternativeIndex);
          let result: MatchTally | null;
          try {
            result = this.matchList(
              pattern.alternatives[alternativeIndex],
              0,
              runtime,
              runtimeIndex,
              path,
              continuation,
            );
          } finally {
            this.assignment.delete(pattern.variable);
          }
          if (!result) continue;
          if (result.wildcardAbsorbedFibers === 0) return resolve(result, alternativeIndex);
          if (!best || result.wildcardAbsorbedFibers < best.tally.wildcardAbsorbedFibers) {
            best = { tally: result, index: alternativeIndex };
          }
        }
        return best ? resolve(best.tally, best.index) : null;
      }
      case "repeat": {
        // Longest run first; every iteration gets its own copies of the
        // decision variables inside, as each item decides for itself.
        const iterate = (start: number, iteration: number): MatchTally | null => {
          const canIterate = pattern.count.max === null || iteration < pattern.count.max;
          const more = canIterate
            ? this.matchList(
                this.iterationChildren(pattern, iteration),
                0,
                runtime,
                start,
                path,
                (nextIndex) => (nextIndex === start ? null : iterate(nextIndex, iteration + 1)),
              )
            : null;
          if (more) return more;
          if (iteration < pattern.count.min) {
            this.recordFailure(path, runtime, start, pattern);
            return null;
          }
          const rest = continuation(start);
          return rest
            ? addTally(rest, {
                repeatIterations: iteration,
                decisions: [{ node: pattern, choice: iteration }],
              })
            : null;
        };
        return iterate(runtimeIndex, 0);
      }
    }
  }

  private iterationChildren(pattern: PatternRepeat, iteration: number): PatternNode[] {
    let iterations = this.scopedRepeatChildren.get(pattern);
    if (!iterations) {
      iterations = [];
      this.scopedRepeatChildren.set(pattern, iterations);
    }
    for (let index = iterations.length; index <= iteration; index++) {
      iterations.push(scopePatternVariables(pattern.children, `${pattern.variable}[${index}]`));
    }
    return iterations[iteration];
  }

  private headMatches(pattern: PatternFiber, actual: RuntimeFiberSnapshot): boolean {
    if (actual.tag === "HostText") return false;
    if (this.compareTags && !tagsCompatible(pattern.tag, actual.tag)) return false;
    if (
      this.compareKeys &&
      pattern.key !== null &&
      actual.key !== null &&
      pattern.key !== actual.key
    )
      return false;
    if (pattern.name === null || actual.name === null || pattern.name === actual.name) return true;
    if (isBundlerRenamedName(pattern.name, actual.name)) return true;
    return isClassTag(actual.tag) && isBundlerPlaceholderName(actual.name);
  }

  // An opaque component's runtime identity is whatever non-host fiber sits in its
  // place; name agreement is tracked separately as it is only a hint.
  private opaqueHeadMatches(pattern: PatternOpaque, actual: RuntimeFiberSnapshot): boolean {
    if (isHostTag(actual.tag)) return false;
    return !(
      this.compareKeys &&
      pattern.key !== null &&
      actual.key !== null &&
      pattern.key !== actual.key
    );
  }

  private opaqueNameAgrees(pattern: PatternOpaque, actual: RuntimeFiberSnapshot): boolean {
    if (actual.name === null || isBundlerPlaceholderName(actual.name)) return true;
    if (pattern.runtimeNames === null) return true;
    const runtimeName = actual.name;
    return pattern.runtimeNames.some(
      (name) => name === runtimeName || isBundlerRenamedName(name, runtimeName),
    );
  }

  // Searches the library's runtime subtree breadth-first for the place where it
  // rendered the children the application passed in, so the shallowest fit wins.
  // Libraries may render siblings around the slot, so the passed children only
  // need to appear as a contiguous run; provider stacks may bury the slot under
  // dozens of wrapper layers. When no candidate fits, the one that got furthest
  // past its start explains why.
  private matchSlot(
    pattern: PatternOpaque,
    actual: RuntimeFiberSnapshot,
    path: string[],
  ): SlotSearchResult {
    const queue: RuntimeFiberSnapshot[] = [actual];
    let best: FurthestSlotDivergence | null = null;
    let bestMatch: SlotMatch | null = null;
    for (let queueIndex = 0; queueIndex < queue.length; queueIndex++) {
      const fiber = queue[queueIndex];
      for (let start = 0; start < fiber.children.length; start++) {
        const { result, failure } = this.attempt(() =>
          this.matchSlotAt(pattern, fiber.children, start, path),
        );
        if (result) {
          if (isSettledSlotMatch(result)) return { match: result, divergence: null };
          if (!bestMatch || isBetterSlotMatch(result, bestMatch)) bestMatch = result;
          continue;
        }
        const startPosition = this.positions.start.get(fiber.children[start]) ?? 0;
        if (failure && (!best || failure.position - startPosition > best.progress)) {
          best = { progress: failure.position - startPosition, divergence: failure.divergence };
        }
      }
      queue.push(...fiber.children);
    }
    if (bestMatch) return { match: bestMatch, divergence: null };
    // Passed children that evaluate to nothing (all-empty branches) leave no
    // runtime trace to find; they match against an empty sibling list.
    const empty = this.attempt(() => this.matchSlotAt(pattern, [], 0, path));
    return { match: empty.result, divergence: best?.divergence ?? null };
  }

  private matchSlotAt(
    pattern: PatternOpaque,
    siblings: RuntimeFiberSnapshot[],
    start: number,
    path: string[],
  ): SlotMatch | null {
    const tally = this.matchList(pattern.passedChildren, 0, siblings, start, path, (nextIndex) => {
      if (nextIndex === start && siblings.length > 0) return null;
      const slotConsumedFibers = siblings
        .slice(start, nextIndex)
        .reduce((total, sibling) => total + countSnapshotFibers(sibling), 0);
      return { ...EMPTY_TALLY, slotConsumedFibers };
    });
    return tally
      ? { tally: { ...tally, slotConsumedFibers: 0 }, consumedFibers: tally.slotConsumedFibers }
      : null;
  }
}

const classify = (tally: ComparisonTally): ComparisonStatus =>
  tally.opaqueSubtrees === 0 && tally.wildcardAbsorbedFibers === 0 ? "exact" : "partial";

export interface PatternMatch {
  report: ComparisonReport;
  /** The decisions that selected the matching concrete tree; empty when nothing matched. */
  decisions: MatchDecision[];
  failure: FurthestFailure | null;
}

/**
 * Finds an assignment of the pattern's decision variables under which the
 * pattern equals the runtime tree, backtracking through alternatives and
 * repeat counts. Variables met twice must take the same value both times.
 */
export const matchPatternToRuntime = (
  patterns: PatternNode[],
  runtime: RuntimeFiberSnapshot[],
  options: ComparisonOptions = {},
): PatternMatch => {
  const matcher = new Matcher(options);
  matcher.indexRuntime(runtime);
  const runtimeFibers = runtime.reduce((sum, fiber) => sum + countSnapshotFibers(fiber), 0);
  const staticFibers = patterns.reduce((sum, node) => sum + countPatternFibers(node), 0);
  let tally: MatchTally | null = null;
  let budgetExhausted = false;
  try {
    tally = matcher.matchList(patterns, 0, runtime, 0, ["root"], (nextIndex) => {
      if (nextIndex === runtime.length) return EMPTY_TALLY;
      matcher.recordFailure(["root"], runtime, nextIndex, null);
      return null;
    });
  } catch (error) {
    if (!(error instanceof BudgetExceeded)) throw error;
    budgetExhausted = true;
  }
  const { decisions, slotConsumedFibers: _slotConsumedFibers, ...base } = tally ?? EMPTY_TALLY;
  const denominator = Math.max(
    1,
    runtimeFibers - base.opaqueSkippedFibers - base.wildcardAbsorbedFibers,
  );
  const failure = tally ? null : matcher.failure;
  return {
    report: {
      ...base,
      status: tally ? classify(tally) : "mismatch",
      runtimeFibers,
      staticFibers,
      coverage: tally ? (base.matchedFibers + base.matchedText) / denominator : 0,
      strictCoverage: tally
        ? (base.matchedFibers + base.matchedText) / Math.max(1, runtimeFibers)
        : 0,
      divergence: failure?.divergence ?? null,
      stepsUsed: matcher.stepsUsed,
      budgetExhausted,
    },
    decisions,
    failure,
  };
};

export const comparePatternToRuntime = (
  patterns: PatternNode[],
  runtime: RuntimeFiberSnapshot[],
  options: ComparisonOptions = {},
): ComparisonReport => matchPatternToRuntime(patterns, runtime, options).report;
