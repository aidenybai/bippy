import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { codeToHtml } from "shiki";
import { getLinesBox, getLocationBox, type Box } from "./code-positions";
import { getSolidColor } from "./mapping";
import type { GraphEdge, GraphNode, ViewComponent } from "./model";

interface CodePaneProps {
  component: ViewComponent;
  colorByNodeId: Map<string, string>;
  hoveredNodeId: string | null;
  onHover: (nodeId: string | null) => void;
}

interface Placed {
  node: GraphNode;
  box: Box;
  isMultiLine: boolean;
}

const ARROW_EDGE_KINDS = new Set<GraphEdge["kind"]>(["writes", "decides"]);
const BULGE = 40;

const useHighlightedSource = (source: string): string => {
  const [html, setHtml] = useState("");
  useEffect(() => {
    let isCurrent = true;
    codeToHtml(source, { lang: "tsx", theme: "github-light" }).then((result) => {
      if (isCurrent) setHtml(result);
    });
    return () => {
      isCurrent = false;
    };
  }, [source]);
  return html;
};

const measure = (container: HTMLElement, component: ViewComponent, nodeIds: Set<string>): Placed[] =>
  component.graph.nodes.flatMap((node) => {
    if (!nodeIds.has(node.id)) return [];
    const isMultiLine = node.loc.start.line !== node.loc.end.line;
    const box = isMultiLine ? getLinesBox(container, node.loc) : getLocationBox(container, node.loc);
    return box && box.height > 0 ? [{ node, box, isMultiLine }] : [];
  });

const getRightEdge = (box: Box): { x: number; y: number } => ({
  x: box.x + box.width + 2,
  y: box.y + box.height / 2,
});

const getArrowPath = (from: Box, to: Box, marginX: number): string => {
  const start = getRightEdge(from);
  const end = getRightEdge(to);
  const controlX = Math.max(marginX, Math.max(start.x, end.x) + BULGE);
  return `M ${start.x} ${start.y} C ${controlX} ${start.y}, ${controlX} ${end.y}, ${end.x + 6} ${end.y}`;
};

const isEdgeTouching = (edge: GraphEdge, nodeId: string | null): boolean =>
  nodeId !== null && (edge.from === nodeId || edge.to === nodeId);

export const CodePane = ({ component, colorByNodeId, hoveredNodeId, onHover }: CodePaneProps) => {
  const html = useHighlightedSource(component.source);
  const containerRef = useRef<HTMLDivElement>(null);
  const [placed, setPlaced] = useState<Placed[]>([]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || !html) return;
    const run = (): void => setPlaced(measure(container, component, new Set(colorByNodeId.keys())));
    run();
    document.fonts.ready.then(run);
    const observer = new ResizeObserver(run);
    observer.observe(container);
    return () => observer.disconnect();
  }, [html, component, colorByNodeId]);

  const boxes = new Map(placed.map((item) => [item.node.id, item.box]));
  const hoveredColor = hoveredNodeId ? colorByNodeId.get(hoveredNodeId) : undefined;
  const isDimmed = (nodeId: string): boolean =>
    hoveredNodeId !== null && colorByNodeId.get(nodeId) !== hoveredColor;
  const edges = component.graph.edges.filter(
    (edge) =>
      ARROW_EDGE_KINDS.has(edge.kind) &&
      boxes.has(edge.from) &&
      boxes.has(edge.to) &&
      boxes.get(edge.from)!.y !== boxes.get(edge.to)!.y,
  );
  const width = containerRef.current?.clientWidth ?? 0;
  const height = containerRef.current?.clientHeight ?? 0;

  return (
    <div
      ref={containerRef}
      className="relative min-w-0 py-1 pr-24 pl-4 [&_pre]:m-0 [&_pre]:bg-transparent! [&_pre]:font-mono [&_pre]:text-xs [&_pre]:leading-[21px] [&_pre]:whitespace-pre-wrap [&_pre]:break-words"
    >
      <div dangerouslySetInnerHTML={{ __html: html }} />
      <svg
        className="pointer-events-none absolute inset-0 overflow-hidden"
        width={width}
        height={height}
      >
        <defs>
          <marker
            id="code-head"
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
        {placed.map(({ node, box, isMultiLine }) => {
          const color = colorByNodeId.get(node.id) ?? "transparent";
          const isHovered = node.id === hoveredNodeId;
          return (
            <rect
              key={node.id}
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
              opacity={isDimmed(node.id) ? 0.25 : isMultiLine ? 0.5 : 1}
              style={{ mixBlendMode: "multiply" }}
              onMouseEnter={() => onHover(node.id)}
              onMouseLeave={() => onHover(null)}
            >
              <title>{node.label}</title>
            </rect>
          );
        })}
        {edges.map((edge) => {
          const isActive = isEdgeTouching(edge, hoveredNodeId);
          const isMuted = hoveredNodeId !== null && !isActive;
          const color = colorByNodeId.get(edge.to) ?? colorByNodeId.get(edge.from) ?? "rgba(0,0,0,0.3)";
          return (
            <path
              key={`${edge.from}-${edge.to}`}
              d={getArrowPath(boxes.get(edge.from)!, boxes.get(edge.to)!, width - 40)}
              fill="none"
              stroke={isActive ? "var(--foreground)" : getSolidColor(color)}
              strokeWidth={isActive ? 2 : 1}
              strokeDasharray={edge.kind === "writes" ? "4 3" : undefined}
              opacity={isMuted ? 0.12 : isActive ? 1 : 0.7}
              markerEnd="url(#code-head)"
            />
          );
        })}
      </svg>
    </div>
  );
};
