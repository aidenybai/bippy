import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { codeToHtml } from "shiki";
import { DiagramCanvas, DiagramEdge } from "diagram";
import { colors } from "diagram/tokens";
import { getLinesBox, getLocationBox, type Box } from "./code-positions";
import { getHoverView, indexGraph, type HoverView } from "./hover-model";
import type { GraphNode, ViewComponent, ViewLocation, ViewState } from "./model";
import { getEdgeKind, getRoleColor, getRoleLabel } from "./roles";
import { getArmMarks, type Arm, type ArmMark } from "./state-model";

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

interface PlacedArm {
  key: string;
  box: Box;
}

interface Overlay {
  width: number;
  height: number;
  codeRight: number;
  arms: Map<string, Box>;
  placed: PlacedNode[];
}

const MAX_WHOLE_FILE_LINES = 60;
const GUTTER_WIDTH = 96;
const LANE_X = GUTTER_WIDTH - 14;
const LABEL_GAP = 24;
const DOT_KINDS = new Set<GraphNode["kind"]>(["trigger", "binding", "branch", "component"]);
const HIT_ORDER: GraphNode["kind"][] = [
  "handler",
  "arm",
  "trigger",
  "branch",
  "write",
  "read",
  "render",
  "component",
  "binding",
];

const getArmKey = (branchId: number, arm: Arm): string => `${branchId}:${arm}`;

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

const getCodeRight = (container: HTMLElement): number => {
  const origin = container.getBoundingClientRect();
  return [...container.querySelectorAll(".line")].reduce((right, line) => {
    const range = document.createRange();
    range.selectNodeContents(line);
    return Math.max(right, range.getBoundingClientRect().right - origin.left);
  }, 0);
};

const measureOverlay = (
  container: HTMLElement,
  component: ViewComponent,
  lineOffset: number,
): Overlay => {
  const spanBox = (loc: ViewLocation | null): Box | null =>
    loc && getLocationBox(container, shiftLocation(loc, lineOffset));
  const linesBox = (loc: ViewLocation | null): Box | null =>
    loc && getLinesBox(container, shiftLocation(loc, lineOffset));
  const arms = new Map<string, Box>();
  for (const branch of component.branches)
    for (const arm of ["consequent", "alternate"] as const) {
      const loc = branch[arm];
      const box = loc?.start.line === loc?.end.line ? spanBox(loc) : linesBox(loc);
      if (box) arms.set(getArmKey(branch.id, arm), box);
    }
  const placed = component.graph.nodes.flatMap((node) => {
    const isMultiLine = node.loc.start.line !== node.loc.end.line;
    const box = isMultiLine ? linesBox(node.loc) : spanBox(node.loc);
    return box && box.height > 0 ? [{ node, box, isMultiLine }] : [];
  });
  return {
    width: container.scrollWidth,
    height: container.scrollHeight,
    codeRight: getCodeRight(container),
    arms,
    placed,
  };
};

const getArea = (box: Box): number => box.width * box.height;

const sortForHitTesting = (placed: PlacedNode[]): PlacedNode[] =>
  [...placed].sort(
    (a, b) =>
      getArea(b.box) - getArea(a.box) ||
      HIT_ORDER.indexOf(a.node.kind) - HIT_ORDER.indexOf(b.node.kind),
  );

const getRowY = (box: Box): number => box.y + 10;

interface RowLabel {
  y: number;
  text: string;
}

const getRowLabels = (placed: PlacedNode[], view: HoverView | null): RowLabel[] => {
  const byRow = new Map<number, string[]>();
  const sorted = [...placed].sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
  for (const { node, box } of sorted) {
    const note = view?.notes.get(node.id);
    const text = note ? `${getRoleLabel(node)} · ${note}`.replace(/^ · /, "") : getRoleLabel(node);
    if (!text) continue;
    const row = byRow.get(box.y) ?? [];
    if (!row.includes(text)) row.push(text);
    byRow.set(box.y, row);
  }
  return [...byRow].map(([y, texts]) => ({ y, text: texts.join(" · ") }));
};

const getFadedArms = (component: ViewComponent, selectedState: ViewState | null, view: HoverView | null): PlacedArm[] => {
  const keys = new Set<string>();
  if (view && view.armChanges.length > 0)
    for (const change of view.armChanges) if (change.change === "disappears") keys.add(getArmKey(change.branch.id, change.arm));
  else if (selectedState)
    for (const mark of getArmMarks(component, selectedState))
      if (mark.status === "dead" || mark.status === "removed") keys.add(getArmKey(mark.branch.id, mark.arm));
  for (const branch of component.branches) if (branch.never) keys.add(getArmKey(branch.id, branch.never));
  return [...keys].map((key) => ({ key, box: null as unknown as Box }));
};

const Dot = ({ box, color, isActive }: { box: Box; color: string; isActive: boolean }) => (
  <circle
    cx={LANE_X}
    cy={getRowY(box)}
    r={isActive ? 3 : 2}
    fill={isActive ? color : colors.surface}
    stroke={color}
    strokeWidth={1}
  />
);

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
    const measure = (): void => setOverlay(measureOverlay(container, component, lineOffset));
    measure();
    document.fonts.ready.then(measure);
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, [html, component, lineOffset]);

  const view = hoveredNodeId ? getHoverView(component, index, hoveredNodeId, selectedState) : null;
  const placedById = new Map(overlay?.placed.map((placed) => [placed.node.id, placed]));
  const relatedPlaced = overlay?.placed.filter((placed) => view?.nodeIds.has(placed.node.id)) ?? [];
  const edges = (view?.edges ?? []).filter(
    (edge) => placedById.get(edge.from)?.box.y !== placedById.get(edge.to)?.box.y,
  );
  const fadedArms = getFadedArms(component, selectedState, view)
    .map(({ key }) => ({ key, box: overlay?.arms.get(key) }))
    .filter((arm): arm is PlacedArm => arm.box !== undefined);
  const appearingArms = (view?.armChanges ?? [])
    .filter((change) => change.change === "appears")
    .map((change) => overlay?.arms.get(getArmKey(change.branch.id, change.arm)))
    .filter((box): box is Box => box !== undefined);
  const neverLabels = component.branches.flatMap((branch) => {
    const box = branch.never && overlay?.arms.get(getArmKey(branch.id, branch.never));
    return box ? [{ y: box.y, text: "never" }] : [];
  });

  return (
    <div className="overflow-auto">
      <div
        className="relative min-w-full w-max py-4 pr-72 [&_pre]:m-0 [&_pre]:bg-transparent! [&_pre]:font-mono [&_pre]:text-xs [&_pre]:leading-5 [&_.line]:inline-block [&_.line]:min-w-full"
        style={{ paddingLeft: GUTTER_WIDTH }}
        ref={containerRef}
      >
        <div dangerouslySetInnerHTML={{ __html: html }} />
        {overlay && (
          <DiagramCanvas
            className="pointer-events-none absolute inset-0 overflow-visible"
            width={overlay.width}
            height={overlay.height}
            label={`${component.name} analysis`}
          >
            {fadedArms.map(({ key, box }) => (
              <rect
                key={key}
                x={box.x - 2}
                y={box.y}
                width={box.width + 4}
                height={box.height}
                fill={colors.surface}
                opacity={0.7}
              />
            ))}
            {appearingArms.map((box, i) => (
              <rect
                key={i}
                x={box.x - 2}
                y={box.y}
                width={box.width + 4}
                height={box.height}
                rx={2}
                fill="none"
                stroke={colors.context}
                strokeWidth={0.75}
                strokeDasharray="3 2"
              />
            ))}
            {overlay.placed
              .filter(({ node }) => DOT_KINDS.has(node.kind))
              .map(({ node, box }) => (
                <Dot
                  key={`${node.id}-dot`}
                  box={box}
                  color={view?.nodeIds.has(node.id) ? getRoleColor(node) : colors.border}
                  isActive={view?.nodeIds.has(node.id) ?? false}
                />
              ))}
            {edges.map((edge) => {
              const from = placedById.get(edge.from);
              const to = placedById.get(edge.to);
              if (!from || !to) return null;
              return (
                <DiagramEdge
                  key={`${edge.from}-${edge.to}`}
                  from={{ x: LANE_X, y: getRowY(from.box) }}
                  to={{ x: LANE_X, y: getRowY(to.box) }}
                  kind={getEdgeKind(edge)}
                  shape="curve"
                  side="left"
                  bend={Math.min(48, 12 + Math.abs(to.box.y - from.box.y) / 4)}
                  directed
                />
              );
            })}
            {relatedPlaced.map(({ node, box, isMultiLine }) => {
              const isHovered = node.id === hoveredNodeId;
              if (node.kind === "handler" && !isHovered) return null;
              const isOutlined = isMultiLine || isHovered;
              return (
                <rect
                  key={node.id}
                  x={box.x - 2}
                  y={isOutlined ? box.y : box.y + box.height - 2}
                  width={box.width + 4}
                  height={isOutlined ? box.height : 1.5}
                  rx={isHovered ? 2 : 0}
                  fill={isOutlined ? "none" : getRoleColor(node)}
                  stroke={isOutlined ? (isHovered ? colors.blue : getRoleColor(node)) : "none"}
                  strokeWidth={isHovered ? 1 : 0.5}
                  strokeDasharray={isMultiLine && !isHovered ? "3 2" : undefined}
                />
              );
            })}
            {[...getRowLabels(relatedPlaced, view), ...(view ? [] : neverLabels)].map((label) => (
              <text
                key={label.y}
                x={overlay.codeRight + LABEL_GAP}
                y={label.y + 14}
                className="font-sans text-[10px]"
                style={{ fill: colors.muted }}
              >
                {label.text}
              </text>
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
                <title>{`${getRoleLabel(node) || "handler"} · ${node.label}`}</title>
              </rect>
            ))}
          </DiagramCanvas>
        )}
      </div>
    </div>
  );
};
