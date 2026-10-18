import { useMemo, useRef } from "react";
import { useHighlightedCode } from "../hooks/use-highlighted-code";
import { useTokenBoxes, type PlacedToken } from "../hooks/use-token-boxes";
import { getSolidColor } from "../lib/analysis";
import type { Box } from "../lib/positions";
import type { GraphEdge } from "../model";
import { useIsDimmed, useNodeColor, useViewer } from "./context";

const ARC_EDGE_KINDS = new Set<GraphEdge["kind"]>(["writes", "decides"]);
const ARC_BULGE = 40;
const ARC_MARGIN = 40;

const getRightEdge = (box: Box): { x: number; y: number } => ({
  x: box.x + box.width + 2,
  y: box.y + box.height / 2,
});

const getArcPath = (from: Box, to: Box, marginX: number): string => {
  const start = getRightEdge(from);
  const end = getRightEdge(to);
  const controlX = Math.max(marginX, Math.max(start.x, end.x) + ARC_BULGE);
  return `M ${start.x} ${start.y} C ${controlX} ${start.y}, ${controlX} ${end.y}, ${end.x + 6} ${end.y}`;
};

const TokenMark = ({ node, box, isMultiLine }: PlacedToken) => {
  const { hoveredNodeId, hover } = useViewer();
  const color = useNodeColor(node.id) ?? "transparent";
  const isDimmed = useIsDimmed(node.id);
  const isHovered = node.id === hoveredNodeId;
  return (
    <rect
      data-node={node.id}
      className="pointer-events-auto cursor-default"
      x={isMultiLine ? box.x - 8 : box.x - 2}
      y={box.y + 1}
      width={isMultiLine ? 3 : box.width + 4}
      height={box.height - 2}
      rx={isMultiLine ? 1.5 : 2}
      fill={isMultiLine ? getSolidColor(color) : color}
      stroke={isHovered ? getSolidColor(color) : "none"}
      strokeWidth={2}
      opacity={isDimmed ? 0.25 : isMultiLine ? 0.5 : 1}
      style={{ mixBlendMode: "multiply" }}
      onMouseEnter={() => hover(node.id)}
      onMouseLeave={() => hover(null)}
    >
      <title>{node.label}</title>
    </rect>
  );
};

interface ArcProps {
  edge: GraphEdge;
  from: Box;
  to: Box;
  marginX: number;
}

const Arc = ({ edge, from, to, marginX }: ArcProps) => {
  const { hoveredNodeId } = useViewer();
  const color = useNodeColor(edge.to) ?? useNodeColor(edge.from) ?? "rgba(0, 0, 0, 0.3)";
  const isActive = hoveredNodeId === edge.from || hoveredNodeId === edge.to;
  const isMuted = hoveredNodeId !== null && !isActive;
  return (
    <path
      d={getArcPath(from, to, marginX)}
      fill="none"
      stroke={isActive ? "var(--foreground)" : getSolidColor(color)}
      strokeWidth={isActive ? 2 : 1}
      strokeDasharray={edge.kind === "writes" ? "4 3" : undefined}
      opacity={isMuted ? 0.12 : isActive ? 1 : 0.7}
      markerEnd="url(#arc-head)"
    />
  );
};

const ArcHead = () => (
  <defs>
    <marker
      id="arc-head"
      viewBox="0 0 10 10"
      refX="10"
      refY="5"
      markerWidth="7"
      markerHeight="7"
      orient="auto"
    >
      <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
    </marker>
  </defs>
);

export const SourcePane = () => {
  const { component, colorByNodeId } = useViewer();
  const code = useHighlightedCode(component.source);
  const containerRef = useRef<HTMLDivElement>(null);
  const coloredNodes = useMemo(
    () => component.graph.nodes.filter((node) => colorByNodeId.has(node.id)),
    [component, colorByNodeId],
  );
  const layout = useTokenBoxes(containerRef, coloredNodes, code !== null);
  const boxes = useMemo(
    () =>
      new Map(
        layout.tokens
          .filter((token) => !token.isMultiLine)
          .map((token) => [token.node.id, token.box]),
      ),
    [layout],
  );
  const arcs = useMemo(
    () =>
      component.graph.edges.filter((edge) => {
        const from = boxes.get(edge.from);
        const to = boxes.get(edge.to);
        return (
          ARC_EDGE_KINDS.has(edge.kind) && from !== undefined && to !== undefined && from.y !== to.y
        );
      }),
    [component, boxes],
  );

  return (
    <div className="overflow-y-auto overflow-x-hidden border-r">
      <div
        ref={containerRef}
        className="relative min-w-0 py-1 pr-24 pl-4 [&_pre]:m-0 [&_pre]:bg-transparent! [&_pre]:font-mono [&_pre]:text-[13px] [&_pre]:leading-[19px] [&_pre]:break-words [&_pre]:whitespace-pre-wrap"
      >
        {code}
        <svg
          className="pointer-events-none absolute inset-0 overflow-hidden"
          width={layout.width}
          height={layout.height}
        >
          <ArcHead />
          {layout.tokens.map((token) => (
            <TokenMark key={token.node.id} {...token} />
          ))}
          {arcs.map((edge) => (
            <Arc
              key={`${edge.from}-${edge.to}`}
              edge={edge}
              from={boxes.get(edge.from)!}
              to={boxes.get(edge.to)!}
              marginX={layout.width - ARC_MARGIN}
            />
          ))}
        </svg>
      </div>
    </div>
  );
};
