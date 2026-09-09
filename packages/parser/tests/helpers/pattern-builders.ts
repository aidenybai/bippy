import type {
  PatternBranch,
  PatternFiber,
  PatternNode,
  PatternRepeat,
} from "../../src/harness/static-pattern.js";
import {
  predicateGuards,
  type Guard,
  type InputVariable,
} from "../../src/harness/symbolic-tree.js";

export const patternHost = (name: string, children: PatternNode[] = []): PatternFiber => ({
  kind: "fiber",
  tag: "HostComponent",
  name,
  key: null,
  children,
});

export const input = (id: string, source: InputVariable["source"] = "unknown"): InputVariable => ({
  id,
  label: id,
  source,
  location: null,
});

/** A branch deciding on the anonymous input `variable`, as the reader builds for a marker without a predicate. */
export const choiceBranch = (variable: string, ...alternatives: PatternNode[][]): PatternBranch => {
  const inputVariable = input(variable);
  return {
    kind: "branch",
    variable,
    reason: variable,
    location: null,
    preferredIndex: 0,
    guards: predicateGuards(
      {
        formula: null,
        choice: { input: variable, path: [], measure: "choice" },
        inputs: [inputVariable],
      },
      alternatives.length,
    ),
    inputs: [inputVariable],
    alternatives,
  };
};

/** A two-way branch taking the first alternative when `guard` holds. */
export const guardedBranch = (
  variable: string,
  guard: Guard,
  inputs: InputVariable[],
  whenTrue: PatternNode[],
  whenFalse: PatternNode[],
): PatternBranch => ({
  kind: "branch",
  variable,
  reason: variable,
  location: null,
  preferredIndex: 0,
  guards: predicateGuards({ formula: guard, choice: null, inputs }, 2),
  inputs,
  alternatives: [whenTrue, whenFalse],
});

const collectInputIds = (nodes: PatternNode[], ids: Set<string>): void => {
  for (const node of nodes) {
    switch (node.kind) {
      case "fiber":
        collectInputIds(node.children, ids);
        break;
      case "opaque":
        collectInputIds(node.passedChildren, ids);
        break;
      case "branch":
        for (const inputVariable of node.inputs) ids.add(inputVariable.id);
        for (const alternative of node.alternatives) collectInputIds(alternative, ids);
        break;
      case "repeat":
        for (const inputVariable of node.inputs) ids.add(inputVariable.id);
        collectInputIds(node.children, ids);
        break;
      case "text":
      case "wildcard":
        break;
    }
  }
};

/** A repeat over the anonymous list `variable`; every input its body decides on is its own. */
export const anonymousRepeat = (
  variable: string,
  children: PatternNode[],
  count: PatternRepeat["count"] = { min: 0, max: null },
): PatternRepeat => {
  const scoped = new Set<string>();
  collectInputIds(children, scoped);
  return {
    kind: "repeat",
    variable,
    location: null,
    cardinality: { input: variable, path: [], measure: "length" },
    inputs: [input(variable)],
    scopedInputs: [...scoped],
    count,
    children,
  };
};
