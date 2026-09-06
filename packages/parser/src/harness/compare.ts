import type { SourceLocation } from "../types.js";
import { countSnapshotFibers, type RuntimeFiberSnapshot } from "./snapshot.js";
import {
  countPatternFibers,
  type PatternFiber,
  type PatternNode,
  type PatternOpaque,
} from "./static-pattern.js";

export type ComparisonStatus = "exact" | "partial" | "mismatch" | "unresolved" | "skipped";

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
  location: SourceLocation | null;
}

export interface ComparisonTally {
  matchedFibers: number;
  matchedText: number;
  opaqueSubtrees: number;
  opaqueSkippedFibers: number;
  wildcardAbsorbedFibers: number;
  branchesResolved: number;
  repeatIterations: number;
}

export interface ComparisonReport extends ComparisonTally {
  status: ComparisonStatus;
  runtimeFibers: number;
  staticFibers: number;
  coverage: number;
  divergence: ComparisonDivergence | null;
  stepsUsed: number;
  budgetExhausted: boolean;
}

const DEFAULT_MAX_STEPS = 200_000;

const EMPTY_TALLY: ComparisonTally = {
  matchedFibers: 0,
  matchedText: 0,
  opaqueSubtrees: 0,
  opaqueSkippedFibers: 0,
  wildcardAbsorbedFibers: 0,
  branchesResolved: 0,
  repeatIterations: 0,
};

const addTally = (left: ComparisonTally, right: Partial<ComparisonTally>): ComparisonTally => ({
  matchedFibers: left.matchedFibers + (right.matchedFibers ?? 0),
  matchedText: left.matchedText + (right.matchedText ?? 0),
  opaqueSubtrees: left.opaqueSubtrees + (right.opaqueSubtrees ?? 0),
  opaqueSkippedFibers: left.opaqueSkippedFibers + (right.opaqueSkippedFibers ?? 0),
  wildcardAbsorbedFibers: left.wildcardAbsorbedFibers + (right.wildcardAbsorbedFibers ?? 0),
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

const tagsCompatible = (expected: string, actual: string): boolean =>
  expected === actual || (TAG_EQUIVALENTS[expected]?.includes(actual) ?? false);

class Matcher {
  private steps = 0;
  private furthest: { depth: number; index: number; divergence: ComparisonDivergence } | null =
    null;
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

  private recordFailure(
    path: string[],
    index: number,
    expected: PatternNode | null,
    actual: RuntimeFiberSnapshot | undefined,
  ): void {
    const depth = path.length;
    if (
      this.furthest &&
      (this.furthest.depth > depth ||
        (this.furthest.depth === depth && this.furthest.index >= index))
    ) {
      return;
    }
    this.furthest = {
      depth,
      index,
      divergence: {
        path: `${path.join(" > ")}[${index}]`,
        expected: expected ? describePatternNode(expected) : "<end of children>",
        actual: describeRuntimeFiber(actual),
        location: expected?.location ?? null,
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
          this.recordFailure(path, runtimeIndex, pattern, actual);
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
          this.recordFailure(path, runtimeIndex, pattern, actual);
          return null;
        }
        const rest = continuation(runtimeIndex + 1);
        return rest ? addTally(rest, { matchedText: 1 }) : null;
      }
      case "opaque": {
        if (actual && this.opaqueHeadMatches(pattern, actual)) {
          const rest = continuation(runtimeIndex + 1);
          if (rest)
            return addTally(rest, {
              opaqueSubtrees: 1,
              opaqueSkippedFibers: countSnapshotFibers(actual),
            });
        }
        const skipped = continuation(runtimeIndex);
        if (skipped) return addTally(skipped, { opaqueSubtrees: 1 });
        this.recordFailure(path, runtimeIndex, pattern, actual);
        return null;
      }
      case "wildcard": {
        for (let absorbed = 0; runtimeIndex + absorbed <= runtime.length; absorbed++) {
          const rest = continuation(runtimeIndex + absorbed);
          if (rest) {
            let absorbedFibers = 0;
            for (let offset = 0; offset < absorbed; offset++)
              absorbedFibers += countSnapshotFibers(runtime[runtimeIndex + offset]);
            return addTally(rest, { wildcardAbsorbedFibers: absorbedFibers });
          }
        }
        this.recordFailure(path, runtimeIndex, pattern, actual);
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
    return actual.name === null || actual.name === pattern.name;
  }

  private matchChildren(
    pattern: PatternFiber,
    actual: RuntimeFiberSnapshot,
    path: string[],
  ): ComparisonTally | null {
    return this.matchList(pattern.children, 0, actual.children, 0, path, (nextIndex) => {
      if (nextIndex === actual.children.length) return EMPTY_TALLY;
      this.recordFailure(path, nextIndex, null, actual.children[nextIndex]);
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
  const runtimeFibers = runtime.reduce((sum, fiber) => sum + countSnapshotFibers(fiber), 0);
  const staticFibers = patterns.reduce((sum, node) => sum + countPatternFibers(node), 0);
  let tally: ComparisonTally | null = null;
  let budgetExhausted = false;
  try {
    tally = matcher.matchList(patterns, 0, runtime, 0, ["root"], (nextIndex) =>
      nextIndex === runtime.length ? EMPTY_TALLY : null,
    );
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
    divergence: tally ? null : matcher.divergence,
    stepsUsed: matcher.stepsUsed,
    budgetExhausted,
  };
};
