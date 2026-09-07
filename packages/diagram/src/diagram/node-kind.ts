import type { TreeNode } from "./tree-model";

export const getIsCallableNode = (node: Pick<TreeNode, "kind" | "isCallable">) =>
  node.isCallable ?? (node.kind === "hook" || node.kind === "callback");
