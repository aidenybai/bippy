"use client";

import * as stylex from "@stylexjs/stylex";
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { mergeRefs } from "@react-aria/utils";
import { ScrollArea } from "../components/ui/scroll-area";
import { TreeControls } from "./tree-controls";
import { TreeItems } from "./tree-items";
import { TreeScopes } from "./tree-scopes";
import { TreeEdges } from "./tree-edges";
import { getCollapsedTreeIds, getRevealedTreeIds, type TreeRevealRequest } from "./tree-expansion";
import { DiagramCanvas, type DiagramCanvasProps } from "./primitives";
import { useTreeRoot, TreeViewContext } from "./tree-context";
import { DiagramInteractionContext, type DiagramInteraction } from "./interaction";
import { getTreeRows, getIndentation } from "./tree-model";
import { getOwnerNodes, getTreeHighlight, getTreeHighlightIndex } from "./tree-highlight";
import { getDataflowHighlight } from "./dataflow-model";
import { getTreeLayout } from "./tree-layout";
import { getVisibleTreeRows } from "./tree-visible-rows";
import { getTreeWindow } from "./tree-window";
import { useTreeNavigation } from "./use-tree-navigation";
import { treeInstructions } from "./accessibility";
import { composeEventHandlers } from "./dom-props";
import { diagramMetrics } from "./geometry";

export interface TreeViewProps extends Omit<
  DiagramCanvasProps,
  "width" | "height" | "onSelect" | "role" | "children"
> {
  children?: ReactNode;
  controls?: ReactNode;
  traceComponents?: boolean;
  relationship?: "parent" | "owner";
  width?: number | "100%";
  height?: number | "auto";
  rowHeight?: number;
  indent?: number;
  showOwners?: boolean;
  scopeId?: string;
  scopeLabel?: string;
}

const styles = stylex.create({
  frame: (width: number | "100%") => ({ width, maxWidth: "100%" }),
  viewport: (height: number) => ({ height, width: "100%" }),
});

export const TreeView = ({
  controls,
  traceComponents = false,
  relationship = "parent",
  width: requestedWidth = 400,
  height = 396,
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
  const viewportRef = useRef<HTMLDivElement>(null);
  const mergedRef = useMemo(() => mergeRefs(containerRef, ref), [ref]);
  const fallbackWidth = typeof requestedWidth === "number" ? requestedWidth : 400;
  const [width, setWidth] = useState(fallbackWidth);
  const [scrollTop, setScrollTop] = useState(0);
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
  const baseLayout = useMemo(
    () => getTreeLayout(rows, rowHeight, indent),
    [rows, rowHeight, indent],
  );
  const contentHeight = Math.max(rowHeight * 4, baseLayout.offsets[rows.length] + rowHeight / 2);
  const viewportHeight =
    height === "auto"
      ? contentHeight
      : Math.min(contentHeight, Math.max(rowHeight, height - (controls ? 32 : 0)));
  const range = useMemo(
    () => getTreeWindow(baseLayout.offsets, scrollTop, viewportHeight),
    [baseLayout, scrollTop, viewportHeight],
  );
  const isWindowed = rows.length > 100;
  const windowRows = useMemo(
    () => (isWindowed ? rows.slice(range.start, range.end) : rows),
    [isWindowed, rows, range.start, range.end],
  );
  const layout = useMemo(() => {
    const indentation = getIndentation(windowRows, width);
    return getTreeLayout(rows, rowHeight, indent, {
      indentation: { ...indentation, size: Math.min(indent, indentation.size) },
      maxOffset: 40 + width * 0.42,
    });
  }, [rows, rowHeight, indent, windowRows, width]);
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const measure = () => {
      const contentWidth = Math.floor(Number.parseFloat(getComputedStyle(viewport).width));
      setWidth(Math.min(viewport.clientWidth, contentWidth) || fallbackWidth);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [requestedWidth, fallbackWidth]);
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const nextTop = Math.min(viewport.scrollTop, Math.max(0, contentHeight - viewportHeight));
    viewport.scrollTop = nextTop;
    setScrollTop(nextTop);
  }, [contentHeight, viewportHeight]);
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
      (traceComponents || activeNode.componentId !== undefined || activeNode.kind === "store")
        ? getDataflowHighlight(root.flowIndex, activeNode.id)
        : undefined,
    [root.flowIndex, activeNode, traceComponents],
  );
  const interaction = useMemo<DiagramInteraction>(() => {
    const next = {
      ...root.interaction,
      dataflowIndex: root.flowIndex,
      ...getTreeHighlight(root.highlightIndex, root.interaction.activeId, relationship),
      catchRanges: visibleHighlight.catchRanges.get(root.interaction.activeId ?? "") ?? [],
    };
    if (flow) {
      next.mode = "flow";
      next.highlightedIds = flow.nodeIds;
      next.highlightedEdgeIds = flow.edgeIds;
    }
    return next;
  }, [root.interaction, root.flowIndex, root.highlightIndex, relationship, visibleHighlight, flow]);
  const navigation = useTreeNavigation({
    rows,
    windowRows,
    containerRef,
    collapsedIds,
    toggle,
    interaction,
  });
  const { focusedId, setFocusedId, reveal: revealItem } = navigation;
  const mountedRows = useMemo(() => {
    const focusedRow = rows.find((row) => row.node.id === focusedId);
    return focusedRow && !windowRows.includes(focusedRow)
      ? [...windowRows, focusedRow].sort(
          (first, second) =>
            (indexById.get(first.node.id) ?? 0) - (indexById.get(second.node.id) ?? 0),
        )
      : windowRows;
  }, [rows, windowRows, focusedId, indexById]);
  useLayoutEffect(() => {
    if (!revealRequest) return;
    revealItem(revealRequest.nodeId, revealRequest.shouldFocus);
    setRevealRequest(null);
  }, [revealRequest, revealItem]);
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
      mountedRows,
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
      mountedRows,
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
        <div {...stylex.props(styles.frame(requestedWidth))}>
          {controls && (controls === true ? <TreeControls /> : controls)}
          <ScrollArea
            css={styles.viewport(viewportHeight)}
            viewportProps={{
              ref: viewportRef,
              tabIndex: -1,
              onScroll: (event) => setScrollTop(event.currentTarget.scrollTop),
              "data-tree-viewport": "",
              "data-total-count": root.nodes.length,
              "data-visible-count": range.lastVisible - range.firstVisible,
              "data-mounted-count": mountedRows.length,
              "data-first-visible-index": range.firstVisible,
            }}
          >
            <DiagramCanvas
              data-slot="tree-view"
              {...props}
              data-tree-view=""
              ref={mergedRef}
              role={navigation.hasItems ? "tree" : "group"}
              tabIndex={focusedId === null ? 0 : -1}
              width={width}
              height={contentHeight}
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
              {children ?? (
                <>
                  <TreeScopes />
                  <TreeEdges />
                  <TreeItems />
                </>
              )}
            </DiagramCanvas>
          </ScrollArea>
        </div>
      </DiagramInteractionContext>
    </TreeViewContext>
  );
};
