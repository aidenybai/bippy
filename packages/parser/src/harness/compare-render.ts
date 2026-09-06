import type { StaticFiber, StaticRenderResult } from "../types.js";
import {
  comparePatternToRuntime,
  type ComparisonOptions,
  type ComparisonReport,
} from "./compare.js";
import { findSnapshotFiber, type RuntimeFiberSnapshot, type RuntimeSnapshot } from "./snapshot.js";
import {
  flattenPatternFibers,
  toPattern,
  type PatternFiber,
  type PatternNode,
} from "./static-pattern.js";

export interface CompareRenderOptions extends ComparisonOptions {
  anchor?: string;
  rootIndex?: number;
  /** Static fibers to splice out before matching (framework wrappers synthesized by a route adapter). */
  transparentStaticFibers?: ReadonlySet<string>;
}

export interface CompareRenderResult {
  report: ComparisonReport;
  staticPattern: PatternNode[];
  runtimeSubtree: RuntimeFiberSnapshot[];
  anchor: string | null;
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
      default:
        break;
    }
  }
  return null;
};

const isStaticRootUnresolved = (root: StaticFiber): boolean => {
  if (root.kind !== "fiber") return true;
  const first = root.child;
  return first !== null && first.kind === "unknown" && first.sibling === null;
};

const skipped = (
  staticPattern: PatternNode[],
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
    wildcardAbsorbedFibers: 0,
    branchesResolved: 0,
    repeatIterations: 0,
    runtimeFibers: 0,
    staticFibers: 0,
    coverage: 0,
    strictCoverage: 0,
    divergence: null,
    stepsUsed: 0,
    budgetExhausted: false,
  },
  staticPattern,
  runtimeSubtree: [],
  anchor: null,
  note,
});

const countFibers = (fibers: RuntimeFiberSnapshot[]): number => {
  let count = 0;
  for (const fiber of fibers) count += 1 + countFibers(fiber.children);
  return count;
};

/**
 * Pages mount more than one React root (dev overlays, portals rendered with a
 * second `createRoot`). Without an explicit `rootIndex`, prefer the root that
 * holds the anchor, otherwise the largest one.
 */
const chooseRuntimeRoot = (
  runtime: RuntimeSnapshot,
  options: CompareRenderOptions,
): RuntimeFiberSnapshot | null => {
  if (options.rootIndex !== undefined) return runtime.roots[options.rootIndex] ?? null;
  const anchor = options.anchor;
  if (anchor) {
    const anchored = runtime.roots.find(
      (root) =>
        findSnapshotFiber(root, (fiber) => fiber.name === anchor && fiber.tag !== "HostText") !==
        null,
    );
    if (anchored) return anchored;
  }
  let largest: RuntimeFiberSnapshot | null = null;
  let largestSize = -1;
  for (const root of runtime.roots) {
    const size = countFibers(root.children);
    if (size > largestSize) {
      largest = root;
      largestSize = size;
    }
  }
  return largest;
};

export const compareStaticToRuntime = (
  staticResult: StaticRenderResult,
  runtime: RuntimeSnapshot,
  options: CompareRenderOptions = {},
): CompareRenderResult => {
  const rootPattern = toPattern(staticResult.root);
  const staticChildren = flattenPatternFibers(
    rootPattern.kind === "fiber" ? rootPattern.children : [rootPattern],
    options.transparentStaticFibers ?? new Set(),
  );
  if (isStaticRootUnresolved(staticResult.root)) {
    return skipped(
      staticChildren,
      "static render did not resolve to a component tree",
      "unresolved",
    );
  }
  const runtimeRoot = chooseRuntimeRoot(runtime, options);
  if (!runtimeRoot)
    return skipped(staticChildren, "runtime snapshot has no committed roots", "skipped");

  if (options.anchor) {
    const anchor = options.anchor;
    const staticAnchor = findPatternFiber(staticChildren, (fiber) => fiber.name === anchor);
    const runtimeAnchor = findSnapshotFiber(
      runtimeRoot,
      (fiber) => fiber.name === anchor && fiber.tag !== "HostText",
    );
    if (!staticAnchor)
      return skipped(staticChildren, `anchor <${anchor}> not found in static tree`, "unresolved");
    if (!runtimeAnchor)
      return skipped(staticChildren, `anchor <${anchor}> not found in runtime tree`, "skipped");
    return {
      report: comparePatternToRuntime([staticAnchor], [runtimeAnchor], options),
      staticPattern: [staticAnchor],
      runtimeSubtree: [runtimeAnchor],
      anchor,
      note: null,
    };
  }

  return {
    report: comparePatternToRuntime(staticChildren, runtimeRoot.children, options),
    staticPattern: staticChildren,
    runtimeSubtree: runtimeRoot.children,
    anchor: null,
    note: null,
  };
};
