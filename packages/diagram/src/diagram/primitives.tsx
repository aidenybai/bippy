"use client";

import * as stylex from "@stylexjs/stylex";
import { useId, type ReactNode } from "react";
import { colors } from "./tokens.stylex";
import { drawing } from "./drawing.stylex";
import type { TreeNode } from "./tree-model";
import {
  DiagramInteractionContext,
  useDiagramInteraction,
  useDiagramInteractionState,
  getIsNodeHighlighted,
  getIsEdgeHighlighted,
} from "./interaction";
import {
  diagramMetrics,
  getEdgePath,
  getEdgeLabelPosition,
  getLabelWidth,
  type EdgeGeometry,
  type Point,
} from "./geometry";

export type { Point } from "./geometry";

export interface DiagramCanvasProps {
  width: number;
  height: number;
  label: string;
  children: ReactNode;
}

export interface DiagramNodeProps extends Point {
  node: TreeNode;
  variant?: "node" | "detail";
  maxWidth?: number;
  hitHeight?: number;
  isInteractive?: boolean;
  tabIndex?: number;
  onSelect?: (nodeId: string) => void;
}

export interface DiagramEdgeProps extends EdgeGeometry {
  id?: string;
  directed?: boolean;
  label?: string;
  fromId?: string;
  toId?: string;
}

export interface DiagramScopeProps extends Point {
  nodeId?: string;
  kind?: "context" | "boundary";
  width: number;
  height: number;
  label: string;
}

const styles = stylex.create({
  canvas: { display: "block", flexShrink: 0, overflow: "hidden" },
  node: { color: colors.text, outline: "none" },
  detail: { color: colors.muted },
  interactive: { cursor: "pointer" },
  component: { color: colors.text },
  host: { color: colors.text },
  provider: { color: colors.blue },
  boundary: { color: colors.red },
  special: { color: colors.muted, fontStyle: "italic" },
  suspense: { color: colors.teal },
  hook: { color: colors.text },
  value: { color: colors.text },
  callback: { color: colors.text },
  store: { color: colors.text },
  data: { strokeOpacity: 0.7 },
  update: { strokeOpacity: 0.7, strokeDasharray: "3 2" },
  subscription: { strokeOpacity: 0.7, strokeDasharray: "2 2" },
  activeFlow: { stroke: colors.blue, strokeOpacity: 1 },
  portal: { color: colors.yellow },
  blue: { color: colors.blue },
  violet: { color: colors.violet },
  orange: { color: colors.orange },
  owner: { strokeOpacity: 1, strokeDasharray: "3 2" },
  reference: { strokeOpacity: 1, strokeDasharray: "3 2" },
  context: { stroke: colors.blue, strokeOpacity: 1 },
  portalEdge: { stroke: colors.orange, strokeOpacity: 1, strokeDasharray: "3 2" },
  referenceLabel: { fill: colors.pink },
  contextLabel: { fill: colors.blue },
  portalLabel: { fill: colors.orange },
  scope: {
    fill: colors.scope,
    stroke: colors.blue,
    strokeWidth: 1,
    strokeOpacity: 0.25,
  },
  boundaryScope: { fill: colors.boundaryScope, stroke: colors.red },
  boundaryLabel: { fill: colors.red },
  scopeLabel: { fill: colors.blue, fontStyle: "italic" },
});

export const DiagramCanvas = ({ width, height, label, children }: DiagramCanvasProps) => {
  const interaction = useDiagramInteractionState();
  return (
    <DiagramInteractionContext value={interaction}>
      <svg
        {...stylex.props(styles.canvas)}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        textRendering="geometricPrecision"
        role="group"
        aria-label={label}
        onPointerLeave={() => interaction.setHoveredId(null)}
      >
        <title>{label}</title>
        {children}
      </svg>
    </DiagramInteractionContext>
  );
};

export const DiagramNode = ({
  node,
  variant = "node",
  x,
  y,
  maxWidth,
  hitHeight = diagramMetrics.rowHeight,
  isInteractive = true,
  tabIndex = 0,
  onSelect,
}: DiagramNodeProps) => {
  const diagramInteraction = useDiagramInteraction();
  const interaction = isInteractive ? diagramInteraction : null;
  const kind = node.kind ?? "component";
  const isHollow =
    kind === "value" ||
    kind === "host" ||
    kind === "special" ||
    kind === "suspense" ||
    (kind === "boundary" && diagramInteraction?.activeId !== node.id);
  const isDetail = variant === "detail";
  const fontSize = isDetail ? diagramMetrics.detailFontSize : diagramMetrics.fontSize;
  const labelOffset = isDetail ? 0 : diagramMetrics.labelOffset;
  const characterWidth = fontSize * 0.61;
  const characters = Array.from(node.label);
  const characterCount =
    maxWidth === undefined
      ? characters.length
      : Math.max(0, Math.floor((maxWidth - labelOffset - 4) / characterWidth));
  const label =
    characters.length > characterCount
      ? `${characters.slice(0, Math.max(0, characterCount - 1)).join("")}${characterCount > 0 ? "…" : ""}`
      : node.label;
  const annotation = maxWidth === undefined ? node.annotation : undefined;
  const isDimmed = !getIsNodeHighlighted(diagramInteraction, node.id);
  return (
    <g
      {...stylex.props(
        styles.node,
        styles[kind],
        isInteractive && onSelect && styles.interactive,
        node.tone && styles[node.tone],
        isDetail && styles.detail,
        diagramInteraction?.mode === "flow" &&
          diagramInteraction.activeId === node.id &&
          styles.blue,
        isDimmed && drawing.dimmed,
      )}
      transform={`translate(${x} ${y})`}
      role={isInteractive && onSelect ? "button" : undefined}
      tabIndex={isInteractive ? tabIndex : -1}
      data-node-id={node.id}
      data-node-kind={kind}
      data-node-variant={variant}
      data-emphasis={isDimmed ? "dimmed" : "normal"}
      aria-label={`${node.label}${node.annotation ? `, ${node.annotation}` : ""}`}
      onPointerEnter={() => interaction?.setHoveredId(node.id)}
      onPointerMove={() => {
        interaction?.setIsKeyboardNavigation(false);
        interaction?.setHoveredId(node.id);
      }}
      onPointerLeave={() => interaction?.setHoveredId(null)}
      onPointerDown={() => {
        interaction?.setIsKeyboardNavigation(false);
        interaction?.setFocusedId(null);
      }}
      onFocus={(event) => {
        if (event.currentTarget.matches(":focus-visible")) {
          interaction?.setFocusedId(node.id);
          interaction?.setIsKeyboardNavigation(true);
        }
      }}
      onBlur={() => interaction?.setFocusedId(null)}
      onClick={isInteractive && onSelect ? () => onSelect(node.id) : undefined}
      onKeyDown={
        isInteractive && onSelect
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelect(node.id);
              }
            }
          : undefined
      }
    >
      <title>{`${node.label}${node.annotation ? ` · ${node.annotation}` : ""}`}</title>
      <rect
        x={-6}
        y={-hitHeight / 2}
        width={Math.max(
          1,
          Math.min(
            maxWidth === undefined ? Infinity : maxWidth + 6,
            getLabelWidth({ label, annotation, fontSize, labelOffset }) + 12,
          ),
        )}
        height={hitHeight}
        fill="transparent"
      />
      {!isDetail &&
        diagramInteraction?.mode === "owner" &&
        diagramInteraction.activeId === node.id && (
          <circle
            r={diagramMetrics.nodeRadius + 2}
            fill="none"
            stroke="currentColor"
            strokeWidth={diagramMetrics.strokeWidth}
          />
        )}
      {!isDetail && (kind === "portal" || node.isPortalTarget) && (
        <circle
          r={diagramMetrics.nodeRadius + 2}
          fill="none"
          stroke={colors.yellow}
          strokeWidth={diagramMetrics.strokeWidth}
        />
      )}
      {!isDetail && (
        <circle
          r={diagramMetrics.nodeRadius}
          fill={isHollow ? colors.surface : "currentColor"}
          stroke="currentColor"
          strokeWidth={diagramMetrics.strokeWidth}
        />
      )}
      <text
        x={labelOffset}
        dy="0.32em"
        {...stylex.props(drawing.label, isDetail && drawing.detail)}
      >
        {label}
        {annotation && (
          <tspan dx={4} {...stylex.props(drawing.annotation)}>
            {annotation}
          </tspan>
        )}
      </text>
    </g>
  );
};

export const DiagramEdge = (props: DiagramEdgeProps) => {
  const { kind = "parent", label, directed } = props;
  const markerId = useId();
  const labelPosition = getEdgeLabelPosition(props);
  const interaction = useDiagramInteraction();
  const isDimmed = !getIsEdgeHighlighted(interaction, props.fromId, props.toId, props.id);
  return (
    <g
      aria-hidden="true"
      data-edge-id={props.id}
      data-edge-kind={kind}
      data-edge-from={props.fromId}
      data-edge-to={props.toId}
      {...stylex.props(isDimmed && drawing.dimmed)}
    >
      {directed && (
        <defs>
          <marker
            id={markerId}
            viewBox="0 0 8 8"
            refX={4}
            refY={4}
            markerWidth={8}
            markerHeight={8}
            orient="auto"
          >
            <path
              d="M 1 2 L 4 4 L 1 6"
              fill="none"
              stroke="context-stroke"
              strokeWidth={diagramMetrics.strokeWidth}
              strokeLinejoin="round"
            />
          </marker>
        </defs>
      )}
      <path
        d={getEdgePath(props)}
        markerEnd={directed ? `url(#${markerId})` : undefined}
        {...stylex.props(
          drawing.connector,
          kind !== "parent" && (kind === "portal" ? styles.portalEdge : styles[kind]),
          interaction?.mode === "flow" && kind !== "parent" && !isDimmed && styles.activeFlow,
        )}
      />
      {label && (
        <text
          x={labelPosition.x}
          y={labelPosition.y}
          {...stylex.props(
            drawing.annotation,
            kind === "reference" && styles.referenceLabel,
            kind === "context" && styles.contextLabel,
            kind === "portal" && styles.portalLabel,
          )}
        >
          {label}
        </text>
      )}
    </g>
  );
};

export const DiagramScope = ({
  x,
  y,
  width,
  height,
  label,
  kind = "context",
  nodeId,
}: DiagramScopeProps) => {
  const interaction = useDiagramInteraction();
  return (
    <g
      aria-label={`${label} ${kind} scope`}
      data-scope-kind={kind}
      {...stylex.props(
        interaction !== null &&
          interaction.activeId !== null &&
          interaction.mode !== "boundary" &&
          interaction.activeId !== nodeId &&
          drawing.dimmed,
      )}
    >
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={2}
        {...stylex.props(styles.scope, kind === "boundary" && styles.boundaryScope)}
      />
      <text
        x={x + width - 8}
        y={y + 8}
        textAnchor="end"
        {...stylex.props(
          drawing.annotation,
          styles.scopeLabel,
          kind === "boundary" && styles.boundaryLabel,
        )}
      >
        {label}
      </text>
    </g>
  );
};
