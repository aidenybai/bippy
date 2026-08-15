import type { Fiber } from "bippy";

export interface FiberTreeNode {
  depth: number;
  fiber: Fiber;
  fiberId: string;
  hasChildren: boolean;
  name: string;
  parentFiberId: string | null;
}

export interface SearchMatch {
  end: number;
  start: number;
}

export interface InspectorEntry {
  label: string;
  value: unknown;
}

export interface ElementBoxDimensions {
  borderBottom: number;
  borderLeft: number;
  borderRight: number;
  borderTop: number;
  marginBottom: number;
  marginLeft: number;
  marginRight: number;
  marginTop: number;
  paddingBottom: number;
  paddingLeft: number;
  paddingRight: number;
  paddingTop: number;
}

export interface ElementOverlayBox {
  dimensions: ElementBoxDimensions;
  rect: DOMRect;
}

export interface OverlayTipPosition {
  left: number;
  top: number;
}

export interface FiberTreeContextValue {
  collapsedFiberIds: Set<string>;
  currentSearchResultFiberId: string | undefined;
  effectiveSelectedFiberId: string | null;
  fiberTreeNodes: FiberTreeNode[];
  inspectedFiberNode: FiberTreeNode | undefined;
  renderCount: number;
  searchResultFiberIds: string[];
  searchResultIndex: number;
  searchText: string;
  selectionRequestCount: number;
  visibleFiberNodes: FiberTreeNode[];
  selectFiber: (fiberId: string) => void;
  selectFiberFromPage: (fiber: Fiber) => void;
  setCurrentSearchResult: (nextResultIndex: number) => void;
  toggleFiber: (fiberId: string) => void;
  updateSearchText: (nextSearchText: string) => void;
}
