import type { TreeNode, TreeRow } from "./tree-model";
interface AccessibleEdge {
  from: string;
  to: string;
  kind?: string;
  label?: string;
}

export const treeInstructions =
  "Use Up and Down to move, Right to expand or enter a branch, Left to collapse or move to its parent, Home and End to jump, and type a name to find it. Press Enter or Space to activate. Escape clears the current trace.";

export const getNodeName = (node: TreeNode) =>
  `${node.label}${node.annotation ? `, ${node.annotation}` : ""}`;

export const getNodeDescription = (node: TreeNode) =>
  `${node.componentId ? "Component detail: " : ""}${node.kind ?? "component"}${node.isPortalTarget ? ", portal target" : ""}.`;

export const getTreeDescriptions = (
  nodes: readonly TreeNode[],
  edges: readonly AccessibleEdge[],
) => {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const descriptions = new Map<string, string[]>();
  const getName = (id: string) => {
    const node = nodeById.get(id);
    if (!node) return id;
    const component = node.componentId ? nodeById.get(node.componentId) : undefined;
    return `${component ? `${getNodeName(component)}: ` : ""}${getNodeName(node)}`;
  };
  for (const node of nodes) {
    const parts = [getNodeDescription(node)];
    if (node.componentId) parts.push(`Details of ${getName(node.componentId)}.`);
    else if (node.parentId) parts.push(`Parent: ${getName(node.parentId)}.`);
    if (node.ownerId && !node.componentId) parts.push(`Owner: ${getName(node.ownerId)}.`);
    for (const providerId of node.contextProviderIds ?? [])
      parts.push(`Reads context from ${getName(providerId)}.`);
    if (node.kind === "boundary")
      parts.push(
        "Catches descendant render errors, excluding errors handled inside nested boundaries.",
      );
    descriptions.set(node.id, parts);
  }
  for (const edge of edges) {
    const relation = edge.label ?? edge.kind ?? "parent";
    descriptions.get(edge.from)?.push(`Outgoing ${relation}: ${getName(edge.to)}.`);
    descriptions.get(edge.to)?.push(`Incoming ${relation}: ${getName(edge.from)}.`);
  }
  return new Map([...descriptions].map(([id, parts]) => [id, parts.join(" ")]));
};

export interface TreeKeyAction {
  focusId?: string;
  toggleId?: string;
  activate?: boolean;
  clear?: boolean;
}

export const getTreeKeyAction = (
  rows: readonly TreeRow[],
  focusedId: string | null,
  key: string,
  collapsedIds: ReadonlySet<string>,
  direction: "ltr" | "rtl" = "ltr",
): TreeKeyAction | undefined => {
  const index = rows.findIndex((row) => row.node.id === focusedId);
  const currentIndex = Math.max(0, index);
  const row = rows[currentIndex];
  if (!row) return;
  if (key === "ArrowDown")
    return { focusId: rows[Math.min(rows.length - 1, currentIndex + 1)].node.id };
  if (key === "ArrowUp") return { focusId: rows[Math.max(0, currentIndex - 1)].node.id };
  if (key === "Home") return { focusId: rows[0].node.id };
  if (key === "End") return { focusId: rows[rows.length - 1].node.id };
  if (key === "Enter" || key === " ") return { activate: true };
  if (key === "Escape") return { clear: true };
  if (key === (direction === "rtl" ? "ArrowLeft" : "ArrowRight")) {
    if (row.hasChildren && collapsedIds.has(row.node.id)) return { toggleId: row.node.id };
    return { focusId: row.hasChildren ? rows[currentIndex + 1]?.node.id : undefined };
  }
  if (key === (direction === "rtl" ? "ArrowRight" : "ArrowLeft")) {
    if (row.hasChildren && !collapsedIds.has(row.node.id)) return { toggleId: row.node.id };
    return { focusId: row.node.parentId };
  }
};
