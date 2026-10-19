import { useMemo } from "react";
import dagre from "@dagrejs/dagre";
import { Badge } from "@/components/ui/badge";
import { Code } from "@/components/ui/code";
import { getSolidColor } from "@/lib/colors";
import { getStateTransitions, type StateTransition } from "@/lib/diagram";
import { getConditionNodeId, getHandlerNodeId } from "@/lib/lookup";
import { buildDecisionTree, collectEdges, collectNodes, type TreeNode } from "@/lib/tree";
import type { ViewComponent, ViewHandler, ViewRegion } from "@/model";
import { useHoverStore } from "@/store/hover";
import { Chip } from "./chip";
import { useViewer } from "./context";

const LEAF_WIDTH = 220;
const LEAF_HEIGHT = 56;
const BRANCH_HEIGHT = 24;
const CHAR_WIDTH = 7.2;
const LABEL_HEIGHT = 22;

interface Point {
  x: number;
  y: number;
}

interface LaidOutNode {
  node: TreeNode;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface LaidOutEdge {
  id: string;
  points: Point[];
  label: Point;
  answer?: "yes" | "no";
  transition?: StateTransition;
  handler?: ViewHandler;
}

interface Layout {
  width: number;
  height: number;
  nodes: LaidOutNode[];
  edges: LaidOutEdge[];
}

const getNodeSize = (node: TreeNode): { width: number; height: number } =>
  node.kind === "leaf"
    ? { width: LEAF_WIDTH, height: LEAF_HEIGHT }
    : { width: Math.min(320, node.condition.length * CHAR_WIDTH + 20), height: BRANCH_HEIGHT };

const layoutTree = (component: ViewComponent, region: ViewRegion): Layout | null => {
  const root = buildDecisionTree(component, region);
  if (!root) return null;
  const graph = new dagre.graphlib.Graph({ multigraph: true });
  graph.setGraph({ rankdir: "TB", nodesep: 28, ranksep: 36, marginx: 8, marginy: 8 });
  graph.setDefaultEdgeLabel(() => ({}));
  const nodes = collectNodes(root);
  for (const node of nodes) graph.setNode(node.id, getNodeSize(node));
  const treeEdges = collectEdges(root);
  treeEdges.forEach((edge, order) =>
    graph.setEdge(edge.from, edge.to, { width: 12, height: 16, labelpos: "c" }, `t${order}`),
  );
  const transitions = getStateTransitions(component, region.states);
  const handlersById = new Map(component.handlers.map((handler) => [handler.id, handler]));
  transitions.forEach((transition, order) => {
    const handler = handlersById.get(transition.handlerId);
    const width = (handler?.label.length ?? 4) * CHAR_WIDTH + 12;
    graph.setEdge(
      `leaf:${transition.from}`,
      `leaf:${transition.to}`,
      { width, height: LABEL_HEIGHT, labelpos: "c" },
      `a${order}`,
    );
  });
  dagre.layout(graph);
  const size = graph.graph();
  const read = (from: string, to: string, name: string): { points: Point[]; label: Point } => {
    const edge = graph.edge(from, to, name);
    return { points: edge.points, label: { x: edge.x, y: edge.y } };
  };
  return {
    width: size.width ?? 0,
    height: size.height ?? 0,
    nodes: nodes.map((node) => ({ node, ...graph.node(node.id) })),
    edges: [
      ...treeEdges.map((edge, order) => ({
        id: `t${order}`,
        answer: edge.answer,
        ...read(edge.from, edge.to, `t${order}`),
      })),
      ...transitions.map((transition, order) => ({
        id: `a${order}`,
        transition,
        handler: handlersById.get(transition.handlerId),
        ...read(`leaf:${transition.from}`, `leaf:${transition.to}`, `a${order}`),
      })),
    ],
  };
};

const toPath = (points: Point[]): string =>
  points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");

const useIsOtherActionHovered = (handlerId: string | undefined): boolean => {
  const { index } = useViewer();
  return useHoverStore((state) => {
    if (handlerId === undefined || state.hoveredNodeId === null) return false;
    const hovered = index?.nodes.get(state.hoveredNodeId);
    return hovered?.handlerId !== undefined && hovered.handlerId !== handlerId;
  });
};

const EdgePath = ({ edge, component }: { edge: LaidOutEdge; component: ViewComponent }) => {
  const { colorByNodeId } = useViewer();
  const handlerId = edge.transition?.handlerId;
  const nodeId = handlerId !== undefined ? getHandlerNodeId(component, handlerId) : undefined;
  const color = nodeId ? colorByNodeId.get(nodeId) : undefined;
  const isMuted = useIsOtherActionHovered(handlerId);
  return (
    <path
      d={toPath(edge.points)}
      fill="none"
      stroke={color ? getSolidColor(color) : "var(--faint)"}
      strokeWidth={edge.transition ? 1.25 : 1}
      strokeDasharray={edge.transition?.isAsync ? "4 3" : undefined}
      opacity={isMuted ? 0.15 : edge.transition ? 0.85 : 1}
      markerEnd="url(#tree-arrow)"
    />
  );
};

const EdgeLabel = ({ edge, component }: { edge: LaidOutEdge; component: ViewComponent }) => {
  const handlerId = edge.transition?.handlerId;
  const nodeId = handlerId !== undefined ? getHandlerNodeId(component, handlerId) : undefined;
  return (
    <div
      className="absolute -translate-x-1/2 -translate-y-1/2 bg-background px-0.5"
      style={{ left: edge.label.x, top: edge.label.y }}
    >
      {edge.handler ? (
        <Chip nodeIds={nodeId ? [nodeId] : []}>
          <Code>{edge.handler.label}</Code>
        </Chip>
      ) : (
        <span className="text-muted-foreground">{edge.answer === "yes" ? "✓" : "✗"}</span>
      )}
    </div>
  );
};

const NodeView = ({ laid, component }: { laid: LaidOutNode; component: ViewComponent }) => {
  const { node, x, y, width, height } = laid;
  const style = { left: x - width / 2, top: y - height / 2, width };
  if (node.kind === "branch") {
    const nodeId = node.branch ? getConditionNodeId(component, node.branch.test) : undefined;
    return (
      <div className="absolute flex justify-center overflow-hidden" style={style}>
        <Chip nodeIds={nodeId ? [nodeId] : []}>
          <Code className="block max-w-full truncate">{node.condition}</Code>
        </Chip>
      </div>
    );
  }
  return (
    <div
      className="absolute grid content-start gap-0.5 rounded-md border bg-background px-2 py-1.5 shadow-card"
      style={{ ...style, height }}
    >
      <Badge variant="outline" className="w-fit">
        S{node.state.index + 1}
      </Badge>
      <Code className="truncate text-muted-foreground">{node.state.render || "∅"}</Code>
    </div>
  );
};

interface DecisionTreeProps {
  component: ViewComponent;
  region: ViewRegion;
}

export const DecisionTree = ({ component, region }: DecisionTreeProps) => {
  const layout = useMemo(() => layoutTree(component, region), [component, region]);
  if (!layout) return null;
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
            id="tree-arrow"
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
        {layout.edges.map((edge) => (
          <EdgePath key={edge.id} edge={edge} component={component} />
        ))}
      </svg>
      {layout.nodes.map((laid) => (
        <NodeView key={laid.node.id} laid={laid} component={component} />
      ))}
      {layout.edges.map((edge) => (
        <EdgeLabel key={edge.id} edge={edge} component={component} />
      ))}
    </div>
  );
};
