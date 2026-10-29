import type { GraphNode, ViewComponent, ViewFile } from "@/model";

export interface GraphIndex {
  nodes: Map<string, GraphNode>;
  forward: Map<string, string[]>;
  backward: Map<string, string[]>;
}

export const getComponentName = (nodeId: string): string => nodeId.slice(0, nodeId.indexOf("/"));

export const hasInspectorContent = (view: ViewFile): boolean =>
  view.components.some(
    (component) => component.bindings.length > 0 || component.handlers.length > 0,
  );

export const getDefaultComponent = (view: ViewFile): ViewComponent | null =>
  [...view.components].sort((a, b) => b.states.length - a.states.length)[0] ?? null;

export const getComponentAtLine = (view: ViewFile, line: number): ViewComponent | null =>
  view.components.find(
    ({ loc }) => loc !== null && loc.start.line <= line && line <= loc.end.line,
  ) ?? null;

const push = (map: Map<string, string[]>, key: string, value: string): void => {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
};

export const buildGraphIndex = (view: ViewFile): GraphIndex => {
  const index: GraphIndex = { nodes: new Map(), forward: new Map(), backward: new Map() };
  for (const component of view.components) {
    for (const node of component.graph.nodes) index.nodes.set(node.id, node);
    for (const edge of component.graph.edges) {
      push(index.forward, edge.from, edge.to);
      push(index.backward, edge.to, edge.from);
    }
  }
  return index;
};

const walk = (adjacency: Map<string, string[]>, start: string, seen: Set<string>): void => {
  const queue = [start];
  for (const nodeId of queue)
    for (const next of adjacency.get(nodeId) ?? [])
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
};

export const getCausalNodeIds = (index: GraphIndex, nodeId: string): Set<string> => {
  const seen = new Set([nodeId]);
  walk(index.forward, nodeId, seen);
  walk(index.backward, nodeId, seen);
  return seen;
};
