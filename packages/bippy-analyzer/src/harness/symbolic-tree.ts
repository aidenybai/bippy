import { z } from "zod";
import { parseWithSchema } from "../errors.js";
import {
  type Guard,
  type GuardContext,
  type InputVariable,
  type SymbolicVariable,
  andGuard,
  choiceGuard,
  constantGuard,
  equalsGuard,
  isSameGuard,
} from "../symbolic/guards.js";
import {
  guardSchema,
  inputVariableSchema,
  symbolicVariableSchema,
} from "../symbolic/serialization.js";
import { workTagSchema } from "./snapshot.js";
import type { PatternBranch, PatternNode, PatternRepeat, RepeatBounds } from "./static-pattern.js";

/** One committed tree, guarded by its scheduling causes and the capture's commit selection. */
export interface SymbolicCommit {
  guard: Guard;
  tree: PatternNode[];
}

export interface SymbolicTreeStats {
  nodes: number;
  inputs: number;
  guards: number;
  branches: number;
  repeats: number;
  opaque: number;
  wildcards: number;
}

export interface SymbolicTree {
  inputs: InputVariable[];
  commits: SymbolicCommit[];
  stats: SymbolicTreeStats;
}

export const COMMIT_INPUT_ID = "commit";

export const COMMIT_VARIABLE: SymbolicVariable = {
  input: COMMIT_INPUT_ID,
  path: [],
  measure: "choice",
};

const repeatBoundsSchema: z.ZodType<RepeatBounds> = z.object({
  min: z.number(),
  max: z.number().nullable(),
});

export const patternNodeSchema: z.ZodType<PatternNode> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("fiber"),
      tag: workTagSchema,
      name: z.string().nullable(),
      key: z.string().nullable(),
      children: z.array(patternNodeSchema),
    }),
    z.object({ kind: z.literal("text"), text: z.string().nullable() }),
    z.object({
      kind: z.literal("branch"),
      variable: z.string(),
      decision: z.string(),
      sharesScope: z.boolean(),
      reason: z.string(),
      location: z.string().nullable(),
      preferredIndex: z.number().nullable(),
      guards: z.array(guardSchema),
      inputs: z.array(inputVariableSchema),
      alternatives: z.array(z.array(patternNodeSchema)),
    }),
    z.object({
      kind: z.literal("repeat"),
      variable: z.string(),
      decision: z.string(),
      location: z.string().nullable(),
      cardinality: symbolicVariableSchema,
      inputs: z.array(inputVariableSchema),
      scopedInputs: z.array(z.string()),
      count: repeatBoundsSchema,
      children: z.array(patternNodeSchema),
    }),
    z.object({
      kind: z.literal("opaque"),
      name: z.string(),
      runtimeNames: z.array(z.string()).nullable(),
      key: z.string().nullable(),
      reason: z.string(),
      passedChildren: z.array(patternNodeSchema),
    }),
    z.object({
      kind: z.literal("wildcard"),
      reason: z.string(),
      isTruncated: z.boolean(),
    }),
  ]),
);

export const symbolicTreeStatsSchema: z.ZodType<SymbolicTreeStats> = z.object({
  nodes: z.number(),
  inputs: z.number(),
  guards: z.number(),
  branches: z.number(),
  repeats: z.number(),
  opaque: z.number(),
  wildcards: z.number(),
});

export const symbolicTreeSchema: z.ZodType<SymbolicTree> = z.object({
  inputs: z.array(inputVariableSchema),
  commits: z.array(z.object({ guard: guardSchema, tree: z.array(patternNodeSchema) })),
  stats: symbolicTreeStatsSchema,
});

export const parseSymbolicTree = (serialized: string): SymbolicTree =>
  parseWithSchema(symbolicTreeSchema, JSON.parse(serialized), "symbolic tree");

const countNodes = (nodes: PatternNode[], stats: SymbolicTreeStats): void => {
  for (const node of nodes) {
    stats.nodes++;
    switch (node.kind) {
      case "fiber":
        countNodes(node.children, stats);
        break;
      case "text":
        break;
      case "branch":
        stats.branches++;
        stats.guards += node.alternatives.length;
        for (const alternative of node.alternatives) countNodes(alternative, stats);
        break;
      case "repeat":
        stats.repeats++;
        stats.guards++;
        countNodes(node.children, stats);
        break;
      case "opaque":
        stats.opaque++;
        countNodes(node.passedChildren, stats);
        break;
      case "wildcard":
        stats.wildcards++;
        break;
    }
  }
};

export const computeSymbolicStats = (
  commits: SymbolicCommit[],
  inputs: InputVariable[],
): SymbolicTreeStats => {
  const stats: SymbolicTreeStats = {
    nodes: 0,
    inputs: inputs.length,
    guards: commits.filter((commit) => !isSameGuard(commit.guard, constantGuard(true))).length,
    branches: 0,
    repeats: 0,
    opaque: 0,
    wildcards: 0,
  };
  for (const commit of commits) countNodes(commit.tree, stats);
  return stats;
};

const collectInputs = (nodes: PatternNode[], inputs: Map<string, InputVariable>): void => {
  for (const node of nodes) {
    switch (node.kind) {
      case "fiber":
        collectInputs(node.children, inputs);
        break;
      case "opaque":
        collectInputs(node.passedChildren, inputs);
        break;
      case "branch":
        for (const input of node.inputs) inputs.set(input.id, input);
        for (const alternative of node.alternatives) collectInputs(alternative, inputs);
        break;
      case "repeat":
        for (const input of node.inputs) inputs.set(input.id, input);
        collectInputs(node.children, inputs);
        break;
      case "text":
      case "wildcard":
        break;
    }
  }
};

/** The guard under which a decision node takes `choice`: the alternative's guard, or the repeat's cardinality equalling the count. */
export const decisionGuard = (node: PatternBranch | PatternRepeat, choice: number): Guard =>
  node.kind === "branch" ? node.guards[choice] : equalsGuard(node.cardinality, choice);

export const COMMIT_INPUT: InputVariable = {
  id: COMMIT_INPUT_ID,
  label: "commit",
  source: "commit",
  location: null,
};

/**
 * The symbolic tree of the committed pattern trees: the inputs every guard and
 * cardinality in them ranges over, and each commit guarded by its causes and
 * which commit the capture observed (a single commit needs no selector).
 */
export const buildSymbolicTree = (
  commits: PatternNode[][],
  causes: GuardContext[] = [],
): SymbolicTree => {
  const inputs = new Map<string, InputVariable>();
  if (commits.length > 1) inputs.set(COMMIT_INPUT.id, COMMIT_INPUT);
  const symbolicCommits = commits.map((tree, index) => {
    collectInputs(tree, inputs);
    const cause = causes[index];
    for (const input of cause?.inputs ?? []) inputs.set(input.id, input);
    return {
      guard: andGuard([
        commits.length > 1 ? choiceGuard(COMMIT_VARIABLE, index) : constantGuard(true),
        cause?.guard ?? constantGuard(true),
      ]),
      tree,
    };
  });
  const inputList = [...inputs.values()];
  return {
    inputs: inputList,
    commits: symbolicCommits,
    stats: computeSymbolicStats(symbolicCommits, inputList),
  };
};
