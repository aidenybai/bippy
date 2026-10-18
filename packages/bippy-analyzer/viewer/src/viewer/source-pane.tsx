import { useCallback, useMemo, useRef, useState, type MouseEvent } from "react";
import { File, type FileOptions } from "@pierre/diffs/react";
import { getCodeTheme, useHighlighter } from "../hooks/use-highlighter";
import { useTheme } from "../hooks/use-theme";
import { useTokenBoxes, type PlacedToken } from "../hooks/use-token-boxes";
import { getComponentAtLine, getSolidColor } from "../lib/analysis";
import { describeNode } from "../lib/describe";
import { getLineFromEvent, type Box } from "../lib/positions";
import type { GraphEdge } from "../model";
import { Tooltip, TooltipContent } from "@/components/ui/tooltip";
import { useIsDimmed, useIsInactive, useLoadedView, useNodeColor, useViewer } from "./context";

const ARC_EDGE_KINDS = new Set<GraphEdge["kind"]>(["writes", "decides"]);
const MIN_BOW = 16;

const getAnchor = (box: Box, side: "top" | "bottom"): { x: number; y: number } => ({
  x: box.x + box.width / 2,
  y: side === "top" ? box.y : box.y + box.height,
});

const getArcPath = (from: Box, to: Box): string => {
  const isGoingDown = to.y > from.y;
  const start = getAnchor(from, isGoingDown ? "bottom" : "top");
  const end = getAnchor(to, isGoingDown ? "top" : "bottom");
  const bow = Math.max(MIN_BOW, Math.abs(end.y - start.y) / 2) * (isGoingDown ? 1 : -1);
  return `M ${start.x} ${start.y} C ${start.x} ${start.y + bow}, ${end.x} ${end.y - bow}, ${end.x} ${end.y}`;
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
  const { theme } = useTheme();
  const color = useNodeColor(node.id) ?? "transparent";
  const isDimmed = useIsDimmed([node.id]);
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
      style={{ mixBlendMode: theme === "dark" ? "screen" : "multiply" }}
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
}

const Arc = ({ edge, from, to }: ArcProps) => {
  const { causalNodeIds, colorByNodeId } = useViewer();
  const isInactive = useIsInactive(edge.from);
  const color = colorByNodeId.get(edge.to) ?? colorByNodeId.get(edge.from) ?? "rgba(0, 0, 0, 0.3)";
  const isActive =
    causalNodeIds !== null && causalNodeIds.has(edge.from) && causalNodeIds.has(edge.to);
  const isMuted = (causalNodeIds !== null && !isActive) || isInactive;
  return (
    <path
      d={getArcPath(from, to)}
      fill="none"
      stroke={getSolidColor(color)}
      strokeWidth={isActive ? 1.75 : 1}
      strokeDasharray={edge.kind === "writes" ? "4 3" : undefined}
      opacity={isMuted ? 0.1 : isActive ? 1 : 0.55}
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

const FILE_OPTIONS: Omit<FileOptions<undefined, undefined>, "theme"> = {
  overflow: "wrap",
  unsafeCSS:
    ":host { background-color: transparent; --diffs-bg: transparent; } [data-gutter], [data-column-number] { background: transparent; }",
  disableFileHeader: true,
  disableErrorHandling: true,
  preferredHighlighter: "shiki-js",
};

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
  const view = useLoadedView();
  const isOpen = anchor !== null && hoveredNode !== null && hoveredNode.id === anchor.nodeId;
  return (
    <Tooltip open={isOpen}>
      <TooltipContent anchor={anchor?.element} className="font-mono">
        {hoveredNode && describeNode(view, hoveredNode)}
      </TooltipContent>
    </Tooltip>
  );
};

export const SourcePane = () => {
  const view = useLoadedView();
  const isHighlighterReady = useHighlighter() !== null;
  const { colorByNodeId, causalNodeIds } = useViewer();
  const activateAtPointer = useActivateAtPointer();
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [renderCount, setRenderCount] = useState(0);
  const onPostRender = useCallback(() => setRenderCount((count) => count + 1), []);
  const { theme } = useTheme();
  const options = useMemo<FileOptions<undefined, undefined>>(
    () => ({ ...FILE_OPTIONS, theme: getCodeTheme(theme), onPostRender }),
    [theme, onPostRender],
  );
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
          if (from === undefined || to === undefined || from.y === to.y) return false;
          if (ARC_EDGE_KINDS.has(edge.kind)) return true;
          return (
            causalNodeIds !== null && causalNodeIds.has(edge.from) && causalNodeIds.has(edge.to)
          );
        }),
    [view, boxes, causalNodeIds],
  );

  return (
    <div className="overflow-y-auto overflow-x-hidden">
      <div
        ref={wrapperRef}
        onMouseMove={activateAtPointer}
        className="relative min-w-0 py-1 pr-8 text-[13px]/[19px]"
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
            />
          ))}
        </svg>
        <TokenTooltip anchor={anchor} />
      </div>
    </div>
  );
};
