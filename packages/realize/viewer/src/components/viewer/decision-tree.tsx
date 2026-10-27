import { useMemo } from "react";
import dagre, { type graphlib } from "@dagrejs/dagre";
import { Badge } from "@/components/ui/badge";
import { Code } from "@/components/ui/code";
import { getSolidColor } from "@/lib/colors";
import { getConditionNodeId, getHandlerNodeId } from "@/lib/lookup";
import { getStateTransitions, type StateTransition } from "@/lib/state-chart";
import {
  buildDecisionTree,
  collectEdges,
  collectNodes,
  type TreeEdge,
  type TreeNode,
} from "@/lib/tree";
import type { ViewComponent, ViewHandler, ViewRegion } from "@/model";
import { ArrowHead, type Point } from "./arrow-head";
import { Chip } from "./chip";
import { useViewer } from "./context";

const LEAF_WIDTH = 220;
const LEAF_HEIGHT = 56;
const BRANCH_HEIGHT = 24;
const CHAR_WIDTH = 7.7;
const LABEL_HEIGHT = 22;

interface LaidOutNode {
  node: TreeNode;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface HeadSegment {
  from: Point;
  tip: Point;
}

interface LaidOutEdge {
  id: string;
  points: Point[];
  path?: string;
  head: HeadSegment;
  label: Point;
  labelAlign?: "center" | "start";
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

const getLabelWidth = (handler: ViewHandler | undefined): number =>
  (handler?.label.length ?? 4) * CHAR_WIDTH + 12;

const createGraph = (nodes: TreeNode[], treeEdges: TreeEdge[]): graphlib.Graph => {
  const graph = new dagre.graphlib.Graph({ multigraph: true });
  graph.setGraph({ rankdir: "TB", nodesep: 28, ranksep: 36, marginx: 8, marginy: 8 });
  graph.setDefaultEdgeLabel(() => ({}));
  for (const node of nodes) graph.setNode(node.id, getNodeSize(node));
  treeEdges.forEach((edge, order) =>
    graph.setEdge(edge.from, edge.to, { width: 12, height: 16, labelpos: "c" }, `t${order}`),
  );
  return graph;
};

const addTransitionEdges = (
  graph: graphlib.Graph,
  transitions: StateTransition[],
  handlersById: Map<string, ViewHandler>,
): void => {
  transitions.forEach((transition, order) => {
    const width = getLabelWidth(handlersById.get(transition.handlerId));
    graph.setEdge(
      `leaf:${transition.from}`,
      `leaf:${transition.to}`,
      { width, height: LABEL_HEIGHT, labelpos: "c" },
      `a${order}`,
    );
  });
};

const readEdge = (graph: graphlib.Graph, from: string, to: string, name: string) => {
  const edge = graph.edge(from, to, name);
  const tip = edge.points.at(-1) ?? { x: edge.x, y: edge.y };
  const head = { from: edge.points.at(-2) ?? tip, tip };
  return { points: edge.points, head, label: { x: edge.x, y: edge.y } };
};

const layoutTree = (component: ViewComponent, region: ViewRegion): Layout | null => {
  const root = buildDecisionTree(component, region);
  if (!root) return null;
  const nodes = collectNodes(root);
  const treeEdges = collectEdges(root);
  const graph = createGraph(nodes, treeEdges);
  const allTransitions = getStateTransitions(component, region.states);
  const transitions = allTransitions.filter((transition) => transition.from !== transition.to);
  const loops = allTransitions.filter((transition) => transition.from === transition.to);
  const handlersById = new Map(component.handlers.map((handler) => [handler.id, handler]));
  addTransitionEdges(graph, transitions, handlersById);
  dagre.layout(graph);
  const size = graph.graph();
  const loopEdges = layoutLoops(loops, graph, handlersById);
  return {
    width: Math.max(size.width ?? 0, ...loopEdges.map((edge) => edge.right)),
    height: size.height ?? 0,
    nodes: nodes.map((node) => ({ node, ...graph.node(node.id) })),
    edges: [
      ...loopEdges,
      ...treeEdges.map((edge, order) => ({
        id: `t${order}`,
        answer: edge.answer,
        ...readEdge(graph, edge.from, edge.to, `t${order}`),
      })),
      ...transitions.map((transition, order) => ({
        id: `a${order}`,
        transition,
        handler: handlersById.get(transition.handlerId),
        ...readEdge(graph, `leaf:${transition.from}`, `leaf:${transition.to}`, `a${order}`),
      })),
    ],
  };
};

const LOOP_BULGE = 24;
const LOOP_STEP = 10;
const LOOP_REACH = 8;

type LoopEdge = LaidOutEdge & { right: number };

const layoutLoops = (
  loops: StateTransition[],
  graph: graphlib.Graph,
  handlersById: Map<string, ViewHandler>,
): LoopEdge[] => {
  const perLeaf = new Map<number, number>();
  for (const loop of loops) perLeaf.set(loop.from, (perLeaf.get(loop.from) ?? 0) + 1);
  const seen = new Map<number, number>();
  return loops.map((loop, order) => {
    const node = graph.node(`leaf:${loop.from}`);
    const slot = seen.get(loop.from) ?? 0;
    seen.set(loop.from, slot + 1);
    const count = perLeaf.get(loop.from) ?? 1;
    const right = node.x + node.width / 2;
    const reach = LOOP_REACH + slot * 4;
    const bulge = LOOP_BULGE + slot * LOOP_STEP;
    const labelX = right + LOOP_BULGE + (count - 1) * LOOP_STEP + 10;
    const handler = handlersById.get(loop.handlerId);
    const control = { x: right + bulge, y: node.y + reach + 14 };
    const tip = { x: right, y: node.y + reach };
    return {
      id: `l${order}`,
      points: [],
      path: `M ${right} ${node.y - reach} C ${right + bulge} ${node.y - reach - 14}, ${control.x} ${control.y}, ${tip.x} ${tip.y}`,
      head: { from: control, tip },
      label: { x: labelX, y: node.y + (slot - (count - 1) / 2) * LABEL_HEIGHT },
      labelAlign: "start",
      transition: loop,
      handler,
      right: labelX + getLabelWidth(handler) + 8,
    };
  });
};

const toPath = (points: Point[]): string =>
  points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");

const EdgePath = ({ edge, component }: { edge: LaidOutEdge; component: ViewComponent }) => {
  const { colorByNodeId } = useViewer();
  const handlerId = edge.transition?.handlerId;
  const nodeId = handlerId !== undefined ? getHandlerNodeId(component, handlerId) : undefined;
  const color = nodeId ? colorByNodeId.get(nodeId) : undefined;
  const stroke = color ? getSolidColor(color) : "var(--faint)";
  const strokeWidth = edge.transition ? 1.25 : 1;
  return (
    <g opacity={edge.transition ? 0.85 : 1}>
      <path
        d={edge.path ?? toPath(edge.points)}
        fill="none"
        style={{ stroke }}
        strokeWidth={strokeWidth}
        strokeDasharray={edge.transition?.isAsync ? "4 3" : undefined}
      />
      <ArrowHead {...edge.head} color={stroke} size={6 * strokeWidth} />
    </g>
  );
};

const EdgeLabel = ({ edge, component }: { edge: LaidOutEdge; component: ViewComponent }) => {
  const handlerId = edge.transition?.handlerId;
  const nodeId = handlerId !== undefined ? getHandlerNodeId(component, handlerId) : undefined;
  return (
    <div
      className={
        edge.labelAlign === "start"
          ? "absolute -translate-y-1/2 bg-background px-0.5 whitespace-nowrap"
          : "absolute -translate-x-1/2 -translate-y-1/2 bg-background px-0.5"
      }
      style={{ left: edge.label.x, top: edge.label.y }}
    >
      {edge.handler ? (
        <Chip nodeIds={nodeId ? [nodeId] : []} canDim={false}>
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
        <Chip nodeIds={nodeId ? [nodeId] : []} canDim={false}>
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
    <div className="-mx-2 overflow-x-auto overscroll-x-contain px-2 py-2 -my-2">
      <div className="relative" style={{ width: layout.width, height: layout.height }}>
        <svg
          className="absolute inset-0"
          width={layout.width}
          height={layout.height}
          aria-hidden="true"
        >
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
    </div>
  );
};
