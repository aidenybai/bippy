import type { TreeNode } from "./tree-model";

export const getIsCallableNode = (node: Pick<TreeNode, "kind" | "isCallable" | "componentType">) =>
  node.isCallable ??
  (node.componentType === "function" || node.kind === "hook" || node.kind === "callback");
