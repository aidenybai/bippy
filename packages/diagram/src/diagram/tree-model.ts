import { diagramMetrics } from "./geometry";

export interface TreeNode {
  id: string;
  label: string;
  parentId?: string;
  ownerId?: string;
  componentId?: string;
  contextProviderIds?: readonly string[];
  kind?:
    | "component"
    | "host"
    | "provider"
    | "boundary"
    | "special"
    | "suspense"
    | "portal"
    | "hook"
    | "value"
    | "callback"
    | "store";
  isPortalTarget?: boolean;
  isCallable?: boolean;
  componentType?: "function" | "class" | "memo" | "forward-ref";
  annotation?: string;
}

export interface TreeRow {
  node: TreeNode;
  depth: number;
  parentIndex: number;
  lastChildIndex: number;
  subtreeEnd: number;
  hasChildren: boolean;
  position: number;
  siblingCount: number;
}

interface TreeVisit {
  node: TreeNode;
  depth: number;
  parentIndex: number;
  position: number;
  siblingCount: number;
  exitIndex?: number;
}

export interface VirtualRange {
  start: number;
  end: number;
  firstVisible: number;
  lastVisible: number;
  offset: number;
  totalHeight: number;
}

export interface Indentation {
  baseDepth: number;
  size: number;
}

export const getTreeRows = (nodes: readonly TreeNode[]): TreeRow[] => {
  const nodeById = new Map<string, TreeNode>();
  const childrenById = new Map<string | undefined, TreeNode[]>();
  for (const node of nodes) {
    if (nodeById.has(node.id)) throw new Error(`Duplicate tree node: ${node.id}`);
    nodeById.set(node.id, node);
    const siblings = childrenById.get(node.parentId) ?? [];
    siblings.push(node);
    childrenById.set(node.parentId, siblings);
  }
  for (const node of nodes) {
    if (node.parentId !== undefined && !nodeById.has(node.parentId)) {
      throw new Error(`Missing parent ${node.parentId} for ${node.id}`);
    }
  }
  const roots = childrenById.get(undefined) ?? [];
  const stack: TreeVisit[] = roots
    .map((node, index) => ({
      node,
      depth: 0,
      parentIndex: -1,
      position: index + 1,
      siblingCount: roots.length,
    }))
    .reverse();
  const rows: TreeRow[] = [];
  while (stack.length > 0) {
    const visit = stack.pop();
    if (!visit) break;
    if (visit.exitIndex !== undefined) {
      rows[visit.exitIndex].subtreeEnd = rows.length;
      continue;
    }
    const children = childrenById.get(visit.node.id) ?? [];
    const rowIndex = rows.length;
    if (visit.parentIndex >= 0) rows[visit.parentIndex].lastChildIndex = rowIndex;
    rows.push({
      ...visit,
      lastChildIndex: -1,
      subtreeEnd: rowIndex + 1,
      hasChildren: children.length > 0,
    });
    stack.push({ ...visit, exitIndex: rowIndex });
    for (let childIndex = children.length - 1; childIndex >= 0; childIndex--) {
      stack.push({
        node: children[childIndex],
        depth: visit.depth + 1,
        parentIndex: rowIndex,
        position: childIndex + 1,
        siblingCount: children.length,
      });
    }
  }
  if (rows.length !== nodes.length) throw new Error("Tree contains a parent cycle");
  return rows;
};

export const getExpandedRows = (rows: readonly TreeRow[], collapsedIds: ReadonlySet<string>) => {
  const expanded: TreeRow[] = [];
  for (let index = 0; index < rows.length;) {
    const row = rows[index];
    expanded.push(row);
    index = collapsedIds.has(row.node.id) ? row.subtreeEnd : index + 1;
  }
  return expanded;
};

export const getVirtualRange = (
  count: number,
  scrollTop: number,
  height: number,
  rowHeight: number,
  overscan = 5,
): VirtualRange => {
  if (rowHeight <= 0) throw new Error("Row height must be positive");
  const totalHeight = count * rowHeight;
  const clampedTop = Math.max(0, Math.min(scrollTop, totalHeight - height));
  const firstVisible = Math.min(count, Math.floor(clampedTop / rowHeight));
  const lastVisible = Math.min(count, Math.ceil((clampedTop + height) / rowHeight));
  const start = Math.max(0, firstVisible - overscan);
  const end = Math.min(count, lastVisible + overscan);
  return { start, end, firstVisible, lastVisible, offset: start * rowHeight, totalHeight };
};

export const getIndentation = (rows: readonly TreeRow[], width: number): Indentation => {
  if (rows.length === 0) return { baseDepth: 0, size: diagramMetrics.indent };
  const minimumDepth = rows.reduce((minimum, row) => Math.min(minimum, row.depth), Infinity);
  const maximumDepth = rows.reduce((maximum, row) => Math.max(maximum, row.depth), 0);
  const baseDepth = Math.max(0, minimumDepth - 2);
  const availableWidth = Math.max(0, Math.min(240, width * 0.42));
  const size = Math.min(
    diagramMetrics.indent,
    availableWidth / Math.max(1, maximumDepth - baseDepth),
  );
  return { baseDepth, size };
};

export const getNodeOffset = (depth: number, indentation: Indentation) =>
  diagramMetrics.indent + 8 + Math.max(0, depth - indentation.baseDepth) * indentation.size;
