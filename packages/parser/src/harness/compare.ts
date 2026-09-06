import { countSnapshotFibers, type RuntimeFiberSnapshot } from "./snapshot.js";
import {
  countPatternFibers,
  type PatternFiber,
  type PatternNode,
  type PatternOpaque,
} from "./static-pattern.js";

export type ComparisonStatus = "exact" | "partial" | "mismatch" | "unresolved" | "skipped";

// esbuild lowers `class X { static … }` to `var _a; _a = class {…}`, so pre-bundled
// library components can surface as `_a`, `_a2`, … with no identity to compare.
const BUNDLER_PLACEHOLDER_NAME = /^_[a-z]\d*$/;

const isBundlerPlaceholderName = (name: string): boolean => BUNDLER_PLACEHOLDER_NAME.test(name);

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

export interface ComparisonTally {
  matchedFibers: number;
  matchedText: number;
  opaqueSubtrees: number;
  opaqueSkippedFibers: number;
  /** Opaque subtrees whose passed children were located and matched inside the library's runtime output. */
  slotsMatched: number;
  /** Opaque subtrees whose passed children could not be located; the whole subtree was skipped. */
  slotsUnmatched: number;
  wildcardAbsorbedFibers: number;
  wildcards: WildcardAbsorption[];
  branchesResolved: number;
  repeatIterations: number;
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
  wildcardAbsorbedFibers: 0,
  wildcards: [],
  branchesResolved: 0,
  repeatIterations: 0,
};

const addTally = (left: ComparisonTally, right: Partial<ComparisonTally>): ComparisonTally => ({
  matchedFibers: left.matchedFibers + (right.matchedFibers ?? 0),
  matchedText: left.matchedText + (right.matchedText ?? 0),
  opaqueSubtrees: left.opaqueSubtrees + (right.opaqueSubtrees ?? 0),
  opaqueSkippedFibers: left.opaqueSkippedFibers + (right.opaqueSkippedFibers ?? 0),
  slotsMatched: left.slotsMatched + (right.slotsMatched ?? 0),
  slotsUnmatched: left.slotsUnmatched + (right.slotsUnmatched ?? 0),
  wildcardAbsorbedFibers: left.wildcardAbsorbedFibers + (right.wildcardAbsorbedFibers ?? 0),
  wildcards: right.wildcards ? [...right.wildcards, ...left.wildcards] : left.wildcards,
  branchesResolved: left.branchesResolved + (right.branchesResolved ?? 0),
  repeatIterations: left.repeatIterations + (right.repeatIterations ?? 0),
});

type Continuation = (runtimeIndex: number) => ComparisonTally | null;

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

const tagsCompatible = (expected: string, actual: string): boolean =>
  expected === actual || (TAG_EQUIVALENTS[expected]?.includes(actual) ?? false);

// Pre-order positions over the runtime tree; a failure is reported at the
// furthest position any alternative reached, as parsers report their
// furthest-failure, so backtracked branches do not hide the real divergence.
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
  private slotSearchDepth = 0;
  private furthest: { position: number; divergence: ComparisonDivergence } | null = null;
  private positions: RuntimePositions = { start: new Map(), end: new Map() };
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

  get divergence(): ComparisonDivergence | null {
    return this.furthest?.divergence ?? null;
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
    if (this.slotSearchDepth > 0) return;
    const actual = runtime[index];
    const position =
      (actual ? this.positions.start.get(actual) : this.positions.end.get(runtime)) ?? 0;
    if (this.furthest && this.furthest.position >= position) return;
    this.furthest = {
      position,
      divergence: {
        path: `${path.join(" > ")}[${index}]`,
        expected: expected ? describePatternNode(expected) : "<end of children>",
        actual: describeRuntimeFiber(actual),
      },
    };
  }

  private tick(): void {
    this.steps++;
    if (this.steps > this.maxSteps) throw new BudgetExceeded();
  }

  matchList(
    patterns: PatternNode[],
    index: number,
    runtime: RuntimeFiberSnapshot[],
    runtimeIndex: number,
    path: string[],
    continuation: Continuation,
  ): ComparisonTally | null {
    if (index === patterns.length) return continuation(runtimeIndex);
    return this.matchNode(patterns[index], runtime, runtimeIndex, path, (nextIndex) =>
      this.matchList(patterns, index + 1, runtime, nextIndex, path, continuation),
    );
  }

  private matchNode(
    pattern: PatternNode,
    runtime: RuntimeFiberSnapshot[],
    runtimeIndex: number,
    path: string[],
    continuation: Continuation,
  ): ComparisonTally | null {
    this.tick();
    const actual = runtime[runtimeIndex];
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
        const rest = continuation(runtimeIndex + 1);
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
        const rest = continuation(runtimeIndex + 1);
        return rest ? addTally(rest, { matchedText: 1 }) : null;
      }
      case "opaque": {
        if (actual && this.opaqueHeadMatches(pattern, actual)) {
          const rest = continuation(runtimeIndex + 1);
          if (rest) {
            const slot =
              pattern.passedChildren.length > 0
                ? this.matchSlot(pattern, actual, [...path, describePatternNode(pattern)])
                : null;
            if (slot) {
              return addTally(addTally(rest, slot.tally), {
                opaqueSubtrees: 1,
                slotsMatched: 1,
                opaqueSkippedFibers: countSnapshotFibers(actual) - slot.consumedFibers,
              });
            }
            return addTally(rest, {
              opaqueSubtrees: 1,
              slotsUnmatched: pattern.passedChildren.length > 0 ? 1 : 0,
              opaqueSkippedFibers: countSnapshotFibers(actual),
            });
          }
        }
        const skipped = continuation(runtimeIndex);
        if (skipped) return addTally(skipped, { opaqueSubtrees: 1 });
        this.recordFailure(path, runtime, runtimeIndex, pattern);
        return null;
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
        const order = pattern.alternatives.map((_, alternativeIndex) => alternativeIndex);
        if (pattern.preferredIndex !== null && pattern.preferredIndex < order.length) {
          order.splice(order.indexOf(pattern.preferredIndex), 1);
          order.unshift(pattern.preferredIndex);
        }
        for (const alternativeIndex of order) {
          const result = this.matchList(
            pattern.alternatives[alternativeIndex],
            0,
            runtime,
            runtimeIndex,
            path,
            continuation,
          );
          if (result) return addTally(result, { branchesResolved: 1 });
        }
        return null;
      }
      case "repeat": {
        const iterate = (start: number): ComparisonTally | null => {
          const more = this.matchList(pattern.children, 0, runtime, start, path, (nextIndex) => {
            if (nextIndex === start) return null;
            const rest = iterate(nextIndex);
            return rest ? addTally(rest, { repeatIterations: 1 }) : null;
          });
          if (more) return more;
          return continuation(start);
        };
        return iterate(runtimeIndex);
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
    if (pattern.name !== null && actual.name !== null && pattern.name !== actual.name) return false;
    return true;
  }

  private opaqueHeadMatches(pattern: PatternOpaque, actual: RuntimeFiberSnapshot): boolean {
    if (actual.tag === "HostText") return false;
    if (
      this.compareKeys &&
      pattern.key !== null &&
      actual.key !== null &&
      pattern.key !== actual.key
    )
      return false;
    if (actual.name === null || isBundlerPlaceholderName(actual.name)) return true;
    if (pattern.runtimeNames === null) return !isHostTag(actual.tag);
    return pattern.runtimeNames.includes(actual.name);
  }

  // Searches the library's runtime subtree for the place where it rendered the
  // children the application passed in. Libraries may render siblings around the
  // slot, so the passed children only need to appear as a contiguous run.
  private matchSlot(
    pattern: PatternOpaque,
    actual: RuntimeFiberSnapshot,
    path: string[],
  ): { tally: ComparisonTally; consumedFibers: number } | null {
    const queue: { fiber: RuntimeFiberSnapshot; depth: number }[] = [{ fiber: actual, depth: 0 }];
    this.slotSearchDepth++;
    try {
      return this.searchSlot(pattern, queue, path);
    } finally {
      this.slotSearchDepth--;
    }
  }

  private searchSlot(
    pattern: PatternOpaque,
    queue: { fiber: RuntimeFiberSnapshot; depth: number }[],
    path: string[],
  ): { tally: ComparisonTally; consumedFibers: number } | null {
    for (let queueIndex = 0; queueIndex < queue.length; queueIndex++) {
      const { fiber, depth } = queue[queueIndex];
      for (let start = 0; start < fiber.children.length; start++) {
        let consumedFibers = 0;
        const tally = this.matchList(
          pattern.passedChildren,
          0,
          fiber.children,
          start,
          path,
          (nextIndex) => {
            if (nextIndex === start) return null;
            for (let index = start; index < nextIndex; index++) {
              consumedFibers += countSnapshotFibers(fiber.children[index]);
            }
            return EMPTY_TALLY;
          },
        );
        if (tally) return { tally, consumedFibers };
      }
      if (depth < MAX_SLOT_SEARCH_DEPTH) {
        for (const child of fiber.children) queue.push({ fiber: child, depth: depth + 1 });
      }
    }
    return null;
  }

  private matchChildren(
    pattern: PatternFiber,
    actual: RuntimeFiberSnapshot,
    path: string[],
  ): ComparisonTally | null {
    return this.matchList(pattern.children, 0, actual.children, 0, path, (nextIndex) => {
      if (nextIndex === actual.children.length) return EMPTY_TALLY;
      this.recordFailure(path, actual.children, nextIndex, null);
      return null;
    });
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
    tally = matcher.matchList(patterns, 0, runtime, 0, ["root"], (nextIndex) => {
      if (nextIndex === runtime.length) return EMPTY_TALLY;
      matcher.recordFailure(["root"], runtime, nextIndex, null);
      return null;
    });
  } catch (error) {
    if (!(error instanceof BudgetExceeded)) throw error;
    budgetExhausted = true;
  }
  const base = tally ?? EMPTY_TALLY;
  const denominator = Math.max(
    1,
    runtimeFibers - base.opaqueSkippedFibers - base.wildcardAbsorbedFibers,
  );
  return {
    ...base,
    status: tally ? classify(tally) : "mismatch",
    runtimeFibers,
    staticFibers,
    coverage: tally ? (base.matchedFibers + base.matchedText) / denominator : 0,
    strictCoverage: tally
      ? (base.matchedFibers + base.matchedText) / Math.max(1, runtimeFibers)
      : 0,
    divergence: tally ? null : matcher.divergence,
    stepsUsed: matcher.stepsUsed,
    budgetExhausted,
  };
};
