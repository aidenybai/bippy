import { countSnapshotFibers, type RuntimeFiberSnapshot } from "./snapshot.js";
import {
  countPatternFibers,
  type PatternFiber,
  type PatternNode,
  type PatternOpaque,
  type PatternText,
  type PatternWildcard,
} from "./static-pattern.js";

export type ComparisonStatus = "exact" | "partial" | "mismatch" | "unresolved" | "skipped";

// esbuild lowers `class X { static … }` to `var _a; _a = class {…}`, so pre-bundled
// library components can surface as `_a`, `_a2`, … with no identity to compare.
const BUNDLER_PLACEHOLDER_NAME = /^_[a-z]\d*$/;

const isBundlerPlaceholderName = (name: string): boolean => BUNDLER_PLACEHOLDER_NAME.test(name);

// A binding that collides with another in the bundled scope is renamed with a
// counter: `Toaster2` by esbuild (Vite dev pre-bundling), `Toaster$1` by rollup.
const BUNDLER_DEDUPE_SUFFIX = /^\$?\d+$/;

const isBundlerDedupedName = (sourceName: string, runtimeName: string): boolean =>
  runtimeName.startsWith(sourceName) &&
  BUNDLER_DEDUPE_SUFFIX.test(runtimeName.slice(sourceName.length));

export interface ComparisonOptions {
  compareKeys?: boolean;
  compareTags?: boolean;
  compareText?: boolean;
  maxSteps?: number;
  /**
   * Framework wrappers the runtime may insert anywhere without a static
   * counterpart. They are spliced out only where the static tree does not
   * account for them, so an application component sharing a wrapper's name
   * still matches its own fiber.
   */
  isTransparentRuntimeFiber?: (fiber: RuntimeFiberSnapshot) => boolean;
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

/** A branch matched by an alternative other than the one the evaluator expected. */
export interface BranchDeviation {
  path: string;
  reason: string;
  preferredIndex: number;
  chosenIndex: number;
  /** Where the preferred alternative stopped matching. */
  divergence: ComparisonDivergence | null;
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
  branchDeviations: BranchDeviation[];
  repeatIterations: number;
  /** Framework wrappers spliced out of the runtime tree because the static tree had no fiber for them. */
  transparentFibers: number;
}

export interface ComparisonReport extends ComparisonTally {
  status: ComparisonStatus;
  /** Runtime fibers left once spliced-out framework wrappers are set aside. */
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
// Providers and routers typically render their children within a few wrapper
// layers; deeper slot searches would start matching unrelated subtrees.
const MAX_SLOT_SEARCH_DEPTH = 12;

const EMPTY_TALLY: ComparisonTally = {
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
  branchDeviations: [],
  repeatIterations: 0,
  transparentFibers: 0,
};

const addTally = (left: ComparisonTally, right: Partial<ComparisonTally>): ComparisonTally => ({
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
  branchDeviations: right.branchDeviations
    ? [...right.branchDeviations, ...left.branchDeviations]
    : left.branchDeviations,
  repeatIterations: left.repeatIterations + (right.repeatIterations ?? 0),
  transparentFibers: left.transparentFibers + (right.transparentFibers ?? 0),
});

interface Continuation {
  (runtime: RuntimeFiberSnapshot[], runtimeIndex: number): ComparisonTally | null;
}

interface FurthestFailure {
  position: number;
  divergence: ComparisonDivergence;
}

interface SlotMatch {
  tally: ComparisonTally;
  consumedFibers: number;
}

interface Attempt<Result> {
  result: Result;
  failure: FurthestFailure | null;
}

interface RankedAlternative {
  tally: ComparisonTally;
  index: number;
}

interface SlotSearchResult {
  match: SlotMatch | null;
  divergence: ComparisonDivergence | null;
}

interface SlotSearchFrame {
  fiber: RuntimeFiberSnapshot;
  depth: number;
}

interface FurthestSlotDivergence {
  progress: number;
  divergence: ComparisonDivergence;
}

class BudgetExceeded extends Error {}

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
      return "*repeat";
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
  private readonly compareKeys: boolean;
  private readonly compareTags: boolean;
  private readonly compareText: boolean;
  private readonly maxSteps: number;
  private readonly isTransparentRuntimeFiber: (fiber: RuntimeFiberSnapshot) => boolean;

  constructor(options: ComparisonOptions) {
    this.compareKeys = options.compareKeys ?? true;
    this.compareTags = options.compareTags ?? true;
    this.compareText = options.compareText ?? true;
    this.maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
    this.isTransparentRuntimeFiber = options.isTransparentRuntimeFiber ?? (() => false);
  }

  get stepsUsed(): number {
    return this.steps;
  }

  get divergence(): ComparisonDivergence | null {
    return this.furthest[this.furthest.length - 1]?.divergence ?? null;
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
    const position = this.positionAt(runtime, index);
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
    };
  }

  private positionAt(runtime: RuntimeFiberSnapshot[], index: number): number {
    const fiber = runtime[index];
    return (fiber ? this.positions.start.get(fiber) : this.positions.end.get(runtime)) ?? 0;
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

  private recordFurthest(failure: FurthestFailure | null): void {
    if (!failure) return;
    const level = this.furthest.length - 1;
    const current = this.furthest[level];
    if (!current || failure.position > current.position) this.furthest[level] = failure;
  }

  matchList(
    patterns: PatternNode[],
    index: number,
    runtime: RuntimeFiberSnapshot[],
    runtimeIndex: number,
    path: string[],
    continuation: Continuation,
  ): ComparisonTally | null {
    if (index === patterns.length) return continuation(runtime, runtimeIndex);
    return this.matchNode(patterns[index], runtime, runtimeIndex, path, (nextRuntime, nextIndex) =>
      this.matchList(patterns, index + 1, nextRuntime, nextIndex, path, continuation),
    );
  }

  private spliceTransparentFiber(
    runtime: RuntimeFiberSnapshot[],
    runtimeIndex: number,
  ): RuntimeFiberSnapshot[] {
    const spliced = [
      ...runtime.slice(0, runtimeIndex),
      ...runtime[runtimeIndex].children,
      ...runtime.slice(runtimeIndex + 1),
    ];
    this.positions.end.set(spliced, this.positions.end.get(runtime) ?? 0);
    return spliced;
  }

  private matchNode(
    pattern: PatternNode,
    runtime: RuntimeFiberSnapshot[],
    runtimeIndex: number,
    path: string[],
    continuation: Continuation,
  ): ComparisonTally | null {
    this.tick();
    switch (pattern.kind) {
      case "fiber":
      case "text":
      case "opaque":
      case "wildcard":
        return this.matchLeaf(pattern, runtime, runtimeIndex, path, continuation);
      case "branch": {
        const order = pattern.alternatives.map((_, alternativeIndex) => alternativeIndex);
        if (pattern.preferredIndex !== null && pattern.preferredIndex < order.length) {
          order.splice(order.indexOf(pattern.preferredIndex), 1);
          order.unshift(pattern.preferredIndex);
        }
        let preferredDivergence: ComparisonDivergence | null = null;
        const resolve = (result: ComparisonTally, chosenIndex: number): ComparisonTally =>
          addTally(result, {
            branchesResolved: 1,
            branchDeviations:
              pattern.preferredIndex !== null && chosenIndex !== pattern.preferredIndex
                ? [
                    {
                      path: path.join(" > "),
                      reason: pattern.reason,
                      preferredIndex: pattern.preferredIndex,
                      chosenIndex,
                      divergence: preferredDivergence,
                    },
                  ]
                : [],
          });
        // Alternatives are tried in preference order, but one that explains the
        // runtime without leaning on wildcards beats an earlier one that does.
        let best: RankedAlternative | null = null;
        for (const alternativeIndex of order) {
          const alternative = pattern.alternatives[alternativeIndex];
          const run = (): ComparisonTally | null =>
            this.matchList(alternative, 0, runtime, runtimeIndex, path, continuation);
          let result: ComparisonTally | null;
          if (alternativeIndex === pattern.preferredIndex) {
            const attempt = this.attempt(run);
            this.recordFurthest(attempt.failure);
            result = attempt.result;
            if (!result) preferredDivergence = attempt.failure?.divergence ?? null;
          } else {
            result = run();
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
        const iterate = (
          iterationRuntime: RuntimeFiberSnapshot[],
          start: number,
        ): ComparisonTally | null => {
          const more = this.matchList(
            pattern.children,
            0,
            iterationRuntime,
            start,
            path,
            (nextRuntime, nextIndex) => {
              if (nextRuntime === iterationRuntime && nextIndex === start) return null;
              const rest = iterate(nextRuntime, nextIndex);
              return rest ? addTally(rest, { repeatIterations: 1 }) : null;
            },
          );
          if (more) return more;
          return continuation(iterationRuntime, start);
        };
        return iterate(runtime, runtimeIndex);
      }
    }
  }

  // A framework wrapper is spliced out first, as the static tree rarely renders
  // one; when its children do not explain the pattern, the wrapper itself is
  // matched, which is how an application fiber sharing the name is found.
  private matchLeaf(
    pattern: PatternFiber | PatternText | PatternOpaque | PatternWildcard,
    runtime: RuntimeFiberSnapshot[],
    runtimeIndex: number,
    path: string[],
    continuation: Continuation,
  ): ComparisonTally | null {
    const actual = runtime[runtimeIndex];
    if (actual && this.isTransparentRuntimeFiber(actual)) {
      const spliced = this.matchLeaf(
        pattern,
        this.spliceTransparentFiber(runtime, runtimeIndex),
        runtimeIndex,
        path,
        continuation,
      );
      if (spliced) return addTally(spliced, { transparentFibers: 1 });
    }
    switch (pattern.kind) {
      case "fiber": {
        if (!actual || !this.headMatches(pattern, actual)) {
          this.recordFailure(path, runtime, runtimeIndex, pattern);
          return null;
        }
        const childTally = this.matchChildren(pattern, actual, [
          ...path,
          describePatternNode(pattern),
        ]);
        if (!childTally) return null;
        const rest = continuation(runtime, runtimeIndex + 1);
        return rest ? addTally(addTally(rest, childTally), { matchedFibers: 1 }) : null;
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
        const rest = continuation(runtime, runtimeIndex + 1);
        return rest ? addTally(rest, { matchedText: 1 }) : null;
      }
      case "opaque": {
        if (!actual || !this.opaqueHeadMatches(pattern, actual)) {
          this.recordFailure(path, runtime, runtimeIndex, pattern);
          return null;
        }
        const rest = continuation(runtime, runtimeIndex + 1);
        if (!rest) return null;
        const head: Partial<ComparisonTally> = {
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
          const rest = continuation(runtime, runtimeIndex + absorbed);
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
    }
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
    if (isBundlerDedupedName(pattern.name, actual.name)) return true;
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
      (name) => name === runtimeName || isBundlerDedupedName(name, runtimeName),
    );
  }

  // Searches the library's runtime subtree for the place where it rendered the
  // children the application passed in. Libraries may render siblings around the
  // slot, so the passed children only need to appear as a contiguous run. When
  // no candidate fits, the one that got furthest past its start explains why.
  private matchSlot(
    pattern: PatternOpaque,
    actual: RuntimeFiberSnapshot,
    path: string[],
  ): SlotSearchResult {
    const queue: SlotSearchFrame[] = [{ fiber: actual, depth: 0 }];
    let best: FurthestSlotDivergence | null = null;
    for (let queueIndex = 0; queueIndex < queue.length; queueIndex++) {
      const { fiber, depth } = queue[queueIndex];
      for (let start = 0; start < fiber.children.length; start++) {
        const { result, failure } = this.attempt(() =>
          this.matchSlotAt(pattern, fiber.children, start, path),
        );
        if (result) return { match: result, divergence: null };
        const startPosition = this.positions.start.get(fiber.children[start]) ?? 0;
        if (failure && (!best || failure.position - startPosition > best.progress)) {
          best = { progress: failure.position - startPosition, divergence: failure.divergence };
        }
      }
      if (depth < MAX_SLOT_SEARCH_DEPTH) {
        for (const child of fiber.children) {
          queue.push({
            fiber: child,
            depth: this.isTransparentRuntimeFiber(child) ? depth : depth + 1,
          });
        }
      }
    }
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
    let consumedFibers = 0;
    const startPosition = this.positionAt(siblings, start);
    const tally = this.matchList(
      pattern.passedChildren,
      0,
      siblings,
      start,
      path,
      (nextSiblings, nextIndex) => {
        consumedFibers = this.positionAt(nextSiblings, nextIndex) - startPosition;
        return consumedFibers === 0 && siblings.length > 0 ? null : EMPTY_TALLY;
      },
    );
    return tally ? { tally, consumedFibers } : null;
  }

  private matchChildren(
    pattern: PatternFiber,
    actual: RuntimeFiberSnapshot,
    path: string[],
  ): ComparisonTally | null {
    return this.matchList(pattern.children, 0, actual.children, 0, path, (runtime, nextIndex) =>
      this.matchEnd(runtime, nextIndex, path),
    );
  }

  /** The pattern is exhausted: only framework wrappers with nothing left inside may remain. */
  matchEnd(
    runtime: RuntimeFiberSnapshot[],
    runtimeIndex: number,
    path: string[],
  ): ComparisonTally | null {
    if (runtimeIndex === runtime.length) return EMPTY_TALLY;
    if (this.isTransparentRuntimeFiber(runtime[runtimeIndex])) {
      const rest = this.matchEnd(
        this.spliceTransparentFiber(runtime, runtimeIndex),
        runtimeIndex,
        path,
      );
      if (rest) return addTally(rest, { transparentFibers: 1 });
    }
    this.recordFailure(path, runtime, runtimeIndex, null);
    return null;
  }
}

const classify = (tally: ComparisonTally): ComparisonStatus =>
  tally.opaqueSubtrees === 0 &&
  tally.wildcardAbsorbedFibers === 0 &&
  tally.branchesResolved === 0 &&
  tally.repeatIterations === 0
    ? "exact"
    : "partial";

export const comparePatternToRuntime = (
  patterns: PatternNode[],
  runtime: RuntimeFiberSnapshot[],
  options: ComparisonOptions = {},
): ComparisonReport => {
  const matcher = new Matcher(options);
  matcher.indexRuntime(runtime);
  const runtimeFibers = runtime.reduce((sum, fiber) => sum + countSnapshotFibers(fiber), 0);
  const staticFibers = patterns.reduce((sum, node) => sum + countPatternFibers(node), 0);
  let tally: ComparisonTally | null = null;
  let budgetExhausted = false;
  try {
    tally = matcher.matchList(patterns, 0, runtime, 0, ["root"], (rest, nextIndex) =>
      matcher.matchEnd(rest, nextIndex, ["root"]),
    );
  } catch (error) {
    if (!(error instanceof BudgetExceeded)) throw error;
    budgetExhausted = true;
  }
  const base = tally ?? EMPTY_TALLY;
  const applicationFibers = runtimeFibers - base.transparentFibers;
  const denominator = Math.max(
    1,
    applicationFibers - base.opaqueSkippedFibers - base.wildcardAbsorbedFibers,
  );
  return {
    ...base,
    status: tally ? classify(tally) : "mismatch",
    runtimeFibers: applicationFibers,
    staticFibers,
    coverage: tally ? (base.matchedFibers + base.matchedText) / denominator : 0,
    strictCoverage: tally
      ? (base.matchedFibers + base.matchedText) / Math.max(1, applicationFibers)
      : 0,
    divergence: tally ? null : matcher.divergence,
    stepsUsed: matcher.stepsUsed,
    budgetExhausted,
  };
};
