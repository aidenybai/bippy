"use client";

import { getFiber, getFiberId, getLatestFiber, type Fiber } from "bippy/core";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  getFiberNode,
  getFiberTreeNodes,
  getIsDescendant,
  getSearchMatch,
  getStandaloneFiberTreeNode,
  getVisibleFiberNodes,
} from "./fiber-tree-model";
import { fiberTreeClassNames, setFiberTreeDisplayName } from "./fiber-tree-styles";
import type { FiberTreeContextValue } from "./fiber-tree-types";

interface FiberTreeRootProps {
  children: ReactNode;
}

const FiberTreeContext = createContext<FiberTreeContextValue | null>(null);

export const useFiberTree = (): FiberTreeContextValue => {
  const context = useContext(FiberTreeContext);
  if (!context) throw new Error("Fiber tree components must be rendered inside FiberTree");
  return context;
};

export const FiberTreeRoot = ({ children }: FiberTreeRootProps) => {
  const [collapsedFiberIds, setCollapsedFiberIds] = useState(() => new Set<string>());
  const [doesPreferReducedMotion, setDoesPreferReducedMotion] = useState(false);
  const [inspectedPageFiber, setInspectedPageFiber] = useState<Fiber | null>(null);
  const [observedFiber, setObservedFiber] = useState<Fiber | null>(null);
  const [renderCount, setRenderCount] = useState(0);
  const [searchResultIndex, setSearchResultIndex] = useState(0);
  const [searchText, setSearchText] = useState("");
  const [selectedFiberId, setSelectedFiberId] = useState<string | null>(null);
  const [selectionRequestCount, setSelectionRequestCount] = useState(0);
  const figureElement = useRef<HTMLElement>(null);
  const committedFiber = observedFiber ? getLatestFiber(observedFiber) : null;
  const fiberTreeNodes = useMemo(
    () => (committedFiber ? getFiberTreeNodes(committedFiber) : []),
    [committedFiber, renderCount],
  );
  const visibleFiberNodes = useMemo(
    () => getVisibleFiberNodes(fiberTreeNodes, collapsedFiberIds),
    [collapsedFiberIds, fiberTreeNodes],
  );
  const isSelectedFiberVisible = visibleFiberNodes.some(
    (fiberTreeNode) => fiberTreeNode.fiberId === selectedFiberId,
  );
  const effectiveSelectedFiberId = inspectedPageFiber
    ? null
    : isSelectedFiberVisible
      ? selectedFiberId
      : (visibleFiberNodes[0]?.fiberId ?? null);
  const selectedFiberNode = visibleFiberNodes.find(
    (fiberTreeNode) => fiberTreeNode.fiberId === effectiveSelectedFiberId,
  );
  const inspectedPageFiberNode = inspectedPageFiber
    ? getStandaloneFiberTreeNode(inspectedPageFiber)
    : undefined;
  const inspectedFiberNode = inspectedPageFiberNode ?? selectedFiberNode;
  const searchResultFiberIds = visibleFiberNodes
    .filter((fiberTreeNode) => getSearchMatch(fiberTreeNode.name, searchText) !== null)
    .map((fiberTreeNode) => fiberTreeNode.fiberId);
  const currentSearchResultFiberId = searchResultFiberIds[searchResultIndex];

  useEffect(() => {
    const figureFiber = getFiber(figureElement.current);
    if (!figureFiber) return;

    const latestFigureFiber = getLatestFiber(figureFiber);
    let rootFiber = latestFigureFiber;
    while (rootFiber.return) rootFiber = rootFiber.return;
    setObservedFiber(rootFiber);
  }, []);

  useEffect(() => {
    const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updateMotionPreference = () => setDoesPreferReducedMotion(motionPreference.matches);

    updateMotionPreference();
    motionPreference.addEventListener("change", updateMotionPreference);
    return () => motionPreference.removeEventListener("change", updateMotionPreference);
  }, []);

  useEffect(() => {
    if (doesPreferReducedMotion) return;

    const renderInterval = window.setInterval(() => {
      setRenderCount((currentRenderCount) => currentRenderCount + 1);
    }, 1200);

    return () => window.clearInterval(renderInterval);
  }, [doesPreferReducedMotion]);

  const selectFiber = (fiberId: string): void => {
    setInspectedPageFiber(null);
    setSelectedFiberId(fiberId);
    setSelectionRequestCount((currentCount) => currentCount + 1);
  };

  const selectFiberFromPage = (fiber: Fiber): void => {
    const inspectableFiberId = String(getFiberId(fiber));
    const matchingFiberNode = fiberTreeNodes.find(
      (fiberTreeNode) =>
        fiberTreeNode.fiberId === inspectableFiberId ||
        fiberTreeNode.fiber === fiber ||
        fiberTreeNode.fiber.alternate === fiber,
    );

    if (!matchingFiberNode) {
      setInspectedPageFiber(fiber);
      setSelectionRequestCount((currentCount) => currentCount + 1);
      return;
    }

    setCollapsedFiberIds((currentFiberIds) => {
      const nextFiberIds = new Set(currentFiberIds);
      let parentFiberId = matchingFiberNode.parentFiberId;
      while (parentFiberId) {
        nextFiberIds.delete(parentFiberId);
        parentFiberId = getFiberNode(fiberTreeNodes, parentFiberId)?.parentFiberId ?? null;
      }
      return nextFiberIds;
    });
    setInspectedPageFiber(null);
    setSelectedFiberId(matchingFiberNode.fiberId);
    setSelectionRequestCount((currentCount) => currentCount + 1);
  };

  const toggleFiber = (fiberId: string): void => {
    const isCollapsing = !collapsedFiberIds.has(fiberId);
    setCollapsedFiberIds((currentFiberIds) => {
      const nextFiberIds = new Set(currentFiberIds);
      if (nextFiberIds.has(fiberId)) {
        nextFiberIds.delete(fiberId);
      } else {
        nextFiberIds.add(fiberId);
      }
      return nextFiberIds;
    });

    if (
      isCollapsing &&
      effectiveSelectedFiberId &&
      getIsDescendant(fiberTreeNodes, effectiveSelectedFiberId, fiberId)
    ) {
      setSelectedFiberId(fiberId);
    }
  };

  const setCurrentSearchResult = (nextResultIndex: number): void => {
    if (searchResultFiberIds.length === 0) return;
    const normalizedResultIndex =
      (nextResultIndex + searchResultFiberIds.length) % searchResultFiberIds.length;
    setSearchResultIndex(normalizedResultIndex);
    selectFiber(searchResultFiberIds[normalizedResultIndex]);
  };

  const updateSearchText = (nextSearchText: string): void => {
    setSearchText(nextSearchText);
    setSearchResultIndex(0);

    const firstResult = visibleFiberNodes.find(
      (fiberTreeNode) => getSearchMatch(fiberTreeNode.name, nextSearchText) !== null,
    );
    if (firstResult) selectFiber(firstResult.fiberId);
  };

  const contextValue: FiberTreeContextValue = {
    collapsedFiberIds,
    currentSearchResultFiberId,
    effectiveSelectedFiberId,
    fiberTreeNodes,
    inspectedFiberNode,
    renderCount,
    searchResultFiberIds,
    searchResultIndex,
    searchText,
    selectionRequestCount,
    visibleFiberNodes,
    selectFiber,
    selectFiberFromPage,
    setCurrentSearchResult,
    toggleFiber,
    updateSearchText,
  };

  return (
    <FiberTreeContext.Provider value={contextValue}>
      <figure
        ref={figureElement}
        className={fiberTreeClassNames.frame}
        aria-label="The visualization inspecting its own Fiber tree"
        data-render-count={renderCount}
      >
        <div className={fiberTreeClassNames.components}>{children}</div>
      </figure>
    </FiberTreeContext.Provider>
  );
};

setFiberTreeDisplayName(FiberTreeRoot, "FiberTree");
