export interface CommitTreeNode {
  children: number[];
  id: number;
  parentId: number | null;
}

export interface CommitTree {
  nodes: Map<number, CommitTreeNode>;
  rootId: number;
}

export const createCommitTree = (rootId: number, nodes: CommitTreeNode[]): CommitTree => ({
  nodes: new Map(nodes.map((node) => [node.id, { ...node, children: [...node.children] }])),
  rootId,
});
