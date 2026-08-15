"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { useFiberTree } from "./fiber-tree-context";
import { getSearchMatch } from "./fiber-tree-model";
import { fiberTreeClassNames, setFiberTreeDisplayName } from "./fiber-tree-styles";
import type { FiberTreeNode } from "./fiber-tree-types";

interface FiberTreeRowProps extends FiberTreeNode {
  currentSearchText: string;
  indentationSize: number;
  isCollapsed: boolean;
  isCurrentSearchResult: boolean;
  isSearchResult: boolean;
  isSelected: boolean;
  onSelect: () => void;
  onToggle: () => void;
}

interface FiberDisplayNameProps {
  isCurrentSearchResult: boolean;
  isSearchResult: boolean;
  name: string;
  searchText: string;
}

interface ExpandCollapseToggleProps {
  isCollapsed: boolean;
  isSelected: boolean;
  isVisible: boolean;
  onToggle: () => void;
}

const maximumIndentationSize = 12;
const minimumIndentationSize = 4;

const FiberDisplayName = ({
  isCurrentSearchResult,
  isSearchResult,
  name,
  searchText,
}: FiberDisplayNameProps) => {
  const match = isSearchResult ? getSearchMatch(name, searchText) : null;
  if (!match) return name;

  return (
    <>
      {name.slice(0, match.start)}
      <span
        className={isCurrentSearchResult ? fiberTreeClassNames.currentHighlight : "bg-yellow-300"}
      >
        {name.slice(match.start, match.end)}
      </span>
      {name.slice(match.end)}
    </>
  );
};

const ExpandCollapseToggle = ({
  isCollapsed,
  isSelected,
  isVisible,
  onToggle,
}: ExpandCollapseToggleProps) => {
  if (!isVisible) {
    return <span className={fiberTreeClassNames.expandCollapseToggle} aria-hidden="true" />;
  }

  return (
    <button
      type="button"
      className={cn(fiberTreeClassNames.expandCollapseToggle, isSelected && "text-white")}
      aria-label={isCollapsed ? "Expand subtree" : "Collapse subtree"}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
    >
      <svg className={fiberTreeClassNames.buttonIcon} width="24" height="24" viewBox="0 0 24 24">
        <path d="M0 0h24v24H0z" fill="none" />
        <path d={isCollapsed ? "M10 17l5-5-5-5v10z" : "M7 10l5 5 5-5z"} fill="currentColor" />
      </svg>
    </button>
  );
};

const FiberTreeRow = ({
  currentSearchText,
  depth,
  hasChildren,
  indentationSize,
  isCollapsed,
  isCurrentSearchResult,
  isSearchResult,
  isSelected,
  name,
  onSelect,
  onToggle,
}: FiberTreeRowProps) => (
  <div
    className={cn(fiberTreeClassNames.element, isSelected && fiberTreeClassNames.selectedElement)}
    data-fiber-depth={depth}
    role="treeitem"
    aria-expanded={hasChildren ? !isCollapsed : undefined}
    aria-selected={isSelected}
    tabIndex={0}
    onClick={onSelect}
    onKeyDown={(event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onSelect();
      }
    }}
  >
    <div
      className={fiberTreeClassNames.wrapper}
      style={{ transform: `translateX(${depth * indentationSize}px)` }}
    >
      <ExpandCollapseToggle
        isCollapsed={isCollapsed}
        isSelected={isSelected}
        isVisible={hasChildren}
        onToggle={onToggle}
      />
      <FiberDisplayName
        isCurrentSearchResult={isCurrentSearchResult}
        isSearchResult={isSearchResult}
        name={name}
        searchText={currentSearchText}
      />
    </div>
  </div>
);

const FiberTreeSkeleton = () => (
  <div className="motion-safe:[&_span]:animate-pulse" role="status">
    <span className="sr-only">Reading Fiber tree…</span>
    <div className="flex h-[22px] items-center bg-[#178fb9] px-1">
      <span className="mx-1 size-2 rounded-[2px] bg-[rgba(255,255,255,0.4)]" />
      <span className="h-2.5 w-32 rounded-[2px] bg-[rgba(255,255,255,0.4)]" />
    </div>
    <div className="flex h-[22px] items-center px-1 pl-2">
      <span className="mx-1 size-2 rounded-[2px] bg-[rgba(143,148,157,0.4)]" />
      <span className="h-2.5 w-8 rounded-[2px] bg-[rgba(97,218,251,0.28)]" />
    </div>
    <div className="flex h-[22px] items-center px-1 pl-3">
      <span className="mx-1 size-2 rounded-[2px] bg-[rgba(143,148,157,0.4)]" />
      <span className="h-2.5 w-20 rounded-[2px] bg-[rgba(97,218,251,0.28)]" />
    </div>
    <div className="flex h-[22px] items-center px-1 pl-4">
      <span className="mx-1 size-2 rounded-[2px] bg-[rgba(143,148,157,0.4)]" />
      <span className="h-2.5 w-16 rounded-[2px] bg-[rgba(97,218,251,0.28)]" />
    </div>
    <div className="flex h-[22px] items-center px-1 pl-5">
      <span className="mx-1 size-2 rounded-[2px] bg-[rgba(143,148,157,0.4)]" />
      <span className="h-2.5 w-24 rounded-[2px] bg-[rgba(97,218,251,0.28)]" />
    </div>
    <div className="flex h-[22px] items-center px-1 pl-6">
      <span className="mx-1 size-2 rounded-[2px] bg-[rgba(143,148,157,0.4)]" />
      <span className="h-2.5 w-36 rounded-[2px] bg-[rgba(97,218,251,0.28)]" />
    </div>
  </div>
);

export const FiberTreeList = () => {
  const {
    collapsedFiberIds,
    currentSearchResultFiberId,
    effectiveSelectedFiberId,
    searchResultFiberIds,
    searchText,
    selectionRequestCount,
    visibleFiberNodes,
    selectFiber,
    toggleFiber,
  } = useFiberTree();
  const [indentationSize, setIndentationSize] = useState(maximumIndentationSize);
  const [listWidth, setListWidth] = useState(0);
  const indentationSizeValue = useRef(maximumIndentationSize);
  const listElement = useRef<HTMLDivElement>(null);
  const previousListWidth = useRef(0);

  useLayoutEffect(() => {
    const currentListElement = listElement.current;
    if (!currentListElement) return;

    const updateListWidth = () => setListWidth(currentListElement.clientWidth);
    const resizeObserver = new ResizeObserver(updateListWidth);
    resizeObserver.observe(currentListElement);
    updateListWidth();

    return () => resizeObserver.disconnect();
  }, []);

  useLayoutEffect(() => {
    const currentListElement = listElement.current;
    if (!currentListElement || listWidth === 0) return;

    let nextIndentationSize = indentationSizeValue.current;
    if (listWidth > previousListWidth.current) {
      nextIndentationSize = maximumIndentationSize;
    }
    previousListWidth.current = listWidth;

    const fiberRows = currentListElement.querySelectorAll("[data-fiber-depth]");
    for (const fiberRow of fiberRows) {
      const depth = Number(fiberRow.getAttribute("data-fiber-depth"));
      const rowContent = fiberRow.firstElementChild;
      if (depth <= 0 || !(rowContent instanceof HTMLElement)) continue;

      const remainingWidth = Math.max(0, listWidth - rowContent.clientWidth);
      nextIndentationSize = Math.min(nextIndentationSize, remainingWidth / depth);
    }

    nextIndentationSize = Math.max(nextIndentationSize, minimumIndentationSize);
    indentationSizeValue.current = nextIndentationSize;
    setIndentationSize(nextIndentationSize);
  }, [listWidth, visibleFiberNodes]);

  useEffect(() => {
    const selectedElement = listElement.current?.querySelector('[aria-selected="true"]');
    selectedElement?.scrollIntoView({ block: "nearest" });
  }, [effectiveSelectedFiberId, selectionRequestCount]);

  return (
    <div className={fiberTreeClassNames.autoSizerWrapper} tabIndex={0}>
      <div
        ref={listElement}
        className={fiberTreeClassNames.list}
        role="tree"
        aria-label="Fiber tree"
        data-fiber-inspection-boundary
      >
        {visibleFiberNodes.length > 0 ? (
          visibleFiberNodes.map((fiberTreeNode) => (
            <FiberTreeRow
              key={fiberTreeNode.fiberId}
              {...fiberTreeNode}
              currentSearchText={searchText}
              indentationSize={indentationSize}
              isCollapsed={collapsedFiberIds.has(fiberTreeNode.fiberId)}
              isCurrentSearchResult={fiberTreeNode.fiberId === currentSearchResultFiberId}
              isSearchResult={searchResultFiberIds.includes(fiberTreeNode.fiberId)}
              isSelected={fiberTreeNode.fiberId === effectiveSelectedFiberId}
              onSelect={() => selectFiber(fiberTreeNode.fiberId)}
              onToggle={() => toggleFiber(fiberTreeNode.fiberId)}
            />
          ))
        ) : (
          <FiberTreeSkeleton />
        )}
      </div>
    </div>
  );
};

setFiberTreeDisplayName(ExpandCollapseToggle, "ExpandCollapseToggle");
setFiberTreeDisplayName(FiberDisplayName, "FiberDisplayName");
setFiberTreeDisplayName(FiberTreeList, "FiberTreeList");
setFiberTreeDisplayName(FiberTreeRow, "FiberTreeRow");
setFiberTreeDisplayName(FiberTreeSkeleton, "FiberTreeSkeleton");
