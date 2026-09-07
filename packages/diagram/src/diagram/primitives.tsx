"use client";

import * as stylex from "@stylexjs/stylex";
import { useId, type ReactNode, type ComponentPropsWithRef, type SyntheticEvent } from "react";
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

const mergeClassNames = (...classNames: (string | undefined)[]) =>
  classNames.filter(Boolean).join(" ");

const composeEventHandlers =
  <Event extends SyntheticEvent>(
    external: ((event: Event) => void) | undefined,
    internal: (event: Event) => void,
  ) =>
  (event: Event) => {
    external?.(event);
    if (!event.defaultPrevented) internal(event);
  };

export interface DiagramCanvasProps extends Omit<ComponentPropsWithRef<"svg">, "children"> {
  width: number;
  height: number;
  label: string;
  children: ReactNode;
}

export interface DiagramNodeProps
  extends Point, Omit<ComponentPropsWithRef<"g">, "x" | "y" | "onSelect" | "children"> {
  node: TreeNode;
  children?: ReactNode;
  variant?: "node" | "detail";
  maxWidth?: number;
  hitHeight?: number;
  isInteractive?: boolean;
  tabIndex?: number;
  onSelect?: (nodeId: string) => void;
}

export interface DiagramEdgeProps
  extends EdgeGeometry, Omit<ComponentPropsWithRef<"g">, "from" | "to" | "children"> {
  id?: string;
  directed?: boolean;
  label?: string;
  fromId?: string;
  toId?: string;
}

export interface DiagramScopeProps
  extends Point, Omit<ComponentPropsWithRef<"g">, "x" | "y" | "children"> {
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
  special: { color: colors.muted, fontStyle: "italic" },
  data: { strokeOpacity: 0.7 },
  update: { strokeOpacity: 0.7, strokeDasharray: "3 2" },
  subscription: { strokeOpacity: 0.7, strokeDasharray: "2 2" },
  activeEdge: { stroke: colors.blue, strokeOpacity: 1 },
  activeNode: { color: colors.blue },
  owner: { strokeOpacity: 1, strokeDasharray: "3 2" },
  reference: { strokeOpacity: 1, strokeDasharray: "3 2" },
  context: { strokeOpacity: 1 },
  portalEdge: { strokeOpacity: 1, strokeDasharray: "3 2" },
  activeLabel: { fill: colors.blue },
  scope: {
    fill: colors.scope,
    stroke: colors.line,
    strokeWidth: 1,
    strokeOpacity: 0.25,
  },
  activeScope: { fill: colors.activeScope, stroke: colors.blue },
  scopeLabel: { fontStyle: "italic" },
});

export const DiagramCanvas = ({
  width,
  height,
  label,
  children,
  className,
  ...props
}: DiagramCanvasProps) => {
  const interaction = useDiagramInteractionState();
  const canvasStyles = stylex.props(styles.canvas);
  return (
    <DiagramInteractionContext value={interaction}>
      <svg
        {...canvasStyles}
        data-slot="diagram-canvas"
        {...props}
        className={mergeClassNames(canvasStyles.className, className)}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        textRendering="geometricPrecision"
        role={props.role ?? "group"}
        aria-label={props["aria-label"] ?? label}
        onPointerLeave={composeEventHandlers(props.onPointerLeave, () =>
          interaction.setHoveredId(null),
        )}
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
  className,
  children,
  ...props
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
  const nodeStyles = stylex.props(
    styles.node,
    kind === "special" && styles.special,
    isInteractive && onSelect && styles.interactive,
    isDetail && styles.detail,
    diagramInteraction?.activeId === node.id && styles.activeNode,
    isDimmed && drawing.dimmed,
  );
  return (
    <g
      {...nodeStyles}
      data-slot={isDetail ? "diagram-detail" : "diagram-node"}
      {...props}
      className={mergeClassNames(nodeStyles.className, className)}
      transform={`translate(${x} ${y})`}
      role={props.role ?? (isInteractive && onSelect ? "button" : undefined)}
      tabIndex={isInteractive ? tabIndex : -1}
      data-node-id={node.id}
      data-node-kind={kind}
      data-node-variant={variant}
      data-emphasis={isDimmed ? "dimmed" : "normal"}
      data-active={diagramInteraction?.activeId === node.id || undefined}
      aria-label={
        props["aria-label"] ?? `${node.label}${node.annotation ? `, ${node.annotation}` : ""}`
      }
      onPointerEnter={composeEventHandlers(props.onPointerEnter, () =>
        interaction?.setHoveredId(node.id),
      )}
      onPointerMove={composeEventHandlers(props.onPointerMove, () => {
        interaction?.setIsKeyboardNavigation(false);
        interaction?.setHoveredId(node.id);
      })}
      onPointerLeave={composeEventHandlers(props.onPointerLeave, () =>
        interaction?.setHoveredId(null),
      )}
      onPointerDown={composeEventHandlers(props.onPointerDown, () => {
        interaction?.setIsKeyboardNavigation(false);
        interaction?.setFocusedId(null);
      })}
      onFocus={composeEventHandlers(props.onFocus, (event) => {
        if (event.currentTarget.matches(":focus-visible")) {
          interaction?.setFocusedId(node.id);
          interaction?.setIsKeyboardNavigation(true);
        }
      })}
      onBlur={composeEventHandlers(props.onBlur, () => interaction?.setFocusedId(null))}
      onClick={composeEventHandlers(props.onClick, () => {
        if (isInteractive) onSelect?.(node.id);
      })}
      onKeyDown={composeEventHandlers(props.onKeyDown, (event) => {
        if (isInteractive && onSelect && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          onSelect(node.id);
        }
      })}
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
          stroke="currentColor"
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
      {children ?? (
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
      )}
    </g>
  );
};

export const DiagramEdge = (props: DiagramEdgeProps) => {
  const {
    kind = "parent",
    label,
    directed,
    id,
    fromId,
    toId,
    className,
    from,
    to,
    bend,
    side,
    labelPosition: explicitLabelPosition,
    waypoints,
    shape,
    ...groupProps
  } = props;
  const geometry: EdgeGeometry = {
    kind,
    from,
    to,
    bend,
    side,
    labelPosition: explicitLabelPosition,
    waypoints,
    shape,
  };
  const markerId = useId();
  const labelPosition = getEdgeLabelPosition(geometry);
  const interaction = useDiagramInteraction();
  const isDimmed = !getIsEdgeHighlighted(interaction, fromId, toId, id);
  const isActive =
    interaction !== null &&
    interaction.activeId !== null &&
    interaction.mode !== "boundary" &&
    kind !== "parent" &&
    !isDimmed;
  const edgeStyles = stylex.props(isDimmed && drawing.dimmed);
  return (
    <g
      {...edgeStyles}
      data-slot="diagram-edge"
      {...groupProps}
      className={mergeClassNames(edgeStyles.className, className)}
      aria-hidden="true"
      data-edge-id={id}
      data-edge-kind={kind}
      data-edge-from={fromId}
      data-edge-to={toId}
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
        d={getEdgePath(geometry)}
        markerEnd={directed ? `url(#${markerId})` : undefined}
        {...stylex.props(
          drawing.connector,
          kind !== "parent" && (kind === "portal" ? styles.portalEdge : styles[kind]),
          isActive && styles.activeEdge,
        )}
      />
      {label && (
        <text
          x={labelPosition.x}
          y={labelPosition.y}
          {...stylex.props(drawing.annotation, isActive && styles.activeLabel)}
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
  className,
  ...props
}: DiagramScopeProps) => {
  const interaction = useDiagramInteraction();
  const isActive =
    interaction !== null &&
    interaction.activeId !== null &&
    ((kind === "boundary" && interaction.mode === "boundary") || interaction.activeId === nodeId);
  const scopeStyles = stylex.props(
    interaction !== null &&
      interaction.activeId !== null &&
      interaction.mode !== "boundary" &&
      interaction.activeId !== nodeId &&
      drawing.dimmed,
  );
  return (
    <g
      {...scopeStyles}
      data-slot="diagram-scope"
      {...props}
      className={mergeClassNames(scopeStyles.className, className)}
      aria-label={props["aria-label"] ?? `${label} ${kind} scope`}
      data-scope-kind={kind}
    >
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={2}
        {...stylex.props(styles.scope, isActive && styles.activeScope)}
      />
      <text
        x={x + width - 8}
        y={y + 8}
        textAnchor="end"
        {...stylex.props(drawing.annotation, styles.scopeLabel, isActive && styles.activeLabel)}
      >
        {label}
      </text>
    </g>
  );
};
