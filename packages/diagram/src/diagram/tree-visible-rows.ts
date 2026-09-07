import { getExpandedRows, getTreeRows, type TreeRow } from "./tree-model";

export const getVisibleTreeRows = (
  model: readonly TreeRow[],
  collapsedIds: ReadonlySet<string>,
): readonly TreeRow[] => {
  if (collapsedIds.size === 0) return model;
  const originalById = new Map(model.map((row) => [row.node.id, row]));
  return getTreeRows(getExpandedRows(model, collapsedIds).map((row) => row.node)).map((row) => {
    const original = originalById.get(row.node.id);
    return original
      ? {
          ...row,
          hasChildren: original.hasChildren,
          position: original.position,
          siblingCount: original.siblingCount,
        }
      : row;
  });
};
