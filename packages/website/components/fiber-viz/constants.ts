export interface FiberVizNode {
  id: string;
  label: string;
  tag: string;
  x: number;
  y: number;
}

export interface FiberVizEdge {
  id: string;
  from: string;
  to: string;
  kind: "child" | "sibling" | "return";
}

export const FIBER_NODE_WIDTH_PX = 118;
export const FIBER_NODE_HEIGHT_PX = 44;
export const FIBER_CANVAS_WIDTH_PX = 480;
export const FIBER_CANVAS_HEIGHT_PX = 430;
export const ALTERNATE_GHOST_OFFSET_PX = 9;
export const TRAVERSAL_TICK_MS = 650;
export const TRAVERSAL_PAUSE_TICKS = 2;
export const LIVE_RENDER_STEP_MS = 420;
export const LIVE_COMMIT_DURATION_MS = 1200;
export const LIVE_RENDER_SEQUENCE: string[] = ["counter", "paragraph", "count-text"];

export const FIBER_VIZ_NODES: FiberVizNode[] = [
  { id: "root", label: "HostRoot", tag: "createRoot()", x: 240, y: 36 },
  { id: "app", label: "App", tag: "FunctionComponent", x: 240, y: 112 },
  { id: "counter", label: "Counter", tag: "FunctionComponent", x: 240, y: 188 },
  { id: "paragraph", label: "p", tag: "HostComponent", x: 138, y: 276 },
  { id: "button", label: "button", tag: "HostComponent", x: 342, y: 276 },
  { id: "count-text", label: '"0"', tag: "HostText", x: 138, y: 356 },
  { id: "button-text", label: '"+1"', tag: "HostText", x: 342, y: 356 },
];

export const FIBER_VIZ_EDGES: FiberVizEdge[] = [
  { id: "root-app", from: "root", to: "app", kind: "child" },
  { id: "app-counter", from: "app", to: "counter", kind: "child" },
  { id: "counter-paragraph", from: "counter", to: "paragraph", kind: "child" },
  { id: "paragraph-count-text", from: "paragraph", to: "count-text", kind: "child" },
  { id: "button-button-text", from: "button", to: "button-text", kind: "child" },
  { id: "paragraph-button", from: "paragraph", to: "button", kind: "sibling" },
  { id: "button-counter", from: "button", to: "counter", kind: "return" },
  { id: "count-text-paragraph", from: "count-text", to: "paragraph", kind: "return" },
];

export const TRAVERSAL_ORDER: string[] = [
  "root",
  "app",
  "counter",
  "paragraph",
  "count-text",
  "button",
  "button-text",
];

export const RERENDERED_NODE_IDS: string[] = ["counter", "paragraph", "count-text"];
export const BAILED_OUT_NODE_IDS: string[] = ["root", "app"];
export const MUTATED_HOST_NODE_IDS: string[] = ["paragraph", "count-text"];

export const RETURN_EDGE_PATHS: Record<string, string> = {
  "button-counter": "M 342 254 C 342 226, 332 196, 303 190",
  "count-text-paragraph": "M 96 334 C 70 326, 70 306, 96 298",
};
