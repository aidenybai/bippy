import { useMemo } from "react";
import dagre from "@dagrejs/dagre";
import { Badge } from "@/components/ui/badge";
import { Code } from "@/components/ui/code";
import { getSolidColor } from "../lib/colors";
import { getStateTransitions, type StateTransition } from "../lib/diagram";
import { getHandlerNodeId } from "../lib/lookup";
import type { ViewComponent, ViewHandler, ViewState } from "../model";
import { useHoverStore } from "../store/hover";
import { Chip } from "./chip";
import { useViewer } from "./context";

const NODE_WIDTH = 220;
const LINE_HEIGHT = 20;
const NODE_PADDING = 16;
const LABEL_HEIGHT = 22;
const CHAR_WIDTH = 7.2;

interface Point {
  x: number;
  y: number;
}

interface LaidOutNode {
  state: ViewState;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface LaidOutEdge {
  transition: StateTransition;
  handler: ViewHandler | undefined;
  points: Point[];
  label: Point;
}

interface Layout {
  width: number;
  height: number;
  nodes: LaidOutNode[];
  edges: LaidOutEdge[];
}

const getConditions = (state: ViewState): string[] =>
  state.label === "always" ? [] : state.label.split(" ∧ ");

const getNodeHeight = (state: ViewState): number =>
  NODE_PADDING + LINE_HEIGHT * (1 + getConditions(state).length + (state.render ? 1 : 0));

const layoutGraph = (component: ViewComponent): Layout => {
  const graph = new dagre.graphlib.Graph({ multigraph: true });
  graph.setGraph({ rankdir: "LR", nodesep: 24, ranksep: 56, marginx: 8, marginy: 8 });
  graph.setDefaultEdgeLabel(() => ({}));
  for (const state of component.states)
    graph.setNode(String(state.index), { width: NODE_WIDTH, height: getNodeHeight(state) });
  const transitions = getStateTransitions(component);
  transitions.forEach((transition, order) => {
    const handler = component.handlers.find((candidate) => candidate.id === transition.handlerId);
    const labelWidth = (handler?.label.length ?? 4) * CHAR_WIDTH + 12;
    graph.setEdge(
      String(transition.from),
      String(transition.to),
      { width: labelWidth, height: LABEL_HEIGHT, labelpos: "c" },
      String(order),
    );
  });
  dagre.layout(graph);
  const size = graph.graph();
  return {
    width: size.width ?? 0,
    height: size.height ?? 0,
    nodes: component.states.map((state) => ({ state, ...graph.node(String(state.index)) })),
    edges: transitions.map((transition, order) => {
      const edge = graph.edge(String(transition.from), String(transition.to), String(order));
      const handler = component.handlers.find((candidate) => candidate.id === transition.handlerId);
      return { transition, handler, points: edge.points, label: { x: edge.x, y: edge.y } };
    }),
  };
};

const toPath = (points: Point[]): string =>
  points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");

const useIsOtherActionHovered = (handlerId: string): boolean => {
  const { index } = useViewer();
  return useHoverStore((state) => {
    if (state.hoveredNodeId === null) return false;
    const hovered = index?.nodes.get(state.hoveredNodeId);
    return hovered?.handlerId !== undefined && hovered.handlerId !== handlerId;
  });
};

const Edge = ({ edge, component }: { edge: LaidOutEdge; component: ViewComponent }) => {
  const { colorByNodeId } = useViewer();
  const nodeId = getHandlerNodeId(component, edge.transition.handlerId);
  const color = nodeId ? colorByNodeId.get(nodeId) : undefined;
  const isMuted = useIsOtherActionHovered(edge.transition.handlerId);
  return (
    <path
      d={toPath(edge.points)}
      fill="none"
      stroke={color ? getSolidColor(color) : "var(--faint)"}
      strokeWidth={1.25}
      strokeDasharray={edge.transition.isAsync ? "4 3" : undefined}
      opacity={isMuted ? 0.15 : 0.85}
      markerEnd="url(#state-arrow)"
    />
  );
};

const EdgeLabel = ({ edge, component }: { edge: LaidOutEdge; component: ViewComponent }) => {
  const nodeId = getHandlerNodeId(component, edge.transition.handlerId);
  if (!edge.handler) return null;
  return (
    <div
      className="absolute -translate-x-1/2 -translate-y-1/2 bg-background px-0.5"
      style={{ left: edge.label.x, top: edge.label.y }}
    >
      <Chip nodeIds={nodeId ? [nodeId] : []}>
        <Code>{edge.handler.label}</Code>
      </Chip>
    </div>
  );
};

const StateNode = ({ node }: { node: LaidOutNode }) => (
  <div
    className="absolute grid content-start gap-0.5 rounded-md border bg-background px-2 py-1.5 shadow-card"
    style={{ left: node.x - node.width / 2, top: node.y - node.height / 2, width: node.width }}
  >
    <Badge variant="outline" className="w-fit">
      S{node.state.index + 1}
    </Badge>
    {getConditions(node.state).map((condition) => (
      <Code key={condition} className="truncate">
        {condition}
      </Code>
    ))}
    {node.state.render && (
      <Code className="truncate text-muted-foreground">{node.state.render}</Code>
    )}
  </div>
);

export const StateGraph = ({ component }: { component: ViewComponent }) => {
  const layout = useMemo(() => layoutGraph(component), [component]);
  if (component.states.length < 2) return null;
  return (
    <div className="relative" style={{ width: layout.width, height: layout.height }}>
      <svg
        className="absolute inset-0"
        width={layout.width}
        height={layout.height}
        aria-hidden="true"
      >
        <defs>
          <marker
            id="state-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
          </marker>
        </defs>
        {layout.edges.map((edge, order) => (
          <Edge key={order} edge={edge} component={component} />
        ))}
      </svg>
      {layout.nodes.map((node) => (
        <StateNode key={node.state.index} node={node} />
      ))}
      {layout.edges.map((edge, order) => (
        <EdgeLabel key={order} edge={edge} component={component} />
      ))}
    </div>
  );
};
