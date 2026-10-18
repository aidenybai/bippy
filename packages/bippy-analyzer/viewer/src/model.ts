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
  kind: string;
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
  text: string;
  isAsync: boolean;
}

export interface ViewHandler {
  id: string;
  label: string;
  kind: "event" | "effect";
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
  regionIndex: number;
  conditions: string[];
  label: string;
  render: string;
  transitions: ViewTransition[];
}

export interface ViewRegion {
  placeNames: string[];
  states: number[];
  firstRenderState: number | null;
  isTruncated: boolean;
}

export type GraphNodeKind =
  | "handler"
  | "trigger"
  | "binding"
  | "write"
  | "read"
  | "branch"
  | "arm"
  | "component"
  | "render";

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

export type GraphEdgeKind =
  | "triggers"
  | "writes"
  | "reads"
  | "decides"
  | "shows"
  | "hides"
  | "renders";

export interface GraphEdge {
  from: string;
  to: string;
  kind: GraphEdgeKind;
}

export interface CodeGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface FileInfo {
  file: string;
  tsconfig: string;
  components: ComponentSummary[];
}

export interface ComponentSummary {
  name: string;
  file: string;
  line: number | null;
  stateCount: number;
  handlerCount: number;
}

export interface ViewComponent {
  components: ComponentSummary[];
  name: string;
  file: string;
  loc: ViewLocation | null;
  source: string;
  bindings: ViewBinding[];
  branches: ViewBranch[];
  handlers: ViewHandler[];
  states: ViewState[];
  regions: ViewRegion[];
  graph: CodeGraph;
  isTruncated: boolean;
}
