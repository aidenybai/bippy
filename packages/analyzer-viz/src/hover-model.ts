import type {
  CodeGraph,
  GraphEdge,
  GraphEdgeKind,
  GraphNode,
  ViewComponent,
  ViewState,
} from "./model";
import { formatStates, getArmChanges, getStatesByOutcome, type ArmChange } from "./state-model";

export interface GraphIndex {
  byId: Map<string, GraphNode>;
  out: Map<string, GraphEdge[]>;
  in: Map<string, GraphEdge[]>;
}

export interface HoverView {
  nodeIds: Set<string>;
  notes: Map<string, string>;
  edges: GraphEdge[];
  armChanges: ArmChange[];
  stateIndices: Set<number>;
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

const createView = (hoveredId: string): HoverView => ({
  nodeIds: new Set([hoveredId]),
  notes: new Map(),
  edges: [],
  armChanges: [],
  stateIndices: new Set(),
});

const add = (view: HoverView, ids: Iterable<string>): string[] => {
  const added: string[] = [];
  for (const id of ids)
    if (!view.nodeIds.has(id)) {
      view.nodeIds.add(id);
      added.push(id);
    }
  return added;
};

const addEdges = (
  view: HoverView,
  index: GraphIndex,
  ids: string[],
  direction: "out" | "in",
  kinds: GraphEdgeKind[],
): void => {
  for (const id of ids)
    for (const edge of index[direction].get(id) ?? [])
      if (kinds.includes(edge.kind)) view.edges.push(edge);
};

const getSourceStates = (component: ViewComponent, baseline: ViewState | null): ViewState[] =>
  baseline
    ? [baseline]
    : component.regions.flatMap((region) => {
        const state =
          region.firstRenderState === null ? null : component.states[region.firstRenderState];
        return state ? [state] : [];
      });

const describeTransitions = (
  component: ViewComponent,
  handlerId: string,
  baseline: ViewState | null,
  view: HoverView,
): string => {
  const moves: string[] = [];
  for (const source of getSourceStates(component, baseline)) {
    const targets = source.transitions
      .filter((transition) => transition.handlerId === handlerId)
      .flatMap((transition) => transition.targets)
      .filter((target) => target !== source.index);
    for (const target of targets) {
      const state = component.states[target];
      if (!state) continue;
      moves.push(`S${source.index + 1} → S${target + 1}`);
      view.stateIndices.add(target);
      view.armChanges.push(...getArmChanges(component, source, state));
    }
  }
  return moves.length > 0 ? moves.join(" · ") : "screen unchanged";
};

const viewHandler = (
  component: ViewComponent,
  index: GraphIndex,
  view: HoverView,
  handlerNodeId: string,
  baseline: ViewState | null,
): void => {
  const handler = index.byId.get(handlerNodeId);
  if (!handler?.handlerId) return;
  add(view, [handlerNodeId]);
  add(view, follow(index, [handlerNodeId], "in", ["triggers"]));
  const writes = add(view, follow(index, [handlerNodeId], "out", ["writes"]));
  addEdges(view, index, [handlerNodeId], "out", ["writes"]);
  add(view, follow(index, writes, "out", ["writes"]));
  addEdges(view, index, writes, "out", ["writes"]);
  const data = component.handlers.find((candidate) => candidate.id === handler.handlerId);
  const effects = data?.updates.map((update) => `sets ${update.text}`) ?? [];
  const transitions = describeTransitions(component, handler.handlerId, baseline, view);
  view.notes.set(handlerNodeId, [...effects, transitions].join(" · "));
};

const viewBinding = (
  component: ViewComponent,
  index: GraphIndex,
  view: HoverView,
  bindingNodeId: string,
): void => {
  const binding = index.byId.get(bindingNodeId);
  const data = component.bindings.find((candidate) => candidate.id === binding?.bindingId);
  add(view, [bindingNodeId]);
  const writes = add(view, follow(index, [bindingNodeId], "in", ["writes"]));
  addEdges(view, index, [bindingNodeId], "in", ["writes"]);
  const handlers = add(view, follow(index, writes, "in", ["writes"]));
  add(view, follow(index, handlers, "in", ["triggers"]));
  const reads = follow(index, [bindingNodeId], "out", ["reads"]).filter(
    (id) => !index.byId.get(id)?.handlerId,
  );
  add(view, reads);
  add(view, follow(index, [bindingNodeId], "out", ["decides"]));
  addEdges(view, index, [bindingNodeId], "out", ["decides"]);
  if (!data) return;
  const facts = [
    data.domain,
    data.initial !== null ? `starts ${data.initial}` : null,
    data.reachable ? `only ${data.reachable}` : null,
  ];
  view.notes.set(bindingNodeId, facts.filter(Boolean).join(" · "));
};

const viewBranch = (
  component: ViewComponent,
  index: GraphIndex,
  view: HoverView,
  branchNodeId: string,
): void => {
  const node = index.byId.get(branchNodeId);
  const branch = component.branches.find((candidate) => candidate.id === node?.branchId);
  add(view, [branchNodeId]);
  add(view, follow(index, [branchNodeId], "out", ["shows", "hides"]));
  add(view, follow(index, [branchNodeId], "in", ["decides"]));
  addEdges(view, index, [branchNodeId], "in", ["decides"]);
  if (!branch) return;
  const { trueIn, falseIn } = getStatesByOutcome(component, branch);
  for (const state of [...trueIn, ...falseIn]) view.stateIndices.add(state.index);
  const parts = [
    trueIn.length > 0 ? `true in ${formatStates(trueIn)}` : null,
    falseIn.length > 0 ? `false in ${formatStates(falseIn)}` : null,
    branch.never ? `never ${branch.never === "consequent" ? "true" : "false"}` : null,
  ];
  view.notes.set(branchNodeId, parts.filter(Boolean).join(" · "));
};

const viewComponent = (index: GraphIndex, view: HoverView, componentNodeId: string): void => {
  add(view, [componentNodeId]);
  const sites = add(view, follow(index, [componentNodeId], "in", ["renders"]));
  addEdges(view, index, [componentNodeId], "in", ["renders"]);
  view.notes.set(componentNodeId, sites.length > 0 ? `rendered ${sites.length}×` : "not rendered here");
};

export const getHoverView = (
  component: ViewComponent,
  index: GraphIndex,
  hoveredId: string,
  baseline: ViewState | null,
): HoverView => {
  const view = createView(hoveredId);
  const hovered = index.byId.get(hoveredId);
  if (!hovered) return view;
  switch (hovered.kind) {
    case "trigger":
      for (const id of follow(index, [hoveredId], "out", ["triggers"]))
        viewHandler(component, index, view, id, baseline);
      break;
    case "handler":
      viewHandler(component, index, view, hoveredId, baseline);
      break;
    case "write":
      for (const id of follow(index, [hoveredId], "out", ["writes"]))
        viewBinding(component, index, view, id);
      break;
    case "read":
      for (const id of follow(index, [hoveredId], "in", ["reads"]))
        viewBinding(component, index, view, id);
      break;
    case "binding":
      viewBinding(component, index, view, hoveredId);
      break;
    case "branch":
      viewBranch(component, index, view, hoveredId);
      break;
    case "arm":
      for (const id of follow(index, [hoveredId], "in", ["shows", "hides"]))
        viewBranch(component, index, view, id);
      break;
    case "component":
      viewComponent(index, view, hoveredId);
      break;
    case "render":
      for (const id of follow(index, [hoveredId], "out", ["renders"]))
        viewComponent(index, view, id);
      break;
  }
  return view;
};
