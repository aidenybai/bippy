import type { ViewBranch, ViewComponent, ViewRegion, ViewState } from "@/model";

export interface BranchNode {
  kind: "branch";
  id: string;
  branch: ViewBranch | null;
  condition: string;
  yes: TreeNode | null;
  no: TreeNode | null;
}

export interface LeafNode {
  kind: "leaf";
  id: string;
  state: ViewState;
}

export type TreeNode = BranchNode | LeafNode;

const findBranch = (component: ViewComponent, condition: string): ViewBranch | null =>
  component.branches.find((branch) => branch.test === condition || branch.negated === condition) ??
  null;

const buildNode = (
  component: ViewComponent,
  states: ViewState[],
  depth: number,
): TreeNode | null => {
  const [first] = states;
  if (!first) return null;
  const condition = first.conditions[depth];
  if (condition === undefined) return { kind: "leaf", id: `leaf:${first.index}`, state: first };
  const branch = findBranch(component, condition);
  const positive = branch?.test ?? condition;
  const yes = states.filter((state) => state.conditions[depth] === positive);
  const no = states.filter((state) => state.conditions[depth] !== positive);
  return {
    kind: "branch",
    id: `branch:${depth}:${first.index}`,
    branch,
    condition: positive,
    yes: buildNode(component, yes, depth + 1),
    no: buildNode(component, no, depth + 1),
  };
};

export const buildDecisionTree = (component: ViewComponent, region: ViewRegion): TreeNode | null =>
  buildNode(
    component,
    region.states.flatMap((index) => component.states[index] ?? []),
    0,
  );

export const collectNodes = (node: TreeNode | null, into: TreeNode[] = []): TreeNode[] => {
  if (!node) return into;
  into.push(node);
  if (node.kind === "branch") {
    collectNodes(node.yes, into);
    collectNodes(node.no, into);
  }
  return into;
};

export interface TreeEdge {
  from: string;
  to: string;
  answer: "yes" | "no";
}

export const collectEdges = (node: TreeNode | null, into: TreeEdge[] = []): TreeEdge[] => {
  if (!node || node.kind !== "branch") return into;
  for (const answer of ["yes", "no"] as const) {
    const child = node[answer];
    if (child) {
      into.push({ from: node.id, to: child.id, answer });
      collectEdges(child, into);
    }
  }
  return into;
};
