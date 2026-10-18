import type { GraphEdge, GraphNode, ViewComponent, ViewFile } from "../model";

export const getComponentName = (nodeId: string): string => nodeId.slice(0, nodeId.indexOf("/"));

export const getDefaultComponent = (view: ViewFile): ViewComponent | null =>
  [...view.components].sort((a, b) => b.states.length - a.states.length)[0] ?? null;

export const getComponentAtLine = (view: ViewFile, line: number): ViewComponent | null =>
  view.components.find(
    ({ loc }) => loc !== null && loc.start.line <= line && line <= loc.end.line,
  ) ?? null;

export const findComponent = (view: ViewFile, nodeId: string): ViewComponent | null =>
  view.components.find((component) => component.name === getComponentName(nodeId)) ?? null;

export const findNode = (view: ViewFile, nodeId: string | null): GraphNode | null => {
  if (nodeId === null) return null;
  for (const component of view.components) {
    const node = component.graph.nodes.find((candidate) => candidate.id === nodeId);
    if (node) return node;
  }
  return null;
};

const walkEdges = (
  edges: GraphEdge[],
  start: string,
  next: (edge: GraphEdge) => [string, string],
): string[] => {
  const seen = new Set([start]);
  const queue = [start];
  for (const nodeId of queue)
    for (const edge of edges) {
      const [from, to] = next(edge);
      if (from === nodeId && !seen.has(to)) {
        seen.add(to);
        queue.push(to);
      }
    }
  return [...seen];
};

export const getCausalNodeIds = (view: ViewFile, nodeId: string): Set<string> => {
  const edges = findComponent(view, nodeId)?.graph.edges ?? [];
  return new Set([
    ...walkEdges(edges, nodeId, (edge) => [edge.from, edge.to]),
    ...walkEdges(edges, nodeId, (edge) => [edge.to, edge.from]),
  ]);
};
