import type { SceneEdge, SceneNode } from "./diagram-scene";

interface DataflowMember {
  id: string;
  componentId?: string;
}

export interface DataflowNode extends SceneNode {}

export interface DataflowEdge extends SceneEdge {
  kind: "data" | "update" | "subscription" | "context";
}

export interface DataflowIndex<NodeModel extends DataflowMember = DataflowMember> {
  nodeById: ReadonlyMap<string, NodeModel>;
  incoming: ReadonlyMap<string, readonly DataflowEdge[]>;
  outgoing: ReadonlyMap<string, readonly DataflowEdge[]>;
  members: ReadonlyMap<string, readonly string[]>;
}

export interface DataflowHighlight {
  nodeIds: ReadonlySet<string>;
  edgeIds: ReadonlySet<string>;
}

export const getDataflowIndex = <NodeModel extends DataflowMember>(
  nodes: readonly NodeModel[],
  edges: readonly DataflowEdge[],
): DataflowIndex<NodeModel> => {
  const nodeById = new Map<string, NodeModel>();
  const incoming = new Map<string, DataflowEdge[]>();
  const outgoing = new Map<string, DataflowEdge[]>();
  const members = new Map<string, string[]>();
  const edgeIds = new Set<string>();
  for (const node of nodes) {
    if (nodeById.has(node.id)) throw new Error(`Duplicate dataflow node: ${node.id}`);
    nodeById.set(node.id, node);
  }
  for (const node of nodes) {
    if (node.componentId === undefined) continue;
    if (!nodeById.has(node.componentId)) throw new Error(`Missing component: ${node.componentId}`);
    const componentMembers = members.get(node.componentId) ?? [];
    componentMembers.push(node.id);
    members.set(node.componentId, componentMembers);
  }
  for (const edge of edges) {
    if (edgeIds.has(edge.id)) throw new Error(`Duplicate dataflow edge: ${edge.id}`);
    if (!nodeById.has(edge.from) || !nodeById.has(edge.to))
      throw new Error(`Missing endpoint for edge ${edge.id}`);
    edgeIds.add(edge.id);
    const fromEdges = outgoing.get(edge.from) ?? [];
    fromEdges.push(edge);
    outgoing.set(edge.from, fromEdges);
    const toEdges = incoming.get(edge.to) ?? [];
    toEdges.push(edge);
    incoming.set(edge.to, toEdges);
  }
  return { nodeById, incoming, outgoing, members };
};

export const getDataflowHighlight = (index: DataflowIndex, activeId: string): DataflowHighlight => {
  const seeds = [activeId, ...(index.members.get(activeId) ?? [])];
  const nodeIds = new Set(seeds);
  const edgeIds = new Set<string>();
  for (const direction of ["incoming", "outgoing"]) {
    const visited = new Set(seeds);
    const adjacency = direction === "incoming" ? index.incoming : index.outgoing;
    for (const nodeId of visited) {
      for (const edge of adjacency.get(nodeId) ?? []) {
        const adjacentId = direction === "incoming" ? edge.from : edge.to;
        visited.add(adjacentId);
        nodeIds.add(adjacentId);
        edgeIds.add(edge.id);
      }
    }
  }
  for (const nodeId of nodeIds) {
    const componentId = index.nodeById.get(nodeId)?.componentId;
    if (componentId !== undefined) nodeIds.add(componentId);
  }
  return { nodeIds, edgeIds };
};
