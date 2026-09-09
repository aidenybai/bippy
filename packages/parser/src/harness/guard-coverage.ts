import { z } from "zod";
import { areGuardsSatisfiable } from "./guard-solver.js";
import type { StateCondition } from "./state-space.js";
import { scopeRepeatIteration, type PatternNode, type PatternRepeat } from "./static-pattern.js";
import {
  COMMIT_INPUT,
  compareGuard,
  equalsGuard,
  formatGuard,
  type Guard,
  type SymbolicTree,
} from "./symbolic-tree.js";

// Guard coverage is the symbolic counterpart of fiber coverage: not how many
// fibers a capture matched, but which side of every guard some capture took.
// A side nobody took is either still possible or ruled out by the guards above
// it, and both are reported rather than folded into a single number.

export type GuardSideStatus = "witnessed" | "possible" | "unreachable";

export interface GuardSide {
  key: string;
  kind: "branch" | "repeat" | "commit";
  variable: string;
  reason: string;
  location: string | null;
  /** The alternative index of a branch, the commit index, or 0 (fewest iterations) / 1 (more) for a repeat. */
  side: number;
  guard: Guard;
  /** Guards of the decisions this side lies under; the side is reachable only together with them. */
  pathGuards: Guard[];
}

export interface GuardSideCoverage {
  kind: "branch" | "repeat" | "commit";
  variable: string;
  reason: string;
  location: string | null;
  side: number;
  guard: string;
  status: GuardSideStatus;
}

export interface GuardCoverage {
  sides: GuardSideCoverage[];
  witnessed: number;
  possible: number;
  unreachable: number;
}

export const guardCoverageSchema: z.ZodType<GuardCoverage> = z.object({
  sides: z.array(
    z.object({
      kind: z.enum(["branch", "repeat", "commit"]),
      variable: z.string(),
      reason: z.string(),
      location: z.string().nullable(),
      side: z.number(),
      guard: z.string(),
      status: z.enum(["witnessed", "possible", "unreachable"]),
    }),
  ),
  witnessed: z.number(),
  possible: z.number(),
  unreachable: z.number(),
});

const sideKey = (variable: string, side: number): string => `${variable}|${side}`;

const REPEAT_FEWEST = 0;
const REPEAT_MORE = 1;

const repeatSides = (node: PatternRepeat): Array<[number, Guard]> => {
  const { min, max } = node.count;
  const sides: Array<[number, Guard]> = [[REPEAT_FEWEST, equalsGuard(node.cardinality, min)]];
  if (max === null || max > min)
    sides.push([REPEAT_MORE, compareGuard(node.cardinality, ">", min)]);
  return sides;
};

const collectSides = (
  nodes: PatternNode[],
  pathGuards: Guard[],
  sides: Map<string, GuardSide>,
): void => {
  for (const node of nodes) {
    switch (node.kind) {
      case "fiber":
        collectSides(node.children, pathGuards, sides);
        break;
      case "opaque":
        collectSides(node.passedChildren, pathGuards, sides);
        break;
      case "branch":
        node.alternatives.forEach((alternative, index) => {
          const guard = node.guards[index];
          const key = sideKey(node.variable, index);
          if (!sides.has(key)) {
            sides.set(key, {
              key,
              kind: "branch",
              variable: node.variable,
              reason: node.reason,
              location: node.location,
              side: index,
              guard,
              pathGuards,
            });
          }
          collectSides(alternative, [...pathGuards, guard], sides);
        });
        break;
      case "repeat":
        for (const [side, guard] of repeatSides(node)) {
          const key = sideKey(node.variable, side);
          if (!sides.has(key)) {
            sides.set(key, {
              key,
              kind: "repeat",
              variable: node.variable,
              reason: "repeated list",
              location: node.location,
              side,
              guard,
              pathGuards,
            });
          }
        }
        collectSides(node.children, [...pathGuards, compareGuard(node.cardinality, ">", 0)], sides);
        break;
      case "text":
      case "wildcard":
        break;
    }
  }
};

/** Every guard side of the tree, keyed by decision variable and side, with the guards it lies under. */
export const collectGuardSides = (tree: SymbolicTree): GuardSide[] => {
  const sides = new Map<string, GuardSide>();
  tree.commits.forEach((commit, index) => {
    if (tree.commits.length > 1) {
      const key = sideKey(COMMIT_INPUT.id, index);
      sides.set(key, {
        key,
        kind: "commit",
        variable: COMMIT_INPUT.id,
        reason: "committed render",
        location: null,
        side: index,
        guard: commit.guard,
        pathGuards: [],
      });
    }
    collectSides(commit.tree, [commit.guard], sides);
  });
  return [...sides.values()];
};

type ConditionsByVariable = ReadonlyMap<string, StateCondition>;

/**
 * Walks the tree along one capture's decisions, the unscoped tree beside the
 * iteration-scoped one so each decision maps back to the side it witnessed.
 */
const markWitnessed = (
  nodes: PatternNode[],
  scoped: PatternNode[],
  conditions: ConditionsByVariable,
  witnessed: Set<string>,
): void => {
  nodes.forEach((node, index) => {
    const scopedNode = scoped[index];
    if (scopedNode === undefined || scopedNode.kind !== node.kind) {
      throw new Error("a scoped repeat body must mirror the repeat's children");
    }
    switch (node.kind) {
      case "fiber":
        if (scopedNode.kind === "fiber") {
          markWitnessed(node.children, scopedNode.children, conditions, witnessed);
        }
        break;
      case "opaque":
        if (scopedNode.kind === "opaque") {
          markWitnessed(node.passedChildren, scopedNode.passedChildren, conditions, witnessed);
        }
        break;
      case "branch": {
        if (scopedNode.kind !== "branch") break;
        const decided = conditions.get(scopedNode.variable);
        if (decided?.kind !== "branch" && decided?.kind !== "state-update") break;
        witnessed.add(sideKey(node.variable, decided.alternativeIndex));
        markWitnessed(
          node.alternatives[decided.alternativeIndex] ?? [],
          scopedNode.alternatives[decided.alternativeIndex] ?? [],
          conditions,
          witnessed,
        );
        break;
      }
      case "repeat": {
        if (scopedNode.kind !== "repeat") break;
        const decided = conditions.get(scopedNode.variable);
        if (decided?.kind !== "repeat") break;
        witnessed.add(
          sideKey(node.variable, decided.count > node.count.min ? REPEAT_MORE : REPEAT_FEWEST),
        );
        for (let iteration = 0; iteration < decided.count; iteration++) {
          markWitnessed(
            node.children,
            scopeRepeatIteration(scopedNode, iteration),
            conditions,
            witnessed,
          );
        }
        break;
      }
      case "text":
      case "wildcard":
        break;
    }
  });
};

const witnessedSides = (tree: SymbolicTree, captures: StateCondition[][]): Set<string> => {
  const witnessed = new Set<string>();
  for (const capture of captures) {
    const transition = capture.find((condition) => condition.kind === "transition");
    const commit = transition?.kind === "transition" ? transition.commit : tree.commits.length - 1;
    if (transition?.kind === "transition") witnessed.add(sideKey(COMMIT_INPUT.id, commit));
    const conditions = new Map(
      capture.flatMap((condition): Array<[string, StateCondition]> =>
        condition.kind === "transition" ? [] : [[condition.variable, condition]],
      ),
    );
    const committed = tree.commits[commit]?.tree ?? [];
    markWitnessed(committed, committed, conditions, witnessed);
  }
  return witnessed;
};

/**
 * Classifies every guard side against the captures' decisions: `witnessed`
 * when a capture took it, `unreachable` when it contradicts the guards it lies
 * under, `possible` otherwise. Each capture is the `conditions` of a matched
 * state; a capture that did not match witnesses nothing.
 */
export const computeGuardCoverage = (
  tree: SymbolicTree,
  captures: StateCondition[][],
): GuardCoverage => {
  const witnessed = witnessedSides(tree, captures);
  const sides = collectGuardSides(tree).map((side): GuardSideCoverage => {
    const status: GuardSideStatus = witnessed.has(side.key)
      ? "witnessed"
      : areGuardsSatisfiable([...side.pathGuards, side.guard])
        ? "possible"
        : "unreachable";
    return {
      kind: side.kind,
      variable: side.variable,
      reason: side.reason,
      location: side.location,
      side: side.side,
      guard: formatGuard(side.guard),
      status,
    };
  });
  const count = (status: GuardSideStatus): number =>
    sides.filter((side) => side.status === status).length;
  return {
    sides,
    witnessed: count("witnessed"),
    possible: count("possible"),
    unreachable: count("unreachable"),
  };
};

export const formatGuardCoverage = (coverage: GuardCoverage): string =>
  `${coverage.witnessed} witnessed, ${coverage.possible} possible, ${coverage.unreachable} unreachable of ${coverage.sides.length} guard sides`;
