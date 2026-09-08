import type { TreeNode, TreeRow } from "./tree-model";

export interface CatchRange {
  start: number;
  end: number;
}

export interface TreeHighlightIndex {
  nodeById: ReadonlyMap<string, TreeNode>;
  ownedIds: ReadonlyMap<string, readonly string[]>;
  catchRanges: ReadonlyMap<string, readonly CatchRange[]>;
}

export interface TreeHighlight {
  mode: "none" | "node" | "owner" | "boundary" | "flow";
  highlightedIds: ReadonlySet<string> | null;
  catchRanges: readonly CatchRange[];
}

export const getTreeHighlightIndex = (rows: readonly TreeRow[]): TreeHighlightIndex => {
  const nodeById = new Map<string, TreeNode>();
  const ownedIds = new Map<string, string[]>();
  const catcherIds: (string | undefined)[] = [];
  const catchRanges = new Map<string, CatchRange[]>();
  for (const [index, row] of rows.entries()) {
    nodeById.set(row.node.id, row.node);
    if (row.node.ownerId !== undefined) {
      const owned = ownedIds.get(row.node.ownerId) ?? [];
      owned.push(row.node.id);
      ownedIds.set(row.node.ownerId, owned);
    }
    const parent = rows[row.parentIndex];
    const catcherId =
      parent?.node.kind === "boundary" ? parent.node.id : catcherIds[row.parentIndex];
    catcherIds.push(catcherId);
    if (catcherId === undefined) continue;
    const ranges = catchRanges.get(catcherId) ?? [];
    const lastRange = ranges[ranges.length - 1];
    if (lastRange?.end === index) lastRange.end = index + 1;
    else ranges.push({ start: index, end: index + 1 });
    catchRanges.set(catcherId, ranges);
  }
  return { nodeById, ownedIds, catchRanges };
};

export const getTreeHighlight = (
  index: TreeHighlightIndex,
  activeId: string | null,
  relationship: "parent" | "owner" = "parent",
): TreeHighlight => {
  if (activeId === null) return { mode: "none", highlightedIds: null, catchRanges: [] };
  if (index.nodeById.get(activeId)?.kind === "boundary") {
    return {
      mode: "boundary",
      highlightedIds: null,
      catchRanges: index.catchRanges.get(activeId) ?? [],
    };
  }
  if (index.nodeById.get(activeId)?.kind === "provider") {
    const highlightedIds = new Set([activeId]);
    for (const node of index.nodeById.values())
      if (node.contextProviderIds?.includes(activeId)) highlightedIds.add(node.id);
    return { mode: "node", highlightedIds, catchRanges: [] };
  }
  const ownedIds = index.ownedIds.get(activeId);
  if (!ownedIds?.length)
    return { mode: "node", highlightedIds: new Set([activeId]), catchRanges: [] };
  const highlightedIds = new Set([activeId, ...ownedIds]);
  if (relationship === "owner") {
    for (const nodeId of highlightedIds) {
      for (const childId of index.ownedIds.get(nodeId) ?? []) highlightedIds.add(childId);
    }
  }
  return { mode: "owner", highlightedIds, catchRanges: [] };
};

export const getOwnerNodes = (nodes: readonly TreeNode[]): TreeNode[] =>
  nodes.map((node) => ({ ...node, parentId: node.ownerId }));
