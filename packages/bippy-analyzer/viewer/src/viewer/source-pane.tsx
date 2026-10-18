import { useCallback, useMemo, useRef, useState, type MouseEvent } from "react";
import { preloadHighlighter } from "@pierre/diffs";
import { File, type FileOptions } from "@pierre/diffs/react";
import { useQuery } from "@tanstack/react-query";
import { useTokenBoxes, type PlacedToken } from "../hooks/use-token-boxes";
import { getComponentAtLine, getSolidColor } from "../lib/analysis";
import { getLineFromEvent, type Box } from "../lib/positions";
import type { GraphEdge } from "../model";
import { Tooltip, TooltipContent } from "@/components/ui/tooltip";
import { useIsDimmed, useIsInactive, useLoadedView, useNodeColor, useViewer } from "./context";

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

interface TokenVisibility {
  isDimmed: boolean;
  isInactive: boolean;
  isMultiLine: boolean;
}

const getTokenOpacity = ({ isDimmed, isInactive, isMultiLine }: TokenVisibility): number => {
  if (isDimmed) return 0.25;
  if (isInactive) return 0.4;
  return isMultiLine ? 0.5 : 1;
};

interface Anchor {
  nodeId: string;
  element: Element;
}

interface TokenMarkProps extends PlacedToken {
  onEnter: (anchor: Anchor) => void;
}

const TokenMark = ({ node, box, isMultiLine, onEnter }: TokenMarkProps) => {
  const { hoveredNodeId, hover } = useViewer();
  const color = useNodeColor(node.id) ?? "transparent";
  const isDimmed = useIsDimmed(node.id);
  const isInactive = useIsInactive(node.id);
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
      opacity={getTokenOpacity({ isDimmed, isInactive, isMultiLine })}
      style={{ mixBlendMode: "multiply" }}
      onMouseEnter={(event) => {
        hover(node.id);
        onEnter({ nodeId: node.id, element: event.currentTarget });
      }}
      onMouseLeave={() => hover(null)}
    />
  );
};

interface ArcProps {
  edge: GraphEdge;
  from: Box;
  to: Box;
  marginX: number;
}

const Arc = ({ edge, from, to, marginX }: ArcProps) => {
  const { hoveredNodeId, colorByNodeId } = useViewer();
  const isInactive = useIsInactive(edge.from);
  const color = colorByNodeId.get(edge.to) ?? colorByNodeId.get(edge.from) ?? "rgba(0, 0, 0, 0.3)";
  const isActive = hoveredNodeId === edge.from || hoveredNodeId === edge.to;
  const isMuted = (hoveredNodeId !== null && !isActive) || isInactive;
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

const THEME = "github-light";

const FILE_OPTIONS: FileOptions<undefined, undefined> = {
  theme: THEME,
  overflow: "wrap",
  disableFileHeader: true,
  disableErrorHandling: true,
  preferredHighlighter: "shiki-js",
};

const useHighlighter = (): boolean =>
  useQuery({
    queryKey: ["highlighter", THEME],
    queryFn: async () => {
      await preloadHighlighter({
        themes: [THEME],
        langs: ["tsx", "ts", "jsx", "js"],
        preferredHighlighter: "shiki-js",
      });
      return true;
    },
    staleTime: Infinity,
  }).isSuccess;

const useActivateAtPointer = (): ((event: MouseEvent) => void) => {
  const view = useLoadedView();
  const { activate } = useViewer();
  return useCallback(
    (event: MouseEvent) => {
      const line = getLineFromEvent(event.nativeEvent);
      const component = line === null ? null : getComponentAtLine(view, line);
      if (component) activate(component.name);
    },
    [view, activate],
  );
};

const TokenTooltip = ({ anchor }: { anchor: Anchor | null }) => {
  const { hoveredNode } = useViewer();
  const isOpen = anchor !== null && hoveredNode !== null && hoveredNode.id === anchor.nodeId;
  return (
    <Tooltip open={isOpen}>
      <TooltipContent anchor={anchor?.element} className="font-mono">
        {hoveredNode?.label}
      </TooltipContent>
    </Tooltip>
  );
};

export const SourcePane = () => {
  const view = useLoadedView();
  const isHighlighterReady = useHighlighter();
  const { colorByNodeId } = useViewer();
  const activateAtPointer = useActivateAtPointer();
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [renderCount, setRenderCount] = useState(0);
  const onPostRender = useCallback(() => setRenderCount((count) => count + 1), []);
  const options = useMemo(() => ({ ...FILE_OPTIONS, onPostRender }), [onPostRender]);
  const file = useMemo(
    () => ({ name: view.file.split("/").at(-1) ?? view.file, contents: view.source }),
    [view],
  );
  const coloredNodes = useMemo(
    () =>
      view.components
        .flatMap((component) => component.graph.nodes)
        .filter((node) => colorByNodeId.has(node.id)),
    [view, colorByNodeId],
  );
  const layout = useTokenBoxes(wrapperRef, coloredNodes, renderCount);
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
      view.components
        .flatMap((component) => component.graph.edges)
        .filter((edge) => {
          const from = boxes.get(edge.from);
          const to = boxes.get(edge.to);
          return (
            ARC_EDGE_KINDS.has(edge.kind) &&
            from !== undefined &&
            to !== undefined &&
            from.y !== to.y
          );
        }),
    [view, boxes],
  );

  return (
    <div className="overflow-y-auto overflow-x-hidden">
      <div
        ref={wrapperRef}
        onMouseMove={activateAtPointer}
        className="relative min-w-0 py-1 pr-24 text-[13px]/[19px]"
      >
        {isHighlighterReady && <File file={file} options={options} disableWorkerPool />}
        <svg
          className="pointer-events-none absolute inset-0 overflow-hidden"
          width={layout.width}
          height={layout.height}
        >
          <ArcHead />
          {layout.tokens.map((token) => (
            <TokenMark key={token.node.id} {...token} onEnter={setAnchor} />
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
        <TokenTooltip anchor={anchor} />
      </div>
    </div>
  );
};
