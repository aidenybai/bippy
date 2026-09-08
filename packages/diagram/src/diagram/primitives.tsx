"use client";

import * as stylex from "@stylexjs/stylex";
import { useId, useMemo, type ReactNode, type ComponentPropsWithRef } from "react";
import { useFocusRing } from "@react-aria/focus";
import { usePress, isFocusVisible as getIsFocusVisible } from "@react-aria/interactions";
import { useSlotId } from "@react-aria/utils";
import { NodeContext } from "./node-context";
import { DiagramLabel } from "./node-slots";
import { getNodeDescription, getNodeName } from "./accessibility";
import { composeEventHandlers, mergeClassNames } from "./dom-props";
import { colors } from "./tokens.stylex";
import { drawing } from "./drawing.stylex";
import { getIsCallableNode } from "./node-kind";
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

export interface DiagramCanvasProps extends Omit<ComponentPropsWithRef<"svg">, "children"> {
  width: number;
  height: number;
  label: string;
  description?: string;
  children: ReactNode;
}

export interface DiagramNodeProps
  extends Point, Omit<ComponentPropsWithRef<"g">, "x" | "y" | "onSelect" | "children"> {
  node: TreeNode;
  children?: ReactNode;
  description?: string;
  isFocusVisible?: boolean;
  variant?: "node" | "detail";
  maxWidth?: number;
  hitHeight?: number;
  hitLeft?: number;
  hitWidth?: number;
  isInteractive?: boolean;
  tabIndex?: number;
  onSelect?: (nodeId: string) => void;
}

export interface DiagramEdgeProps
  extends EdgeGeometry, Omit<ComponentPropsWithRef<"g">, "from" | "to" | "children"> {
  id?: string;
  directed?: boolean;
  isSeparated?: boolean;
  label?: string;
  fromId?: string;
  toId?: string;
}

interface DiagramEdgeLabelProps extends Point {
  label: string;
  kind?: EdgeGeometry["kind"];
  isActive?: boolean;
  edgeId?: string;
}

const getIsContextEdge = (kind: EdgeGeometry["kind"]) =>
  kind === "context" || kind === "subscription";
const getIsUpdateEdge = (kind: EdgeGeometry["kind"]) =>
  kind === "update" || kind === "owner" || kind === "reference" || kind === "portal";

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
  inactive: { color: colors.muted },
  disabled: { color: colors.muted, cursor: "not-allowed" },
  focusRing: {
    stroke: colors.blue,
    strokeWidth: 2,
    pointerEvents: "none",
    "@media (forced-colors: active)": { stroke: "Highlight" },
  },
  interactive: { cursor: "pointer" },
  special: { color: colors.muted, fontStyle: "italic" },
  data: { strokeOpacity: 1 },
  update: { strokeOpacity: 1, strokeDasharray: "3 2" },
  subscription: { strokeOpacity: 1, strokeDasharray: "2 2" },
  activeEdge: { stroke: colors.blue, strokeOpacity: 1 },
  edgeHalo: { stroke: colors.surface, strokeWidth: 3, fill: "none", pointerEvents: "none" },
  activeNode: { color: colors.blue },
  contextNode: { color: colors.context },
  boundaryNode: { color: colors.boundary },
  suspenseNode: { color: colors.suspense },
  updateNode: { color: colors.update },
  contextEdge: { stroke: colors.context },
  updateEdge: { stroke: colors.update },
  contextLabel: { fill: colors.context },
  boundaryLabel: { fill: colors.boundary },
  updateLabel: { fill: colors.update },
  owner: { strokeOpacity: 1, strokeDasharray: "3 2" },
  reference: { strokeOpacity: 1, strokeDasharray: "3 2" },
  context: { strokeOpacity: 1 },
  portalEdge: { strokeOpacity: 1, strokeDasharray: "3 2" },
  activeLabel: { fill: colors.blue },
  scope: {
    fill: colors.scope,
    stroke: colors.line,
    strokeWidth: 1,
    strokeOpacity: 1,
  },
  activeScope: { fill: colors.activeScope, stroke: colors.context },
  boundaryScope: { fill: colors.boundaryScope, stroke: colors.boundary },
  scopeLabel: { fontStyle: "italic" },
});

export const DiagramCanvas = ({
  width,
  height,
  label,
  description,
  children,
  className,
  ...props
}: DiagramCanvasProps) => {
  const interaction = useDiagramInteractionState();
  const descriptionId = useId();
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
        aria-label={props["aria-label"] ?? (props["aria-labelledby"] ? undefined : label)}
        aria-describedby={
          mergeClassNames(props["aria-describedby"], description ? descriptionId : undefined) ||
          undefined
        }
        onPointerLeave={composeEventHandlers(props.onPointerLeave, () =>
          interaction.setHoveredId(null),
        )}
      >
        <title>{label}</title>
        {description && <desc id={descriptionId}>{description}</desc>}
        <NodeContext value={null}>{children}</NodeContext>
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
  hitLeft = -6,
  hitWidth,
  isInteractive = true,
  isFocusVisible: externalFocusVisible,
  description,
  tabIndex = 0,
  onSelect,
  className,
  children,
  ...props
}: DiagramNodeProps) => {
  const diagramInteraction = useDiagramInteraction();
  const isDisabled = props["aria-disabled"] === true || props["aria-disabled"] === "true";
  const interaction = isInteractive && !isDisabled ? diagramInteraction : null;
  const { focusProps, isFocusVisible } = useFocusRing();
  const { pressProps } = usePress({
    isDisabled: !isInteractive || isDisabled,
    onPress: (event) => {
      interaction?.setFocusedId(node.id, event.pointerType !== "mouse");
      onSelect?.(node.id);
    },
  });
  const labelId = useSlotId([children]);
  const descriptionId = useSlotId([children]);
  const modelDescriptionId = useId();
  const kind = node.kind ?? "component";
  const isHollow =
    kind === "value" ||
    kind === "host" ||
    kind === "special" ||
    kind === "suspense" ||
    (kind === "boundary" && diagramInteraction?.activeId !== node.id);
  const isDetail = variant === "detail";
  const isCallable = getIsCallableNode(node);
  const fontSize = diagramMetrics.fontSize;
  const labelOffset = isDetail ? 0 : diagramMetrics.labelOffset;
  const characterWidth = fontSize * 0.61;
  const characters = Array.from(node.label);
  const characterCount =
    maxWidth === undefined
      ? characters.length
      : Math.max(
          0,
          Math.floor((maxWidth - labelOffset - 4) / characterWidth) - (isCallable ? 2 : 0),
        );
  const label =
    characters.length > characterCount
      ? `${characters.slice(0, Math.max(0, characterCount - 1)).join("")}${characterCount > 0 ? "…" : ""}`
      : node.label;
  const annotation =
    maxWidth === undefined ||
    getLabelWidth({ ...node, fontSize, labelOffset, isCallable }) <= maxWidth
      ? node.annotation
      : undefined;
  const isDimmed = !getIsNodeHighlighted(diagramInteraction, node.id);
  const nodeStyles = stylex.props(
    styles.node,
    kind === "special" && styles.special,
    isInteractive && !isDisabled && onSelect && styles.interactive,
    isDetail && styles.detail,
    diagramInteraction?.activeId === node.id && styles.activeNode,
    !isDetail && (kind === "provider" || kind === "store") && styles.contextNode,
    kind === "boundary" && styles.boundaryNode,
    kind === "suspense" && styles.suspenseNode,
    (kind === "portal" ||
      node.isPortalTarget ||
      (diagramInteraction?.activeId === node.id && isDetail && isCallable && kind !== "hook")) &&
      styles.updateNode,
    isDimmed && styles.inactive,
    isDisabled && styles.disabled,
  );
  const context = useMemo(
    () => ({ labelId, descriptionId, label, annotation, labelOffset, isCallable }),
    [labelId, descriptionId, label, annotation, labelOffset, isCallable],
  );
  return (
    <NodeContext value={context}>
      <g
        {...nodeStyles}
        {...(isInteractive ? pressProps : {})}
        data-slot={isDetail ? "diagram-detail" : "diagram-node"}
        {...props}
        className={mergeClassNames(nodeStyles.className, className)}
        transform={`translate(${x} ${y})`}
        role={props.role ?? (isInteractive ? "button" : undefined)}
        tabIndex={isInteractive ? (isDisabled ? -1 : tabIndex) : undefined}
        data-focus-visible={(externalFocusVisible ?? isFocusVisible) || undefined}
        data-node-id={node.id}
        data-node-kind={kind}
        data-node-variant={variant}
        data-emphasis={isDimmed ? "dimmed" : "normal"}
        data-active={diagramInteraction?.activeId === node.id || undefined}
        aria-label={
          props["aria-label"] ??
          (!props["aria-labelledby"] && (children === undefined || !labelId)
            ? getNodeName(node)
            : undefined)
        }
        aria-labelledby={
          props["aria-labelledby"] ??
          (props["aria-label"] || children === undefined ? undefined : labelId)
        }
        aria-describedby={mergeClassNames(
          modelDescriptionId,
          descriptionId,
          props["aria-describedby"],
        )}
        onPointerEnter={composeEventHandlers(props.onPointerEnter, (event) => {
          if (isInteractive) pressProps.onPointerEnter?.(event);
          interaction?.setHoveredId(node.id);
        })}
        onPointerMove={composeEventHandlers(props.onPointerMove, () => {
          interaction?.setHoveredId(node.id, true);
        })}
        onPointerLeave={composeEventHandlers(props.onPointerLeave, (event) => {
          if (isInteractive) pressProps.onPointerLeave?.(event);
          interaction?.setHoveredId(null);
        })}
        onPointerUp={composeEventHandlers(
          props.onPointerUp,
          isInteractive ? pressProps.onPointerUp : undefined,
        )}
        onKeyUp={composeEventHandlers(
          props.onKeyUp,
          isInteractive ? pressProps.onKeyUp : undefined,
        )}
        onPointerDown={composeEventHandlers(props.onPointerDown, (event) => {
          if (isInteractive) pressProps.onPointerDown?.(event);
          interaction?.setFocusedId(null, false);
        })}
        onFocus={composeEventHandlers(props.onFocus, (event) => {
          if (event.target !== event.currentTarget) return;
          focusProps.onFocus?.(event);
          interaction?.setFocusedId(node.id, getIsFocusVisible(), false);
        })}
        onBlur={composeEventHandlers(props.onBlur, (event) => {
          if (event.target !== event.currentTarget) return;
          focusProps.onBlur?.(event);
          interaction?.setFocusedId(null);
        })}
        onClick={composeEventHandlers(
          props.onClick,
          isInteractive ? pressProps.onClick : undefined,
        )}
        onKeyDown={composeEventHandlers(
          props.onKeyDown,
          isInteractive ? pressProps.onKeyDown : undefined,
        )}
      >
        <title>{getNodeName(node)}</title>
        <desc id={modelDescriptionId}>{description ?? getNodeDescription(node)}</desc>
        <rect
          x={hitLeft}
          y={-hitHeight / 2}
          width={
            hitWidth ??
            Math.max(
              24,
              Math.min(
                maxWidth === undefined ? Infinity : maxWidth - hitLeft,
                getLabelWidth({ label, annotation, fontSize, labelOffset, isCallable }) +
                  6 -
                  hitLeft,
              ),
            )
          }
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
          <g
            data-component-symbol={node.componentType ?? "unknown"}
            {...stylex.props(
              !isDimmed &&
                !isDisabled &&
                (node.componentType === "memo" || node.componentType === "forward-ref") &&
                styles.updateNode,
            )}
            aria-hidden="true"
            fill={isHollow ? colors.surface : "currentColor"}
            stroke="currentColor"
            strokeWidth={diagramMetrics.strokeWidth}
          >
            {node.componentType === "class" ? (
              <rect x={-3} y={-3} width={6} height={6} />
            ) : node.componentType === "memo" || node.componentType === "forward-ref" ? (
              <path d="M0 -3 3 0 0 3 -3 0Z" />
            ) : (
              <circle r={diagramMetrics.nodeRadius} />
            )}
          </g>
        )}
        {children ?? <DiagramLabel />}
        {(externalFocusVisible ?? isFocusVisible) && (
          <path
            data-focus-ring
            aria-hidden="true"
            d={`M ${labelOffset} ${fontSize / 2 + 3} h ${Math.max(24, getLabelWidth({ label, annotation, fontSize, labelOffset, isCallable }) - labelOffset)}`}
            {...stylex.props(styles.focusRing)}
          />
        )}
      </g>
    </NodeContext>
  );
};

export const DiagramEdgeLabel = ({
  label,
  kind,
  isActive,
  edgeId,
  x,
  y,
}: DiagramEdgeLabelProps) => (
  <text
    data-slot="diagram-edge-label"
    data-edge-label-for={edgeId}
    aria-hidden="true"
    x={x}
    y={y}
    {...stylex.props(
      drawing.annotation,
      isActive && styles.activeLabel,
      isActive && getIsContextEdge(kind) && styles.contextLabel,
      isActive && getIsUpdateEdge(kind) && styles.updateLabel,
    )}
  >
    {label}
  </text>
);

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
    isSeparated,
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
  const isContext = getIsContextEdge(kind);
  const isUpdate = getIsUpdateEdge(kind);
  return (
    <g
      data-slot="diagram-edge"
      {...groupProps}
      className={className}
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
      {isSeparated && (
        <path data-edge-halo="" d={getEdgePath(geometry)} {...stylex.props(styles.edgeHalo)} />
      )}
      <path
        data-edge-path=""
        d={getEdgePath(geometry)}
        markerEnd={directed ? `url(#${markerId})` : undefined}
        {...stylex.props(
          drawing.connector,
          kind !== "parent" && (kind === "portal" ? styles.portalEdge : styles[kind]),
          isActive && styles.activeEdge,
          isActive && isContext && styles.contextEdge,
          isActive && isUpdate && styles.updateEdge,
        )}
      />
      {label && (
        <DiagramEdgeLabel
          {...labelPosition}
          label={label}
          kind={kind}
          isActive={isActive}
          edgeId={id}
        />
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
  return (
    <g
      data-slot="diagram-scope"
      {...props}
      className={className}
      aria-label={props["aria-label"] ?? `${label} ${kind} scope`}
      data-scope-kind={kind}
    >
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={2}
        {...stylex.props(
          styles.scope,
          isActive && styles.activeScope,
          isActive && kind === "boundary" && styles.boundaryScope,
        )}
      />
      <text
        x={x + width - 8}
        y={y + 8}
        textAnchor="end"
        {...stylex.props(
          drawing.annotation,
          styles.scopeLabel,
          isActive && (kind === "boundary" ? styles.boundaryLabel : styles.contextLabel),
        )}
      >
        {label}
      </text>
    </g>
  );
};
