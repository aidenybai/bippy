import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { codeToHtml } from "shiki";
import { DiagramCanvas, DiagramEdge } from "diagram";
import { getLinesBox, getLocationBox, type Box } from "./code-positions";
import { getRelatedNodeIds, getRoleLabel, indexGraph } from "./hover-model";
import type { GraphNode, ViewComponent, ViewLocation, ViewState } from "./model";
import { getArmMarks, type ArmMark } from "./state-model";

interface CodeViewProps {
  component: ViewComponent;
  selectedState: ViewState | null;
  hoveredNodeId: string | null;
  onHoverNode: (nodeId: string | null) => void;
}

interface PlacedNode {
  node: GraphNode;
  box: Box;
  isMultiLine: boolean;
}

interface Overlay {
  width: number;
  height: number;
  arms: Array<ArmMark & { box: Box; isSingleLine: boolean }>;
  placed: PlacedNode[];
}

const MAX_WHOLE_FILE_LINES = 60;
const GUTTER_WIDTH = 16;

const ARM_FILLS: Record<ArmMark["status"], string> = {
  live: "color-mix(in oklab, var(--primary) 10%, transparent)",
  dead: "color-mix(in oklab, var(--destructive) 8%, transparent)",
  added: "color-mix(in oklab, var(--primary) 18%, transparent)",
  removed: "color-mix(in oklab, var(--destructive) 16%, transparent)",
  unchanged: "transparent",
};

const NODE_FILLS: Record<GraphNode["kind"], string> = {
  trigger: "color-mix(in oklab, var(--primary) 16%, transparent)",
  handler: "transparent",
  write: "color-mix(in oklab, var(--destructive) 16%, transparent)",
  binding: "color-mix(in oklab, var(--primary) 12%, transparent)",
  read: "color-mix(in oklab, var(--primary) 12%, transparent)",
  branch: "color-mix(in oklab, var(--foreground) 10%, transparent)",
  arm: "color-mix(in oklab, var(--primary) 8%, transparent)",
};

const HIT_ORDER: GraphNode["kind"][] = [
  "handler",
  "arm",
  "trigger",
  "branch",
  "write",
  "read",
  "binding",
];

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

const getComponentSource = (component: ViewComponent): { source: string; lineOffset: number } => {
  const lines = component.source.split("\n");
  if (!component.loc || lines.length <= MAX_WHOLE_FILE_LINES)
    return { source: component.source, lineOffset: 0 };
  const firstLine = component.loc.start.line;
  return {
    source: lines.slice(firstLine - 1, component.loc.end.line).join("\n"),
    lineOffset: firstLine - 1,
  };
};

const shiftLocation = (loc: ViewLocation, lineOffset: number): ViewLocation => ({
  start: { ...loc.start, line: loc.start.line - lineOffset },
  end: { ...loc.end, line: loc.end.line - lineOffset },
});

const measureOverlay = (
  container: HTMLElement,
  component: ViewComponent,
  selectedState: ViewState | null,
  lineOffset: number,
): Overlay => {
  const spanBox = (loc: ViewLocation | null): Box | null =>
    loc && getLocationBox(container, shiftLocation(loc, lineOffset));
  const linesBox = (loc: ViewLocation | null): Box | null =>
    loc && getLinesBox(container, shiftLocation(loc, lineOffset));
  const marks = selectedState ? getArmMarks(component, selectedState) : [];
  const arms = marks.flatMap((mark) => {
    const loc = mark.branch[mark.arm];
    const isSingleLine = loc?.start.line === loc?.end.line;
    const box = isSingleLine ? spanBox(loc) : linesBox(loc);
    return box ? [{ ...mark, box, isSingleLine }] : [];
  });
  const placed = component.graph.nodes.flatMap((node) => {
    const isMultiLine = node.loc.start.line !== node.loc.end.line;
    const box = isMultiLine ? linesBox(node.loc) : spanBox(node.loc);
    return box ? [{ node, box, isMultiLine }] : [];
  });
  return { width: container.scrollWidth, height: container.scrollHeight, arms, placed };
};

const getArea = (box: Box): number => box.width * box.height;

const sortForHitTesting = (placed: PlacedNode[]): PlacedNode[] =>
  [...placed].sort(
    (a, b) =>
      getArea(b.box) - getArea(a.box) ||
      HIT_ORDER.indexOf(a.node.kind) - HIT_ORDER.indexOf(b.node.kind),
  );

const getAnchor = (box: Box, side: "left" | "right"): { x: number; y: number } => ({
  x: side === "left" ? box.x : box.x + box.width,
  y: box.y + box.height / 2,
});

interface RelationArrowsProps {
  component: ViewComponent;
  related: Set<string>;
  boxes: Map<string, Box>;
}

const RelationArrows = ({ component, related, boxes }: RelationArrowsProps) =>
  component.graph.edges
    .filter((edge) => related.has(edge.from) && related.has(edge.to))
    .map((edge) => {
      const from = boxes.get(edge.from);
      const to = boxes.get(edge.to);
      if (!from || !to || edge.kind === "triggers") return null;
      const isForward = from.x + from.width <= to.x || from.y !== to.y;
      const start = getAnchor(from, isForward ? "right" : "left");
      const end = getAnchor(to, isForward ? "left" : "right");
      return (
        <DiagramEdge
          key={`${edge.from}-${edge.to}`}
          from={{ ...start, y: start.y - 6 }}
          to={{ ...end, y: end.y - 6 }}
          kind="portal"
          bend={Math.min(16, 8 + Math.abs(end.x - start.x) / 60)}
          directed
          opacity={0.7}
        />
      );
    });

interface NodeLabelProps {
  node: GraphNode;
  box: Box;
}

const getLabelWidth = (node: GraphNode): number => getRoleLabel(node).length * 5.8 + 8;

const layoutLabels = (placed: PlacedNode[]): PlacedNode[] => {
  const isSameBox = (a: Box, b: Box): boolean => a.x === b.x && a.y === b.y && a.width === b.width;
  const sorted = placed
    .filter(({ node }) => node.kind !== "handler")
    .filter(
      ({ node, box }) =>
        node.kind !== "read" ||
        !placed.some((other) => other.node.kind === "branch" && isSameBox(other.box, box)),
    )
    .sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
  let previous: PlacedNode | null = null;
  return sorted.map((item) => {
    const minX =
      previous && previous.box.y === item.box.y
        ? previous.box.x + getLabelWidth(previous.node) + 4
        : 0;
    const laid = { ...item, box: { ...item.box, x: Math.max(item.box.x, minX) } };
    previous = laid;
    return laid;
  });
};

const NodeLabel = ({ node, box }: NodeLabelProps) => {
  const text = getRoleLabel(node);
  const width = getLabelWidth(node);
  return (
    <g pointerEvents="none">
      <rect x={box.x} y={box.y - 13} width={width} height={12} rx={3} fill="var(--foreground)" opacity={0.9} />
      <text
        x={box.x + 4}
        y={box.y - 4}
        className="font-sans text-[9px] font-medium"
        style={{ fill: "var(--background)" }}
      >
        {text}
      </text>
    </g>
  );
};

export const CodeView = ({
  component,
  selectedState,
  hoveredNodeId,
  onHoverNode,
}: CodeViewProps) => {
  const { source, lineOffset } = getComponentSource(component);
  const html = useHighlightedSource(source);
  const containerRef = useRef<HTMLDivElement>(null);
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const index = useMemo(() => indexGraph(component.graph), [component.graph]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || !html) return;
    const measure = (): void =>
      setOverlay(measureOverlay(container, component, selectedState, lineOffset));
    measure();
    document.fonts.ready.then(measure);
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, [html, component, selectedState, lineOffset]);

  const related = hoveredNodeId ? getRelatedNodeIds(index, hoveredNodeId) : new Set<string>();
  const boxes = new Map(overlay?.placed.map((placed) => [placed.node.id, placed.box]));
  const relatedPlaced = overlay?.placed.filter((placed) => related.has(placed.node.id)) ?? [];

  return (
    <div className="overflow-auto">
      <div
        className="relative min-w-full w-max py-4 pr-6 [&_pre]:m-0 [&_pre]:bg-transparent! [&_pre]:font-mono [&_pre]:text-xs [&_pre]:leading-5 [&_.line]:inline-block [&_.line]:min-w-full"
        style={{ paddingLeft: GUTTER_WIDTH }}
        ref={containerRef}
      >
        <div dangerouslySetInnerHTML={{ __html: html }} />
        {overlay && (
          <DiagramCanvas
            className="pointer-events-none absolute inset-0 overflow-visible"
            width={overlay.width}
            height={overlay.height}
            label={`${component.name} dataflow`}
          >
            {overlay.arms.map((arm) => (
              <rect
                key={`${arm.branch.id}-${arm.arm}`}
                x={arm.isSingleLine ? arm.box.x - 2 : 0}
                y={arm.box.y}
                width={arm.isSingleLine ? arm.box.width + 4 : overlay.width}
                height={arm.box.height}
                rx={arm.isSingleLine ? 3 : 0}
                fill={ARM_FILLS[arm.status]}
              />
            ))}
            {relatedPlaced.map(({ node, box, isMultiLine }) => (
              <rect
                key={node.id}
                x={box.x - 2}
                y={box.y}
                width={box.width + 4}
                height={box.height}
                rx={3}
                fill={NODE_FILLS[node.kind]}
                stroke={
                  node.id === hoveredNodeId ? "var(--ring)" : isMultiLine ? "var(--border)" : "none"
                }
                strokeWidth={node.id === hoveredNodeId ? 1.5 : 1}
              />
            ))}
            {hoveredNodeId && (
              <RelationArrows component={component} related={related} boxes={boxes} />
            )}
            {layoutLabels(relatedPlaced).map(({ node, box }) => (
              <NodeLabel key={`${node.id}-label`} node={node} box={box} />
            ))}
            {sortForHitTesting(overlay.placed).map(({ node, box }) => (
              <rect
                key={`${node.id}-hit`}
                className="pointer-events-auto cursor-default"
                x={box.x - 2}
                y={box.y}
                width={box.width + 4}
                height={box.height}
                fill="transparent"
                onMouseEnter={() => onHoverNode(node.id)}
                onMouseLeave={() => onHoverNode(null)}
              >
                <title>{`${getRoleLabel(node)} · ${node.label}`}</title>
              </rect>
            ))}
          </DiagramCanvas>
        )}
      </div>
    </div>
  );
};
