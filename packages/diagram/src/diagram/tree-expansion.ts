import type { TreeRow } from "./tree-model";

export interface TreeRevealRequest {
  nodeId: string;
  shouldFocus: boolean;
}

export const getCollapsedTreeIds = (rows: readonly TreeRow[]) =>
  new Set(rows.filter((row) => row.hasChildren).map((row) => row.node.id));

export const getRevealedTreeIds = (
  rows: readonly TreeRow[],
  nodeId: string,
  collapsedIds: ReadonlySet<string>,
) => {
  const next = new Set(collapsedIds);
  let index = rows.findIndex((row) => row.node.id === nodeId);
  while (index >= 0) {
    index = rows[index].parentIndex;
    if (index >= 0) next.delete(rows[index].node.id);
  }
  return next;
};
