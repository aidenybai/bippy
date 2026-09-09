import {
  flattenTransparentFibers,
  type FrameworkProfile,
} from "../frameworks/framework-profile.js";
import type { StaticRenderStateSpace } from "../harness/compare-render.js";
import { findSnapshotFiber, type RuntimeSnapshot } from "../harness/snapshot.js";
import {
  transitionCondition,
  type StateCondition,
  type StateOmission,
  type StaticState,
} from "../harness/state-space.js";
import {
  flattenPatternFibers,
  formatPattern,
  snapshotToPattern,
  type PatternNode,
} from "../harness/static-pattern.js";
import type { Decision, PinnedDecision } from "./decisions.js";
import { MAX_PATHS, type ConcolicExploration } from "./explore.js";
import { MAX_SYMBOLIC_LIST_COUNT } from "./hooks.js";

// Each distinct committed tree is one state. The trees are fully concrete, so
// `matchStateSpace` selects one by commit index rather than by branch decision;
// the decisions that produced each tree stay on the explored paths. The paths
// not run (budget) and the paths that failed are the omissions, so the
// assembled space is never mistaken for complete.

const toCondition = (decision: Decision): StateCondition => ({
  kind: "branch",
  variable: decision.key,
  reason: `${decision.kind} decision`,
  location: decision.site,
  alternativeIndex: decision.choice,
  alternativeCount: decision.alternatives,
});

const pinnedToConditions = (
  pinned: PinnedDecision[],
  known: Map<string, Decision>,
): StateCondition[] =>
  pinned.map(({ key, choice }) => {
    const decision = known.get(key);
    return {
      kind: "branch",
      variable: key,
      reason: decision ? `${decision.kind} decision` : "decision",
      location: decision?.site ?? null,
      alternativeIndex: choice,
      alternativeCount: decision?.alternatives ?? 2,
    };
  });

const patternOf = (
  snapshot: RuntimeSnapshot,
  profile: FrameworkProfile,
  anchor: string | null,
): PatternNode[] | null => {
  const flattened = flattenTransparentFibers(snapshot, profile);
  if (flattened.roots.length === 0) return null;
  let fibers = flattened.roots.flatMap((root) => root.children);
  if (anchor !== null) {
    const anchorFiber = flattened.roots
      .map((root) =>
        findSnapshotFiber(root, (fiber) => fiber.name === anchor && fiber.tag !== "HostText"),
      )
      .find((fiber) => fiber !== null);
    if (!anchorFiber) return null;
    fibers = [anchorFiber];
  }
  return flattenPatternFibers(snapshotToPattern(fibers), profile.transparentStaticFibers);
};

export interface AssembledStateSpace extends StaticRenderStateSpace {
  /** Paths whose trees were identical to an earlier path's. */
  duplicatePaths: number;
  /** Decisions of the first path that produced each state's tree. */
  stateDecisions: StateCondition[][];
}

export const assembleStateSpace = (
  exploration: ConcolicExploration,
  profile: FrameworkProfile,
  anchor: string | null,
): AssembledStateSpace => {
  const known = new Map<string, Decision>();
  for (const path of exploration.paths) {
    for (const decision of path.decisions) known.set(decision.key, decision);
  }
  const omissions: StateOmission[] = [];
  const seen = new Set<string>();
  const commits: PatternNode[][] = [];
  const stateDecisions: StateCondition[][] = [];
  let duplicatePaths = 0;
  let unresolved: string | null = null;
  for (const path of exploration.paths) {
    const tree = patternOf(path.snapshot, profile, anchor);
    if (tree === null) {
      const reason =
        path.error ??
        path.pageErrors[0] ??
        (anchor !== null
          ? `anchor <${anchor}> not found in path ${path.index}`
          : `path ${path.index} committed no root`);
      omissions.push({ kind: "subtree", reason });
      unresolved ??= reason;
      continue;
    }
    if (path.error !== null) omissions.push({ kind: "subtree", reason: path.error });
    const rendered = formatPattern(tree);
    if (seen.has(rendered)) {
      duplicatePaths++;
      continue;
    }
    seen.add(rendered);
    commits.push(tree);
    stateDecisions.push(path.decisions.map(toCondition));
  }
  const states: StaticState[] = commits.map((tree, commit) => {
    const transition = transitionCondition(commit, commits.length);
    return { tree, conditions: transition ? [transition] : [] };
  });
  for (const omitted of exploration.omitted) {
    omissions.push({ kind: "state", conditions: pinnedToConditions(omitted.pinned, known) });
  }
  return {
    states,
    budget: { maxStates: MAX_PATHS, maxRepeat: MAX_SYMBOLIC_LIST_COUNT },
    omitted: omissions.length > 0 ? { omissions } : null,
    commits,
    staticPattern: states[states.length - 1]?.tree ?? [],
    anchor,
    unresolved: states.length === 0 ? (unresolved ?? "no path committed a tree") : null,
    duplicatePaths,
    stateDecisions,
  };
};
