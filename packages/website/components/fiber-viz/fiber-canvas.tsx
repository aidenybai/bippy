import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ALTERNATE_GHOST_OFFSET_PX,
  BAILED_OUT_NODE_IDS,
  FIBER_CANVAS_HEIGHT_PX,
  FIBER_CANVAS_WIDTH_PX,
  FIBER_NODE_HEIGHT_PX,
  FIBER_NODE_WIDTH_PX,
  FIBER_VIZ_EDGES,
  FIBER_VIZ_NODES,
  LIVE_COMMIT_DURATION_MS,
  LIVE_RENDER_SEQUENCE,
  LIVE_RENDER_STEP_MS,
  MUTATED_HOST_NODE_IDS,
  RERENDERED_NODE_IDS,
  RETURN_EDGE_PATHS,
  TRAVERSAL_ORDER,
  TRAVERSAL_PAUSE_TICKS,
  TRAVERSAL_TICK_MS,
  type FiberVizEdge,
  type FiberVizMode,
  type FiberVizNode,
} from "./constants";

const nodesById = new Map<string, FiberVizNode>(
  FIBER_VIZ_NODES.map((vizNode) => [vizNode.id, vizNode]),
);

const getNode = (nodeId: string): FiberVizNode => {
  const vizNode = nodesById.get(nodeId);
  if (!vizNode) throw new Error(`unknown fiber viz node: ${nodeId}`);
  return vizNode;
};

const buildEdgePath = (edge: FiberVizEdge): string => {
  const fromNode = getNode(edge.from);
  const toNode = getNode(edge.to);
  const halfHeight = FIBER_NODE_HEIGHT_PX / 2;
  const halfWidth = FIBER_NODE_WIDTH_PX / 2;

  if (edge.kind === "child") {
    const startX = fromNode.x;
    const startY = fromNode.y + halfHeight;
    const endX = toNode.x;
    const endY = toNode.y - halfHeight;
    const bend = Math.min(18, (endY - startY) / 2);
    return `M ${startX} ${startY} C ${startX} ${startY + bend}, ${endX} ${endY - bend}, ${endX} ${endY}`;
  }

  if (edge.kind === "sibling") {
    const startX = fromNode.x + halfWidth;
    const endX = toNode.x - halfWidth;
    return `M ${startX} ${fromNode.y} L ${endX} ${toNode.y}`;
  }

  return RETURN_EDGE_PATHS[edge.id] ?? "";
};

const EDGE_KIND_COLORS: Record<FiberVizEdge["kind"], string> = {
  child: "var(--faq-icon)",
  sibling: "var(--link)",
  return: "var(--faq-icon)",
};

const PHASE_LABELS: Record<FiberVizMode, string> = {
  elements: "phase: idle (just descriptions)",
  tree: "phase: render (mount)",
  pointers: "phase: render (mount)",
  traversal: "render phase",
  alternate: "current ⇄ workInProgress",
  rerender: "phase: render (update)",
  commit: "phase: commit",
  instrument: "phase: commit → bippy",
};

const isEdgeVisible = (edge: FiberVizEdge, mode: FiberVizMode): boolean => {
  if (mode === "elements") return false;
  if (edge.kind === "child") return true;
  return mode === "pointers" || mode === "traversal";
};

type LiveCyclePhase = "idle" | "render" | "commit";

interface LiveRenderCycle {
  displayedCount: number;
  phase: LiveCyclePhase;
  renderingNodeId: string | null;
  renderedNodeIds: string[];
  triggerUpdate: () => void;
}

const useLiveRenderCycle = (): LiveRenderCycle => {
  const [displayedCount, setDisplayedCount] = useState(0);
  const [phase, setPhase] = useState<LiveCyclePhase>("idle");
  const [renderStepIndex, setRenderStepIndex] = useState(0);

  useEffect(() => {
    if (phase !== "render") return;
    if (renderStepIndex >= LIVE_RENDER_SEQUENCE.length) {
      setDisplayedCount((previousCount) => previousCount + 1);
      setPhase("commit");
      return;
    }
    const timeoutId = window.setTimeout(() => {
      setRenderStepIndex((previousIndex) => previousIndex + 1);
    }, LIVE_RENDER_STEP_MS);
    return () => window.clearTimeout(timeoutId);
  }, [phase, renderStepIndex]);

  useEffect(() => {
    if (phase !== "commit") return;
    const timeoutId = window.setTimeout(() => setPhase("idle"), LIVE_COMMIT_DURATION_MS);
    return () => window.clearTimeout(timeoutId);
  }, [phase]);

  const triggerUpdate = () => {
    if (phase !== "idle") return;
    setRenderStepIndex(0);
    setPhase("render");
  };

  const renderingNodeId =
    phase === "render" && renderStepIndex < LIVE_RENDER_SEQUENCE.length
      ? LIVE_RENDER_SEQUENCE[renderStepIndex]
      : null;
  const renderedNodeIds =
    phase === "render"
      ? LIVE_RENDER_SEQUENCE.slice(0, renderStepIndex + 1)
      : phase === "commit"
        ? LIVE_RENDER_SEQUENCE
        : [];

  return { displayedCount, phase, renderingNodeId, renderedNodeIds, triggerUpdate };
};

const useTraversalIndex = (isTraversing: boolean): number => {
  const [traversalTick, setTraversalTick] = useState(0);

  useEffect(() => {
    if (!isTraversing) return;
    setTraversalTick(0);
    const intervalId = window.setInterval(() => {
      setTraversalTick(
        (previousTick) => (previousTick + 1) % (TRAVERSAL_ORDER.length + TRAVERSAL_PAUSE_TICKS),
      );
    }, TRAVERSAL_TICK_MS);
    return () => window.clearInterval(intervalId);
  }, [isTraversing]);

  return traversalTick;
};

interface FiberNodeBoxProps {
  vizNode: FiberVizNode;
  label: string;
  tag: string;
  isHighlighted: boolean;
  isDimmed: boolean;
  isClickable: boolean;
  appearDelaySeconds: number;
  onHoverChange: (nodeId: string | null) => void;
  onNodeClick?: () => void;
}

const FiberNodeBox = ({
  vizNode,
  label,
  tag,
  isHighlighted,
  isDimmed,
  isClickable,
  appearDelaySeconds,
  onHoverChange,
  onNodeClick,
}: FiberNodeBoxProps) => (
  <motion.g
    initial={{ opacity: 0, scale: 0.92 }}
    animate={{ opacity: isDimmed ? 0.35 : 1, scale: 1 }}
    transition={{ duration: 0.35, delay: appearDelaySeconds }}
    className={isClickable ? "cursor-pointer" : undefined}
    onPointerEnter={() => onHoverChange(vizNode.id)}
    onPointerLeave={() => onHoverChange(null)}
    onClick={onNodeClick}
  >
    <rect
      x={vizNode.x - FIBER_NODE_WIDTH_PX / 2}
      y={vizNode.y - FIBER_NODE_HEIGHT_PX / 2}
      width={FIBER_NODE_WIDTH_PX}
      height={FIBER_NODE_HEIGHT_PX}
      rx={10}
      fill="var(--button)"
      stroke={isHighlighted ? "var(--link)" : "var(--border)"}
      strokeWidth={isHighlighted ? 1.5 : 1}
    />
    <text
      x={vizNode.x}
      y={vizNode.y - 2}
      textAnchor="middle"
      fontSize={13}
      fontWeight={600}
      fill="var(--foreground)"
      fontFamily="var(--font-sans-value)"
      style={{ pointerEvents: "none" }}
    >
      {label}
    </text>
    <text
      x={vizNode.x}
      y={vizNode.y + 13}
      textAnchor="middle"
      fontSize={8.5}
      fill={tag === "bailout" ? "var(--faq-icon)" : "var(--soft-foreground)"}
      fontFamily="var(--font-mono-value)"
      style={{ pointerEvents: "none" }}
    >
      {tag}
    </text>
  </motion.g>
);

interface FiberCanvasProps {
  mode: FiberVizMode;
}

export const FiberCanvas = ({ mode }: FiberCanvasProps) => {
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const liveCycle = useLiveRenderCycle();
  const isLiveCycleActive = liveCycle.phase !== "idle";

  const traversalTick = useTraversalIndex(mode === "traversal" && !isLiveCycleActive);
  const traversalNodeId =
    mode === "traversal" && !isLiveCycleActive && traversalTick < TRAVERSAL_ORDER.length
      ? TRAVERSAL_ORDER[traversalTick]
      : null;
  const cursorNodeId = liveCycle.renderingNodeId ?? traversalNodeId;
  const cursorNode = cursorNodeId ? getNode(cursorNodeId) : null;

  const showsBanner = mode === "commit" || mode === "instrument" || liveCycle.phase === "commit";
  const showsBailouts = mode === "rerender" || liveCycle.phase === "render";

  const visibleEdges = FIBER_VIZ_EDGES.filter(
    (edge) => isEdgeVisible(edge, mode) || edge.from === hoveredNodeId,
  );

  return (
    <div className="flex flex-col gap-2">
      <svg
        viewBox={`0 0 ${FIBER_CANVAS_WIDTH_PX} ${FIBER_CANVAS_HEIGHT_PX}`}
        className="h-auto w-full"
        role="img"
        aria-label="interactive visualization of a react fiber tree"
      >
        <defs>
          <marker
            id="fiber-arrow-child"
            viewBox="0 0 8 8"
            refX="7"
            refY="4"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M 0 0.8 L 7.2 4 L 0 7.2 z" fill="var(--faq-icon)" />
          </marker>
          <marker
            id="fiber-arrow-sibling"
            viewBox="0 0 8 8"
            refX="7"
            refY="4"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M 0 0.8 L 7.2 4 L 0 7.2 z" fill="var(--link)" />
          </marker>
        </defs>

        {mode === "alternate" && (
          <motion.g
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4 }}
          >
            {FIBER_VIZ_NODES.map((vizNode) => (
              <rect
                key={`ghost-${vizNode.id}`}
                x={vizNode.x - FIBER_NODE_WIDTH_PX / 2 + ALTERNATE_GHOST_OFFSET_PX}
                y={vizNode.y - FIBER_NODE_HEIGHT_PX / 2 - ALTERNATE_GHOST_OFFSET_PX}
                width={FIBER_NODE_WIDTH_PX}
                height={FIBER_NODE_HEIGHT_PX}
                rx={10}
                fill="none"
                stroke="var(--faq-icon)"
                strokeDasharray="3 3"
                strokeWidth={1}
              />
            ))}
          </motion.g>
        )}

        <AnimatePresence>
          {visibleEdges.map((edge) => {
            const isFromHoveredNode = edge.from === hoveredNodeId;
            const edgeOpacity = hoveredNodeId
              ? isFromHoveredNode
                ? 1
                : 0.2
              : edge.kind === "return"
                ? 0.8
                : 1;
            return (
              <motion.path
                key={edge.id}
                d={buildEdgePath(edge)}
                fill="none"
                stroke={isFromHoveredNode ? "var(--link)" : EDGE_KIND_COLORS[edge.kind]}
                strokeWidth={isFromHoveredNode ? 1.8 : edge.kind === "sibling" ? 1.4 : 1.2}
                strokeDasharray={edge.kind === "return" ? "4 4" : undefined}
                markerEnd={
                  edge.kind === "sibling" || isFromHoveredNode
                    ? "url(#fiber-arrow-sibling)"
                    : "url(#fiber-arrow-child)"
                }
                initial={{ pathLength: 0, opacity: 0 }}
                animate={{ pathLength: 1, opacity: edgeOpacity }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.4 }}
              />
            );
          })}
        </AnimatePresence>

        {hoveredNodeId &&
          FIBER_VIZ_EDGES.filter((edge) => edge.from === hoveredNodeId).map((edge) => {
            const toNode = getNode(edge.to);
            const fromNode = getNode(edge.from);
            const labelX = (fromNode.x + toNode.x) / 2;
            const labelY = (fromNode.y + toNode.y) / 2 - 6;
            return (
              <text
                key={`pointer-label-${edge.id}`}
                x={labelX}
                y={labelY}
                textAnchor="middle"
                fontSize={9}
                fill="var(--link)"
                fontFamily="var(--font-mono-value)"
                style={{ pointerEvents: "none" }}
              >
                {edge.kind}
              </text>
            );
          })}

        {FIBER_VIZ_NODES.map((vizNode, nodeIndex) => {
          const isBailedOut = showsBailouts && BAILED_OUT_NODE_IDS.includes(vizNode.id);
          const isModeHighlighted =
            (mode === "rerender" || mode === "instrument") &&
            RERENDERED_NODE_IDS.includes(vizNode.id);
          const isModeMutated =
            (mode === "commit" || mode === "instrument") &&
            MUTATED_HOST_NODE_IDS.includes(vizNode.id);
          const isLiveHighlighted = liveCycle.renderedNodeIds.includes(vizNode.id);
          const label =
            vizNode.id === "count-text" ? `"${liveCycle.displayedCount}"` : vizNode.label;

          return (
            <FiberNodeBox
              key={vizNode.id}
              vizNode={vizNode}
              label={label}
              tag={isBailedOut ? "bailout" : vizNode.tag}
              isHighlighted={
                isModeHighlighted ||
                isModeMutated ||
                isLiveHighlighted ||
                vizNode.id === cursorNodeId ||
                vizNode.id === hoveredNodeId
              }
              isDimmed={isBailedOut}
              isClickable={vizNode.id === "button"}
              appearDelaySeconds={mode === "elements" ? nodeIndex * 0.07 : 0}
              onHoverChange={setHoveredNodeId}
              onNodeClick={vizNode.id === "button" ? liveCycle.triggerUpdate : undefined}
            />
          );
        })}

        {cursorNode && (
          <motion.rect
            width={FIBER_NODE_WIDTH_PX + 10}
            height={FIBER_NODE_HEIGHT_PX + 10}
            rx={13}
            fill="none"
            stroke="var(--link)"
            strokeWidth={1.5}
            style={{ pointerEvents: "none" }}
            initial={false}
            animate={{
              x: cursorNode.x - FIBER_NODE_WIDTH_PX / 2 - 5,
              y: cursorNode.y - FIBER_NODE_HEIGHT_PX / 2 - 5,
            }}
            transition={{ type: "spring", stiffness: 260, damping: 26 }}
          />
        )}

        {showsBanner && (
          <motion.g
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
          >
            <rect
              x={10}
              y={FIBER_CANVAS_HEIGHT_PX - 34}
              width={mode === "instrument" ? 300 : 268}
              height={24}
              rx={7}
              fill="var(--button)"
              stroke="var(--link)"
              strokeWidth={1}
            />
            {mode === "instrument" && (
              <image
                href="/bippy.png"
                x={16}
                y={FIBER_CANVAS_HEIGHT_PX - 31}
                width={18}
                height={18}
              />
            )}
            <text
              x={mode === "instrument" ? 40 : 20}
              y={FIBER_CANVAS_HEIGHT_PX - 18}
              fontSize={10}
              fill="var(--foreground)"
              fontFamily="var(--font-mono-value)"
            >
              {mode === "instrument"
                ? "bippy ← onCommitFiberRoot(rendererID, root)"
                : "onCommitFiberRoot(rendererID, root)"}
            </text>
          </motion.g>
        )}
      </svg>

      <div className="flex min-h-5 min-w-0 items-center justify-between gap-3 overflow-hidden">
        <span className="shrink-0 whitespace-nowrap font-mono text-[10px] text-soft-foreground">
          {liveCycle.phase === "render"
            ? "phase: render (update)"
            : liveCycle.phase === "commit"
              ? "phase: commit"
              : PHASE_LABELS[mode]}
        </span>
        {liveCycle.phase === "render" ? (
          <span className="truncate text-right font-mono text-[10px] text-link">
            setCount({liveCycle.displayedCount + 1})
          </span>
        ) : liveCycle.phase === "commit" ? (
          <span className="truncate text-right font-mono text-[10px] text-link">dom mutated</span>
        ) : mode === "pointers" ? (
          <span className="flex items-center gap-3 font-mono text-[10px] text-soft-foreground">
            <span className="flex items-center gap-1">
              <span className="inline-block h-px w-4 bg-faq-icon" /> child
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-px w-4 bg-link" /> sibling
            </span>
            <span className="flex items-center gap-1">
              <span
                className="inline-block h-px w-4"
                style={{
                  backgroundImage:
                    "linear-gradient(to right, var(--faq-icon) 50%, transparent 50%)",
                  backgroundSize: "6px 1px",
                }}
              />{" "}
              return
            </span>
          </span>
        ) : mode === "traversal" ? (
          <span className="truncate text-right font-mono text-[10px] text-link">
            {cursorNode ? `beginWork(${cursorNode.label})` : "yield"}
          </span>
        ) : (
          <span className="truncate text-right font-mono text-[10px] text-faq-icon">
            hover fibers · click +1
          </span>
        )}
      </div>
    </div>
  );
};
