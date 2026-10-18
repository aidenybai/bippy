import type { CodeGraph, GraphEdge, GraphEdgeKind, GraphNode } from "./model";

export interface GraphIndex {
  byId: Map<string, GraphNode>;
  out: Map<string, GraphEdge[]>;
  in: Map<string, GraphEdge[]>;
}

export const indexGraph = (graph: CodeGraph): GraphIndex => {
  const index: GraphIndex = { byId: new Map(), out: new Map(), in: new Map() };
  for (const node of graph.nodes) index.byId.set(node.id, node);
  for (const edge of graph.edges) {
    index.out.set(edge.from, [...(index.out.get(edge.from) ?? []), edge]);
    index.in.set(edge.to, [...(index.in.get(edge.to) ?? []), edge]);
  }
  return index;
};

const follow = (
  index: GraphIndex,
  ids: Iterable<string>,
  direction: "out" | "in",
  kinds: GraphEdgeKind[],
): string[] => {
  const next: string[] = [];
  for (const id of ids)
    for (const edge of index[direction].get(id) ?? [])
      if (kinds.includes(edge.kind)) next.push(direction === "out" ? edge.to : edge.from);
  return next;
};

const addAll = (set: Set<string>, ids: Iterable<string>): string[] => {
  const added: string[] = [];
  for (const id of ids)
    if (!set.has(id)) {
      set.add(id);
      added.push(id);
    }
  return added;
};

const expandFromHandlers = (index: GraphIndex, related: Set<string>, handlers: string[]): void => {
  addAll(related, follow(index, handlers, "in", ["triggers"]));
  const writes = addAll(related, follow(index, handlers, "out", ["writes"]));
  const bindings = addAll(related, follow(index, writes, "out", ["writes"]));
  expandFromBindings(index, related, bindings, false);
};

const expandFromBindings = (
  index: GraphIndex,
  related: Set<string>,
  bindings: string[],
  shouldFollowWriters: boolean,
): void => {
  const reads = follow(index, bindings, "out", ["reads"]).filter(
    (id) => index.byId.get(id)?.handlerId === undefined,
  );
  addAll(related, reads);
  const branches = addAll(related, follow(index, bindings, "out", ["decides"]));
  addAll(related, follow(index, branches, "out", ["shows", "hides"]));
  if (!shouldFollowWriters) return;
  const writes = addAll(related, follow(index, bindings, "in", ["writes"]));
  const handlers = addAll(related, follow(index, writes, "in", ["writes"]));
  addAll(related, follow(index, handlers, "in", ["triggers"]));
};

export const getRelatedNodeIds = (index: GraphIndex, hoveredId: string): Set<string> => {
  const hovered = index.byId.get(hoveredId);
  const related = new Set<string>([hoveredId]);
  if (!hovered) return related;
  switch (hovered.kind) {
    case "trigger":
      expandFromHandlers(index, related, addAll(related, follow(index, [hoveredId], "out", ["triggers"])));
      break;
    case "handler":
      expandFromHandlers(index, related, [hoveredId]);
      break;
    case "write": {
      const handlers = addAll(related, follow(index, [hoveredId], "in", ["writes"]));
      addAll(related, follow(index, handlers, "in", ["triggers"]));
      const bindings = addAll(related, follow(index, [hoveredId], "out", ["writes"]));
      expandFromBindings(index, related, bindings, true);
      break;
    }
    case "binding":
      expandFromBindings(index, related, [hoveredId], true);
      break;
    case "read":
      expandFromBindings(index, related, addAll(related, follow(index, [hoveredId], "in", ["reads"])), true);
      break;
    case "branch": {
      addAll(related, follow(index, [hoveredId], "out", ["shows", "hides"]));
      const bindings = addAll(related, follow(index, [hoveredId], "in", ["decides"]));
      const writes = addAll(related, follow(index, bindings, "in", ["writes"]));
      const handlers = addAll(related, follow(index, writes, "in", ["writes"]));
      addAll(related, follow(index, handlers, "in", ["triggers"]));
      break;
    }
    case "arm": {
      const branches = addAll(related, follow(index, [hoveredId], "in", ["shows", "hides"]));
      const bindings = addAll(related, follow(index, branches, "in", ["decides"]));
      const writes = addAll(related, follow(index, bindings, "in", ["writes"]));
      const handlers = addAll(related, follow(index, writes, "in", ["writes"]));
      addAll(related, follow(index, handlers, "in", ["triggers"]));
      break;
    }
  }
  return related;
};

export const getRoleLabel = (node: GraphNode): string => {
  switch (node.kind) {
    case "trigger":
      return "runs on";
    case "handler":
      return "handler";
    case "write":
      return "writes";
    case "binding":
      return "state";
    case "read":
      return node.handlerId ? "reads" : "re-renders";
    case "branch":
      return "decides";
    case "arm":
      return node.arm === "consequent" ? "shows" : "hides";
  }
};
