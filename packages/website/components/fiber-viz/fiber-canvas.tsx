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
  MUTATED_HOST_NODE_IDS,
  RERENDERED_NODE_IDS,
  RETURN_EDGE_PATHS,
  TRAVERSAL_ORDER,
  TRAVERSAL_PAUSE_TICKS,
  TRAVERSAL_TICK_MS,
  type FiberVizEdge,
  type FiberVizNode,
} from "./constants";
import type { FiberVizMode } from "./steps";

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
  traversal: "phase: render, one unit at a time",
  alternate: "current ⇄ workInProgress",
  rerender: "phase: render (update)",
  commit: "phase: commit",
  instrument: "phase: commit → bippy",
};

const isEdgeVisible = (edge: FiberVizEdge, mode: FiberVizMode): boolean => {
  if (mode === "elements") return false;
  if (edge.kind === "child") return true;
  if (edge.kind === "sibling") return mode === "pointers" || mode === "traversal";
  return mode === "pointers" || mode === "traversal";
};

const showsUpdatedCount = (mode: FiberVizMode): boolean =>
  mode === "rerender" || mode === "commit" || mode === "instrument";

interface FiberCanvasProps {
  mode: FiberVizMode;
}

const useTraversalIndex = (mode: FiberVizMode): number => {
  const [traversalTick, setTraversalTick] = useState(0);
  const isTraversing = mode === "traversal";

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
  mode: FiberVizMode;
  nodeIndex: number;
  isTraversalTarget: boolean;
}

const FiberNodeBox = ({ vizNode, mode, nodeIndex, isTraversalTarget }: FiberNodeBoxProps) => {
  const isBailedOut = mode === "rerender" && BAILED_OUT_NODE_IDS.includes(vizNode.id);
  const isRerendered =
    (mode === "rerender" || mode === "instrument") && RERENDERED_NODE_IDS.includes(vizNode.id);
  const isMutatedHost =
    (mode === "commit" || mode === "instrument") && MUTATED_HOST_NODE_IDS.includes(vizNode.id);
  const isHighlighted = isRerendered || isMutatedHost || isTraversalTarget;

  const label = vizNode.id === "count-text" && showsUpdatedCount(mode) ? '"1"' : vizNode.label;
  const tag = isBailedOut ? "bailout" : vizNode.tag;

  return (
    <motion.g
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: isBailedOut ? 0.35 : 1, scale: 1 }}
      transition={{ duration: 0.35, delay: mode === "elements" ? nodeIndex * 0.07 : 0 }}
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
      >
        {label}
      </text>
      <text
        x={vizNode.x}
        y={vizNode.y + 13}
        textAnchor="middle"
        fontSize={8.5}
        fill={isBailedOut ? "var(--faq-icon)" : "var(--soft-foreground)"}
        fontFamily="var(--font-mono-value)"
      >
        {tag}
      </text>
    </motion.g>
  );
};

export const FiberCanvas = ({ mode }: FiberCanvasProps) => {
  const traversalTick = useTraversalIndex(mode);
  const traversalNodeId =
    mode === "traversal" && traversalTick < TRAVERSAL_ORDER.length
      ? TRAVERSAL_ORDER[traversalTick]
      : null;
  const traversalNode = traversalNodeId ? getNode(traversalNodeId) : null;

  return (
    <div className="flex flex-col gap-2">
      <svg
        viewBox={`0 0 ${FIBER_CANVAS_WIDTH_PX} ${FIBER_CANVAS_HEIGHT_PX}`}
        className="h-auto w-full"
        role="img"
        aria-label="animated visualization of a react fiber tree"
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
          {FIBER_VIZ_EDGES.filter((edge) => isEdgeVisible(edge, mode)).map((edge) => (
            <motion.path
              key={edge.id}
              d={buildEdgePath(edge)}
              fill="none"
              stroke={EDGE_KIND_COLORS[edge.kind]}
              strokeWidth={edge.kind === "sibling" ? 1.4 : 1.2}
              strokeDasharray={edge.kind === "return" ? "4 4" : undefined}
              markerEnd={
                edge.kind === "sibling" ? "url(#fiber-arrow-sibling)" : "url(#fiber-arrow-child)"
              }
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: edge.kind === "return" ? 0.8 : 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.5 }}
            />
          ))}
        </AnimatePresence>

        {FIBER_VIZ_NODES.map((vizNode, nodeIndex) => (
          <FiberNodeBox
            key={vizNode.id}
            vizNode={vizNode}
            mode={mode}
            nodeIndex={nodeIndex}
            isTraversalTarget={vizNode.id === traversalNodeId}
          />
        ))}

        {traversalNode && (
          <motion.rect
            width={FIBER_NODE_WIDTH_PX + 10}
            height={FIBER_NODE_HEIGHT_PX + 10}
            rx={13}
            fill="none"
            stroke="var(--link)"
            strokeWidth={1.5}
            initial={false}
            animate={{
              x: traversalNode.x - FIBER_NODE_WIDTH_PX / 2 - 5,
              y: traversalNode.y - FIBER_NODE_HEIGHT_PX / 2 - 5,
            }}
            transition={{ type: "spring", stiffness: 260, damping: 26 }}
          />
        )}

        {(mode === "commit" || mode === "instrument") && (
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

      <div className="flex min-h-5 items-center justify-between gap-3">
        <span className="font-mono text-[11px] text-soft-foreground">{PHASE_LABELS[mode]}</span>
        {mode === "pointers" && (
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
        )}
        {mode === "traversal" && traversalNode && (
          <span className="font-mono text-[11px] text-link">beginWork({traversalNode.label})</span>
        )}
      </div>
    </div>
  );
};
