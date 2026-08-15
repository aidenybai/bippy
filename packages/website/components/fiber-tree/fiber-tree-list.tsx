"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { useFiberTree } from "./fiber-tree-context";
import { getSearchMatch } from "./fiber-tree-model";
import { fiberTreeClassNames, setFiberTreeDisplayName } from "./fiber-tree-styles";

interface FiberTreeRowProps {
  collapseState: "collapsed" | "expanded" | "leaf";
  currentSearchText: string;
  depth: number;
  indentationSize: number;
  isSelected: boolean;
  name: string;
  onSelect: () => void;
  onToggle: () => void;
  searchMatchState: "current" | "match" | null;
}

interface FiberDisplayNameProps {
  matchState: "current" | "match" | null;
  name: string;
  searchText: string;
}

interface ExpandCollapseToggleProps {
  collapseState: "collapsed" | "expanded" | "leaf";
  isSelected: boolean;
  onToggle: () => void;
}

const maximumIndentationSize = 12;
const minimumIndentationSize = 4;

const FiberDisplayName = ({ matchState, name, searchText }: FiberDisplayNameProps) => {
  const match = matchState ? getSearchMatch(name, searchText) : null;
  if (!match) return name;

  return (
    <>
      {name.slice(0, match.start)}
      <span
        className={
          matchState === "current" ? fiberTreeClassNames.currentHighlight : "bg-yellow-300"
        }
      >
        {name.slice(match.start, match.end)}
      </span>
      {name.slice(match.end)}
    </>
  );
};

const ExpandCollapseToggle = ({
  collapseState,
  isSelected,
  onToggle,
}: ExpandCollapseToggleProps) => {
  if (collapseState === "leaf") {
    return <span className={fiberTreeClassNames.expandCollapseToggle} aria-hidden="true" />;
  }

  return (
    <button
      type="button"
      className={cn(fiberTreeClassNames.expandCollapseToggle, isSelected && "text-white")}
      aria-label={collapseState === "collapsed" ? "Expand subtree" : "Collapse subtree"}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
    >
      <svg className={fiberTreeClassNames.buttonIcon} width="24" height="24" viewBox="0 0 24 24">
        <path d="M0 0h24v24H0z" fill="none" />
        <path
          d={collapseState === "collapsed" ? "M10 17l5-5-5-5v10z" : "M7 10l5 5 5-5z"}
          fill="currentColor"
        />
      </svg>
    </button>
  );
};

const FiberTreeRow = ({
  collapseState,
  currentSearchText,
  depth,
  indentationSize,
  isSelected,
  name,
  onSelect,
  onToggle,
  searchMatchState,
}: FiberTreeRowProps) => (
  <div
    className={cn(fiberTreeClassNames.element, isSelected && fiberTreeClassNames.selectedElement)}
    data-fiber-depth={depth}
    role="treeitem"
    aria-expanded={collapseState === "leaf" ? undefined : collapseState === "expanded"}
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
        collapseState={collapseState}
        isSelected={isSelected}
        onToggle={onToggle}
      />
      <FiberDisplayName matchState={searchMatchState} name={name} searchText={currentSearchText} />
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
  const searchResultFiberIdSet = useMemo(
    () => new Set(searchResultFiberIds),
    [searchResultFiberIds],
  );

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
    <div className={fiberTreeClassNames.autoSizerWrapper}>
      <div
        ref={listElement}
        className={fiberTreeClassNames.list}
        role="tree"
        aria-label="Fiber tree"
        data-fiber-inspection-boundary
      >
        {visibleFiberNodes.length > 0 ? (
          visibleFiberNodes.map((fiberTreeNode) => {
            const collapseState = !fiberTreeNode.hasChildren
              ? "leaf"
              : collapsedFiberIds.has(fiberTreeNode.fiberId)
                ? "collapsed"
                : "expanded";
            const searchMatchState =
              fiberTreeNode.fiberId === currentSearchResultFiberId
                ? "current"
                : searchResultFiberIdSet.has(fiberTreeNode.fiberId)
                  ? "match"
                  : null;

            return (
              <FiberTreeRow
                key={fiberTreeNode.fiberId}
                collapseState={collapseState}
                currentSearchText={searchText}
                depth={fiberTreeNode.depth}
                indentationSize={indentationSize}
                isSelected={fiberTreeNode.fiberId === effectiveSelectedFiberId}
                name={fiberTreeNode.name}
                onSelect={() => selectFiber(fiberTreeNode.fiberId)}
                onToggle={() => toggleFiber(fiberTreeNode.fiberId)}
                searchMatchState={searchMatchState}
              />
            );
          })
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
