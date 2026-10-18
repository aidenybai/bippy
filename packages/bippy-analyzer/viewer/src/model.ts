export interface ViewPosition {
  line: number;
  column: number;
  index: number;
}

export interface ViewLocation {
  start: ViewPosition;
  end: ViewPosition;
}

export interface ViewBinding {
  id: number;
  name: string;
  domain: string;
  initial: string | null;
  reachable: string | null;
  loc: ViewLocation | null;
}

export interface ViewBranch {
  id: number;
  test: string;
  negated: string;
  loc: ViewLocation | null;
  consequent: ViewLocation | null;
  alternate: ViewLocation | null;
  readsBindingIds: number[];
  never: "consequent" | "alternate" | null;
}

export interface ViewUpdate {
  bindingId: number;
  guard: string | null;
  assignments: string[];
  isAsync: boolean;
}

export interface ViewHandler {
  id: string;
  label: string;
  loc: ViewLocation | null;
  updates: ViewUpdate[];
}

export interface ViewTransition {
  handlerId: string;
  targets: number[];
  isAsync: boolean;
}

export interface ViewState {
  index: number;
  conditions: string[];
  label: string;
  render: string;
  transitions: ViewTransition[];
}

export interface ViewRegion {
  placeNames: string[];
  states: number[];
}

export type GraphNodeKind = "handler" | "trigger" | "binding" | "write" | "read" | "branch" | "arm";

export interface GraphNode {
  id: string;
  kind: GraphNodeKind;
  label: string;
  loc: ViewLocation;
  handlerId?: string;
  bindingId?: number;
  branchId?: number;
  arm?: "consequent" | "alternate";
}

export type GraphEdgeKind = "triggers" | "writes" | "reads" | "decides" | "shows" | "hides";

export interface GraphEdge {
  from: string;
  to: string;
  kind: GraphEdgeKind;
}

export interface CodeGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface ViewComponent {
  name: string;
  loc: ViewLocation | null;
  bindings: ViewBinding[];
  branches: ViewBranch[];
  handlers: ViewHandler[];
  states: ViewState[];
  regions: ViewRegion[];
  graph: CodeGraph;
}

export interface Example {
  file: string;
  name: string;
  folder: string;
  lines: number;
}

export interface ViewFile {
  file: string;
  tsconfig: string;
  source: string;
  components: ViewComponent[];
}
