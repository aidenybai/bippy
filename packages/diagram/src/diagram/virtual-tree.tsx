"use client";

import * as stylex from "@stylexjs/stylex";
import { useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { fonts, fontSizes, spacing } from "tailwind-stylex/tokens.stylex";
import { colors } from "./tokens.stylex";
import { diagramMetrics } from "./geometry";
import { DiagramNode } from "./primitives";
import { drawing } from "./drawing.stylex";
import { DiagramInteractionContext, useDiagramInteractionState } from "./interaction";
import {
  getExpandedRows,
  getIndentation,
  getNodeOffset,
  getTreeRows,
  getVirtualRange,
  type TreeNode,
} from "./tree-model";

export interface VirtualTreeProps {
  nodes: readonly TreeNode[];
  label: string;
  height?: number;
  rowHeight?: number;
  onSelect?: (node: TreeNode) => void;
}

export interface VirtualViewportProps {
  count: number;
  rowHeight: number;
  height: number;
}

const styles = stylex.create({
  viewport: (height: number) => ({
    height,
    overflowY: "auto",
    overflowX: "hidden",
    position: "relative",
    outline: "none",
    scrollbarColor: `${colors.border} transparent`,
    scrollbarWidth: "thin",
  }),
  spacer: (height: number) => ({ height, position: "relative" }),
  window: (offset: number) => ({
    position: "absolute",
    top: offset,
    left: 0,
    display: "block",
    overflow: "hidden",
  }),
  toggle: { cursor: "pointer", color: colors.muted, outline: "none" },
  hidden: { opacity: 0, pointerEvents: "none" },
  empty: {
    padding: spacing[4],
    fontFamily: fonts.sans,
    fontSize: fontSizes.xs,
    color: colors.muted,
  },
});

export const useVirtualViewport = ({ count, rowHeight, height }: VirtualViewportProps) => {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [width, setWidth] = useState(600);
  useLayoutEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    setWidth(element.clientWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const nextTop = Math.min(element.scrollTop, Math.max(0, count * rowHeight - height));
    element.scrollTop = nextTop;
    setScrollTop(nextTop);
  }, [count, rowHeight, height]);
  return {
    viewportRef,
    width,
    setScrollTop,
    range: getVirtualRange(count, scrollTop, height, rowHeight),
  };
};

export const VirtualTree = ({
  nodes,
  label,
  height = 396,
  rowHeight = diagramMetrics.rowHeight,
  onSelect,
}: VirtualTreeProps) => {
  const treeId = useId();
  const interaction = useDiagramInteractionState();
  const model = useMemo(() => getTreeRows(nodes), [nodes]);
  const modelIndexById = useMemo(
    () => new Map(model.map((row, index) => [row.node.id, index])),
    [model],
  );
  const [collapsedIds, setCollapsedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const rows = useMemo(() => getExpandedRows(model, collapsedIds), [model, collapsedIds]);
  const indexById = useMemo(() => new Map(rows.map((row, index) => [row.node.id, index])), [rows]);
  const { viewportRef, width, setScrollTop, range } = useVirtualViewport({
    count: rows.length,
    rowHeight,
    height,
  });
  const renderedRows = rows.slice(range.start, range.end);
  const indentation = getIndentation(rows.slice(range.firstVisible, range.lastVisible), width);
  const branchRows = [...renderedRows];
  let ancestorIndex = renderedRows[0]?.parentIndex ?? -1;
  while (ancestorIndex >= 0) {
    const ancestor = model[ancestorIndex];
    branchRows.push(ancestor);
    if (ancestor.depth <= indentation.baseDepth) break;
    ancestorIndex = ancestor.parentIndex;
  }
  const windowHeight = renderedRows.length * rowHeight;
  const getConnectorY = (nodeId: string) =>
    Math.max(
      -rowHeight,
      Math.min(
        windowHeight + rowHeight,
        (indexById.get(nodeId) ?? 0) * rowHeight + rowHeight / 2 - range.offset,
      ),
    );
  const selectedIndex = selectedId === null ? -1 : (indexById.get(selectedId) ?? -1);
  const activeRow = rows[Math.max(0, selectedIndex)];
  const selectedIsRendered = selectedIndex >= range.start && selectedIndex < range.end;
  const highlightedIndex =
    interaction.activeId === null ? undefined : modelIndexById.get(interaction.activeId);
  const highlightedRow = highlightedIndex === undefined ? undefined : model[highlightedIndex];

  const selectRow = (index: number, shouldScroll = false) => {
    const row = rows[index];
    if (!row) return;
    setSelectedId(row.node.id);
    onSelect?.(row.node);
    if (shouldScroll) interaction.setFocusedId(row.node.id);
    const element = viewportRef.current;
    if (shouldScroll && element) {
      const top = index * rowHeight;
      if (top < element.scrollTop) element.scrollTop = top;
      else if (top + rowHeight > element.scrollTop + height)
        element.scrollTop = top + rowHeight - height;
      setScrollTop(element.scrollTop);
    }
  };

  const toggleRow = (node: TreeNode) => {
    if (!collapsedIds.has(node.id) && selectedId !== null) {
      const rowIndex = modelIndexById.get(node.id);
      const currentIndex = modelIndexById.get(selectedId);
      if (
        rowIndex !== undefined &&
        currentIndex !== undefined &&
        currentIndex > rowIndex &&
        currentIndex < model[rowIndex].subtreeEnd
      ) {
        setSelectedId(node.id);
        interaction.setFocusedId(node.id);
        onSelect?.(node);
      }
    }
    setCollapsedIds((previous) => {
      const next = new Set(previous);
      if (next.has(node.id)) next.delete(node.id);
      else next.add(node.id);
      return next;
    });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (
      !activeRow ||
      !["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft", "Home", "End", "Enter", " "].includes(
        event.key,
      )
    )
      return;
    event.preventDefault();
    interaction.setHoveredId(null);
    interaction.setFocusedId(activeRow.node.id);
    interaction.setIsKeyboardNavigation(true);
    const currentIndex = Math.max(0, selectedIndex);
    if (event.key === "ArrowDown") selectRow(Math.min(rows.length - 1, selectedIndex + 1), true);
    if (event.key === "ArrowUp") selectRow(Math.max(0, selectedIndex - 1), true);
    if (event.key === "Home") selectRow(0, true);
    if (event.key === "End") selectRow(rows.length - 1, true);
    if (event.key === "Enter" || event.key === " ") selectRow(currentIndex, true);
    if (event.key === "ArrowRight" && activeRow.hasChildren) {
      if (collapsedIds.has(activeRow.node.id)) toggleRow(activeRow.node);
      else selectRow(currentIndex + 1, true);
    }
    if (event.key === "ArrowLeft") {
      if (activeRow.hasChildren && !collapsedIds.has(activeRow.node.id)) toggleRow(activeRow.node);
      else
        selectRow(
          activeRow.node.parentId === undefined
            ? -1
            : (indexById.get(activeRow.node.parentId) ?? -1),
          true,
        );
    }
  };

  return (
    <DiagramInteractionContext value={interaction}>
      <div
        ref={viewportRef}
        {...stylex.props(styles.viewport(height))}
        role="tree"
        aria-label={label}
        tabIndex={0}
        aria-activedescendant={
          selectedId !== null && selectedIsRendered ? `${treeId}-${selectedId}` : undefined
        }
        onKeyDown={handleKeyDown}
        onScroll={(event) => {
          interaction.setHoveredId(null);
          setScrollTop(event.currentTarget.scrollTop);
        }}
        onPointerLeave={() => interaction.setHoveredId(null)}
        onBlur={() => interaction.setFocusedId(null)}
        data-base-depth={indentation.baseDepth}
        data-indent-size={indentation.size}
        data-visible-count={range.lastVisible - range.firstVisible}
        data-mounted-count={renderedRows.length}
        data-total-count={nodes.length}
      >
        <div {...stylex.props(styles.spacer(range.totalHeight))} role="presentation">
          <svg
            width={width}
            height={windowHeight}
            textRendering="geometricPrecision"
            {...stylex.props(styles.window(range.offset))}
            role="presentation"
          >
            {branchRows.map((row) => {
              if (!row.hasChildren || collapsedIds.has(row.node.id)) return null;
              const isDimmed =
                interaction.activeId !== null &&
                interaction.activeId !== row.node.id &&
                highlightedRow?.node.parentId !== row.node.id;
              return (
                <path
                  key={`trunk-${row.node.id}`}
                  data-connector="trunk"
                  {...stylex.props(drawing.connector, isDimmed && drawing.dimmed)}
                  d={`M ${getNodeOffset(row.depth, indentation)} ${getConnectorY(row.node.id)} V ${getConnectorY(model[row.lastChildIndex].node.id)}`}
                />
              );
            })}
            {renderedRows.map((row) =>
              row.depth === 0 ? null : (
                <path
                  key={`branch-${row.node.id}`}
                  data-connector="branch"
                  {...stylex.props(
                    drawing.connector,
                    interaction.activeId !== null &&
                      interaction.activeId !== row.node.id &&
                      interaction.activeId !== row.node.parentId &&
                      drawing.dimmed,
                  )}
                  d={`M ${getNodeOffset(row.depth - 1, indentation)} ${getConnectorY(row.node.id)} H ${getNodeOffset(row.depth, indentation)}`}
                />
              ),
            )}
            {renderedRows.map((row, localIndex) => {
              const index = range.start + localIndex;
              const offset = getNodeOffset(row.depth, indentation);
              const centerY = localIndex * rowHeight + rowHeight / 2;
              const isHighlighted = interaction.activeId === row.node.id;
              return (
                <g
                  key={row.node.id}
                  id={`${treeId}-${row.node.id}`}
                  role="treeitem"
                  aria-label={row.node.label}
                  aria-level={row.depth + 1}
                  aria-posinset={row.position}
                  aria-setsize={row.siblingCount}
                  aria-expanded={row.hasChildren ? !collapsedIds.has(row.node.id) : undefined}
                  aria-selected={row.node.id === selectedId}
                  data-depth={row.depth}
                  onPointerEnter={() => interaction.setHoveredId(row.node.id)}
                  onPointerMove={() => {
                    interaction.setIsKeyboardNavigation(false);
                    interaction.setHoveredId(row.node.id);
                  }}
                  onPointerLeave={() => interaction.setHoveredId(null)}
                  onPointerDown={() => {
                    interaction.setIsKeyboardNavigation(false);
                    interaction.setFocusedId(null);
                  }}
                  onClick={() => {
                    selectRow(index);
                    interaction.setIsKeyboardNavigation(false);
                    viewportRef.current?.focus({ preventScroll: true });
                  }}
                >
                  <rect
                    data-row-hitbox
                    x={0}
                    y={localIndex * rowHeight}
                    width={width}
                    height={rowHeight}
                    fill="transparent"
                  />
                  <DiagramNode
                    isInteractive={false}
                    hitHeight={rowHeight}
                    node={row.node}
                    x={offset}
                    y={centerY}
                    maxWidth={width - offset - 8}
                    tabIndex={-1}
                  />
                  {row.hasChildren && (
                    <g
                      role="button"
                      tabIndex={-1}
                      aria-label={`${collapsedIds.has(row.node.id) ? "Expand" : "Collapse"} ${row.node.label}`}
                      transform={`translate(8 ${centerY})`}
                      {...stylex.props(
                        styles.toggle,
                        !isHighlighted && !collapsedIds.has(row.node.id) && styles.hidden,
                        interaction.activeId !== null &&
                          !isHighlighted &&
                          collapsedIds.has(row.node.id) &&
                          drawing.dimmed,
                      )}
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleRow(row.node);
                        viewportRef.current?.focus({ preventScroll: true });
                      }}
                    >
                      <rect
                        x={-8}
                        y={-rowHeight / 2}
                        width={16}
                        height={rowHeight}
                        fill="transparent"
                      />
                      <path
                        d={collapsedIds.has(row.node.id) ? "M-2 -4 2 0-2 4" : "M-4 -2 0 2 4-2"}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={1}
                      />
                    </g>
                  )}
                </g>
              );
            })}
          </svg>
        </div>
        {rows.length === 0 && <div {...stylex.props(styles.empty)}>No nodes to display.</div>}
      </div>
    </DiagramInteractionContext>
  );
};
