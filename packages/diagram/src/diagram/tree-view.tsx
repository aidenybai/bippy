"use client";

import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { TreeControls } from "./tree-controls";
import { getCollapsedTreeIds, getRevealedTreeIds, type TreeRevealRequest } from "./tree-expansion";
import { mergeRefs } from "@react-aria/utils";
import { DiagramCanvas, type DiagramCanvasProps } from "./primitives";
import { useTreeRoot, TreeViewContext } from "./tree-context";
import { DiagramInteractionContext, type DiagramInteraction } from "./interaction";
import { getTreeRows } from "./tree-model";
import { getOwnerNodes, getTreeHighlight, getTreeHighlightIndex } from "./tree-highlight";
import { getDataflowHighlight } from "./dataflow-model";
import { getTreeLayout } from "./tree-layout";
import { getVisibleTreeRows } from "./tree-visible-rows";
import { useTreeNavigation } from "./use-tree-navigation";
import { treeInstructions } from "./accessibility";
import { composeEventHandlers } from "./dom-props";
import { diagramMetrics } from "./geometry";

export interface TreeViewProps extends Omit<
  DiagramCanvasProps,
  "width" | "height" | "onSelect" | "role"
> {
  controls?: ReactNode;
  relationship?: "parent" | "owner";
  width?: number;
  rowHeight?: number;
  indent?: number;
  showOwners?: boolean;
  scopeId?: string;
  scopeLabel?: string;
}

export const TreeView = ({
  controls,
  relationship = "parent",
  width = 400,
  rowHeight = diagramMetrics.rowHeight,
  indent = diagramMetrics.indent,
  showOwners = false,
  scopeId,
  scopeLabel = "Context",
  label,
  children,
  ref,
  description,
  ...props
}: TreeViewProps) => {
  const root = useTreeRoot();
  const containerRef = useRef<SVGSVGElement>(null);
  const mergedRef = useMemo(() => mergeRefs(containerRef, ref), [ref]);
  const [collapsedIds, setCollapsedIds] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = useCallback(
    (nodeId: string) =>
      setCollapsedIds((previous) => {
        const next = new Set(previous);
        if (next.has(nodeId)) next.delete(nodeId);
        else next.add(nodeId);
        return next;
      }),
    [],
  );
  const model = useMemo(
    () => (relationship === "owner" ? getTreeRows(getOwnerNodes(root.nodes)) : root.rows),
    [root.nodes, root.rows, relationship],
  );
  const [revealRequest, setRevealRequest] = useState<TreeRevealRequest | null>(null);
  const reveal = useCallback(
    (nodeId: string, shouldFocus: boolean) => {
      setCollapsedIds((previous) => getRevealedTreeIds(model, nodeId, previous));
      setRevealRequest({ nodeId, shouldFocus });
    },
    [model],
  );
  const expandAll = useCallback(() => setCollapsedIds(new Set()), []);
  const collapseAll = useCallback(() => setCollapsedIds(getCollapsedTreeIds(model)), [model]);
  const rows = useMemo(() => getVisibleTreeRows(model, collapsedIds), [model, collapsedIds]);
  const layout = useMemo(() => getTreeLayout(rows, rowHeight, indent), [rows, rowHeight, indent]);
  const indexById = useMemo(() => new Map(rows.map((row, index) => [row.node.id, index])), [rows]);
  const visibleHighlight = useMemo(() => getTreeHighlightIndex(rows), [rows]);
  const activeNode =
    root.interaction.activeId === null
      ? undefined
      : root.highlightIndex.nodeById.get(root.interaction.activeId);
  const flow = useMemo(
    () =>
      root.flowIndex &&
      activeNode &&
      (activeNode.componentId !== undefined || activeNode.kind === "store")
        ? getDataflowHighlight(root.flowIndex, activeNode.id)
        : undefined,
    [root.flowIndex, activeNode],
  );
  const interaction = useMemo<DiagramInteraction>(() => {
    const next = {
      ...root.interaction,
      ...getTreeHighlight(root.highlightIndex, root.interaction.activeId, relationship),
      catchRanges: visibleHighlight.catchRanges.get(root.interaction.activeId ?? "") ?? [],
    };
    if (flow) {
      next.mode = "flow";
      next.highlightedIds = flow.nodeIds;
      next.highlightedEdgeIds = flow.edgeIds;
    }
    return next;
  }, [root.interaction, root.highlightIndex, relationship, visibleHighlight, flow]);
  const navigation = useTreeNavigation({ rows, containerRef, collapsedIds, toggle, interaction });
  const { focusedId, setFocusedId } = navigation;
  useLayoutEffect(() => {
    if (!revealRequest) return;
    const element = [
      ...(containerRef.current?.querySelectorAll<SVGGElement>("[data-tree-item]") ?? []),
    ].find(
      (item) =>
        item.dataset.nodeId === revealRequest.nodeId &&
        item.closest("[data-tree-view]") === containerRef.current &&
        item.getAttribute("aria-disabled") !== "true",
    );
    if (element) {
      setFocusedId(revealRequest.nodeId);
      if (revealRequest.shouldFocus) element.focus({ preventScroll: true });
      element.scrollIntoView({ block: "nearest", inline: "nearest" });
      interaction.setFocusedId(revealRequest.nodeId, true);
    }
    setRevealRequest(null);
  }, [revealRequest, rows, setFocusedId, interaction]);
  const scopeIndex =
    scopeId && relationship === "parent" && interaction.activeId === scopeId
      ? indexById.get(scopeId)
      : undefined;
  const context = useMemo(
    () => ({
      ...layout,
      label,
      model,
      reveal,
      expandAll,
      collapseAll,
      rows,
      indexById,
      interaction,
      activeNode,
      flow,
      width,
      relationship,
      showOwners,
      scopeId,
      scopeLabel,
      scopeIndex,
      focusedId,
      setFocusedId,
      collapsedIds,
      toggle,
    }),
    [
      layout,
      label,
      model,
      reveal,
      expandAll,
      collapseAll,
      rows,
      indexById,
      interaction,
      activeNode,
      flow,
      width,
      relationship,
      showOwners,
      scopeId,
      scopeLabel,
      scopeIndex,
      focusedId,
      setFocusedId,
      collapsedIds,
      toggle,
    ],
  );
  return (
    <TreeViewContext value={context}>
      <DiagramInteractionContext value={interaction}>
        {controls && (controls === true ? <TreeControls /> : controls)}
        <DiagramCanvas
          data-slot="tree-view"
          {...props}
          data-tree-view=""
          ref={mergedRef}
          role={navigation.hasItems ? "tree" : "group"}
          tabIndex={focusedId === null ? 0 : -1}
          width={width}
          height={Math.max(rowHeight * 4, layout.offsets[rows.length] + rowHeight / 2)}
          label={label}
          description={[
            treeInstructions,
            !navigation.hasItems
              ? "No nodes to display."
              : focusedId === null
                ? "No available nodes."
                : "",
            description,
          ]
            .filter(Boolean)
            .join(" ")}
          onKeyDown={composeEventHandlers(props.onKeyDown, navigation.onKeyDown)}
          onFocusCapture={composeEventHandlers(props.onFocusCapture, navigation.onFocusCapture)}
          onBlurCapture={composeEventHandlers(props.onBlurCapture, navigation.onBlurCapture)}
        >
          {children}
        </DiagramCanvas>
      </DiagramInteractionContext>
    </TreeViewContext>
  );
};
