import type { StaticRenderResult } from "../types.js";
import type { ComparisonOptions, ComparisonReport } from "./compare.js";
import { formatComparisonReport } from "./format-report.js";
import { findSnapshotFiber, type RuntimeFiberSnapshot, type RuntimeSnapshot } from "./snapshot.js";
import {
  DEFAULT_STATE_SPACE_BUDGET,
  enumerateStateSpace,
  matchStateSpace,
  summarizeOmissions,
  type ClosestState,
  type MatchedState,
  type StateSpaceBudget,
  type StateSpaceSummary,
  type StaticStateSpace,
} from "./state-space.js";
import {
  flattenPatternFibers,
  snapshotToPattern,
  type PatternFiber,
  type PatternNode,
} from "./static-pattern.js";

export interface StaticStateSpaceOptions {
  anchor?: string;
  /** Static fibers to splice out before matching (framework wrappers synthesized by a route adapter). */
  transparentStaticFibers?: ReadonlySet<string>;
  budget?: Partial<StateSpaceBudget>;
}

export interface CompareRenderOptions extends ComparisonOptions {
  rootIndex?: number;
}

export interface StaticRenderStateSpace extends StaticStateSpace {
  /** The final commit's pattern after anchoring and flattening; what the states were expanded from last. */
  staticPattern: PatternNode[];
  anchor: string | null;
  /** Why no state could be enumerated; `states` is empty then. */
  unresolved: string | null;
}

export interface CompareRenderResult {
  report: ComparisonReport;
  stateSpace: StaticRenderStateSpace;
  matchedState: MatchedState | null;
  closestState: ClosestState | null;
  runtimeSubtree: RuntimeFiberSnapshot[];
  note: string | null;
}

const findPatternFiber = (
  nodes: PatternNode[],
  predicate: (fiber: PatternFiber) => boolean,
): PatternFiber | null => {
  for (const node of nodes) {
    switch (node.kind) {
      case "fiber": {
        if (predicate(node)) return node;
        const inner = findPatternFiber(node.children, predicate);
        if (inner) return inner;
        break;
      }
      case "branch": {
        for (const alternative of node.alternatives) {
          const inner = findPatternFiber(alternative, predicate);
          if (inner) return inner;
        }
        break;
      }
      case "repeat": {
        const inner = findPatternFiber(node.children, predicate);
        if (inner) return inner;
        break;
      }
      case "opaque": {
        const inner = findPatternFiber(node.passedChildren, predicate);
        if (inner) return inner;
        break;
      }
      default:
        break;
    }
  }
  return null;
};

const isStaticRootUnresolved = (pattern: PatternNode[]): boolean =>
  pattern.length === 1 && pattern[0].kind === "wildcard";

const didMaterializedRenderFail = (staticResult: StaticRenderResult): boolean =>
  staticResult.snapshot.roots.every((root) => root.children.length === 0) &&
  staticResult.diagnostics.some((diagnostic) => diagnostic.code === "render-error");

const unresolvedStateSpace = (
  staticPattern: PatternNode[],
  budget: StateSpaceBudget,
  unresolved: string,
): StaticRenderStateSpace => ({
  states: [],
  budget,
  omitted: null,
  commits: [],
  staticPattern,
  anchor: null,
  unresolved,
});

/**
 * Enumerates the concrete trees the static render can produce: every commit
 * React made while the materialized tree settled, expanded over every
 * assignment of its branch and repeat decisions within the budget.
 */
export const enumerateStaticStates = (
  staticResult: StaticRenderResult,
  options: StaticStateSpaceOptions = {},
): StaticRenderStateSpace => {
  const budget = { ...DEFAULT_STATE_SPACE_BUDGET, ...options.budget };
  const transparent = options.transparentStaticFibers ?? new Set<string>();
  const anchor = options.anchor ?? null;
  const rootIndex = chooseRootIndex(staticResult.snapshot, anchor);
  const rootPattern = snapshotToPattern(staticResult.snapshot.roots[rootIndex]?.children ?? []);
  const staticChildren = flattenPatternFibers(rootPattern, transparent);
  if (isStaticRootUnresolved(rootPattern)) {
    return unresolvedStateSpace(
      staticChildren,
      budget,
      "static render did not resolve to a component tree",
    );
  }
  if (didMaterializedRenderFail(staticResult)) {
    return unresolvedStateSpace(
      staticChildren,
      budget,
      "React failed to render the materialized tree",
    );
  }
  const commits = (staticResult.commits.length > 0 ? staticResult.commits : [staticResult.snapshot])
    .flatMap((commit) => {
      const root = commit.roots[rootIndex];
      return root ? [flattenPatternFibers(snapshotToPattern(root.children), transparent)] : [];
    })
    .filter((pattern) => pattern.length > 0);
  const anchoredCommits =
    anchor === null
      ? commits
      : commits.flatMap((pattern) => {
          const staticAnchor = findPatternFiber(pattern, (fiber) => fiber.name === anchor);
          return staticAnchor ? [[staticAnchor]] : [];
        });
  if (anchoredCommits.length === 0) {
    return unresolvedStateSpace(
      staticChildren,
      budget,
      anchor === null
        ? "static render committed no fibers"
        : `anchor <${anchor}> not found in static tree`,
    );
  }
  return {
    ...enumerateStateSpace(anchoredCommits, budget),
    staticPattern: anchoredCommits[anchoredCommits.length - 1],
    anchor,
    unresolved: null,
  };
};

const skipped = (
  stateSpace: StaticRenderStateSpace,
  note: string,
  status: "unresolved" | "skipped",
): CompareRenderResult => ({
  report: {
    status,
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
    transparentFibers: 0,
    runtimeFibers: 0,
    staticFibers: 0,
    coverage: 0,
    strictCoverage: 0,
    divergence: null,
    stepsUsed: 0,
    budgetExhausted: false,
  },
  stateSpace,
  matchedState: null,
  closestState: null,
  runtimeSubtree: [],
  note,
});

const countFibers = (fibers: RuntimeFiberSnapshot[]): number => {
  let count = 0;
  for (const fiber of fibers) count += 1 + countFibers(fiber.children);
  return count;
};

/**
 * Pages mount more than one React root (dev overlays, portals rendered with a
 * second `createRoot`), and so does the static render of an entry that opens
 * several. Prefer the root that holds the anchor, otherwise the largest one;
 * -1 when there is none.
 */
const chooseRootIndex = (snapshot: RuntimeSnapshot, anchor: string | null): number => {
  if (anchor) {
    const anchored = snapshot.roots.findIndex(
      (root) =>
        findSnapshotFiber(root, (fiber) => fiber.name === anchor && fiber.tag !== "HostText") !==
        null,
    );
    if (anchored !== -1) return anchored;
  }
  let largest = -1;
  let largestSize = -1;
  for (const [index, root] of snapshot.roots.entries()) {
    const size = countFibers(root.children);
    if (size > largestSize) {
      largest = index;
      largestSize = size;
    }
  }
  return largest;
};

const chooseRuntimeRoot = (
  runtime: RuntimeSnapshot,
  anchor: string | null,
  options: CompareRenderOptions,
): RuntimeFiberSnapshot | null =>
  runtime.roots[options.rootIndex ?? chooseRootIndex(runtime, anchor)] ?? null;

/** Checks the runtime tree for membership in the enumerated state space. */
export const compareStaticToRuntime = (
  stateSpace: StaticRenderStateSpace,
  runtime: RuntimeSnapshot,
  options: CompareRenderOptions = {},
): CompareRenderResult => {
  if (stateSpace.unresolved !== null)
    return skipped(stateSpace, stateSpace.unresolved, "unresolved");
  const runtimeRoot = chooseRuntimeRoot(runtime, stateSpace.anchor, options);
  if (!runtimeRoot)
    return skipped(stateSpace, "runtime snapshot has no committed roots", "skipped");

  let runtimeSubtree = runtimeRoot.children;
  if (stateSpace.anchor !== null) {
    const anchor = stateSpace.anchor;
    const runtimeAnchor = findSnapshotFiber(
      runtimeRoot,
      (fiber) => fiber.name === anchor && fiber.tag !== "HostText",
    );
    if (!runtimeAnchor)
      return skipped(stateSpace, `anchor <${anchor}> not found in runtime tree`, "skipped");
    runtimeSubtree = [runtimeAnchor];
  }
  const match = matchStateSpace(stateSpace, runtimeSubtree, options);
  return {
    report: match.report,
    stateSpace,
    matchedState: match.matched,
    closestState: match.closest,
    runtimeSubtree,
    note: null,
  };
};

export const summarizeStateSpace = (comparison: CompareRenderResult): StateSpaceSummary => ({
  states: comparison.stateSpace.states.length,
  matchedState: comparison.matchedState,
  closestState: comparison.closestState,
  omitted: summarizeOmissions(comparison.stateSpace.omitted),
});

export const formatCompareRenderResult = (comparison: CompareRenderResult): string =>
  formatComparisonReport(
    comparison.report,
    summarizeStateSpace(comparison),
    comparison.stateSpace.states,
  );
