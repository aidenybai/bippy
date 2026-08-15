import { getDisplayName, getFiberId, getLatestFiber, isCompositeFiber, type Fiber } from "bippy";
import type { CSSProperties } from "react";

import type {
  ElementBoxDimensions,
  ElementOverlayBox,
  FiberTreeNode,
  InspectorEntry,
  OverlayTipPosition,
  SearchMatch,
} from "./fiber-tree-types";

const getIsRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export const getFiberName = (fiber: Fiber): string | null => getDisplayName(fiber.type);

export const getPropsEntries = (fiber: Fiber): InspectorEntry[] => {
  if (!getIsRecord(fiber.memoizedProps)) return [];

  return Object.entries(fiber.memoizedProps).map(([label, value]) => ({
    label,
    value,
  }));
};

export const getStateEntries = (fiber: Fiber): InspectorEntry[] => {
  const hookNamesValue = Reflect.get(fiber, "_debugHookTypes");
  const hookNames = Array.isArray(hookNamesValue)
    ? hookNamesValue.filter((hookName) => typeof hookName === "string")
    : [];
  const stateEntries: InspectorEntry[] = [];
  let hook: unknown = fiber.memoizedState;

  while (getIsRecord(hook) && "memoizedState" in hook && "next" in hook) {
    const hookName = hookNames[stateEntries.length] ?? "State";
    stateEntries.push({
      label: hookName.startsWith("use") ? hookName.slice(3) : hookName,
      value: hook.memoizedState,
    });
    hook = hook.next;
  }

  if (stateEntries.length > 0 || fiber.memoizedState === null) return stateEntries;
  return [{ label: "State", value: fiber.memoizedState }];
};

export const getObjectName = (value: object): string => {
  const constructorValue = Reflect.get(value, "constructor");
  if (typeof constructorValue === "function" && constructorValue.name) {
    return constructorValue.name;
  }
  return "Object";
};

export const getInspectableFiber = (fiber: Fiber): Fiber => {
  const latestFiber = getLatestFiber(fiber);
  let currentFiber: Fiber | null = latestFiber;

  while (currentFiber) {
    if (isCompositeFiber(currentFiber) && getFiberName(currentFiber)) return currentFiber;
    currentFiber = currentFiber.return;
  }

  return latestFiber;
};

export const getStandaloneFiberTreeNode = (fiber: Fiber): FiberTreeNode => {
  const latestFiber = getLatestFiber(fiber);
  return {
    depth: 0,
    fiber: latestFiber,
    fiberId: String(getFiberId(latestFiber)),
    hasChildren: latestFiber.child !== null,
    name: getFiberName(latestFiber) ?? "Fiber",
    parentFiberId: null,
  };
};

const getIsInspectionBoundary = (fiber: Fiber): boolean =>
  typeof fiber.memoizedProps === "object" &&
  fiber.memoizedProps !== null &&
  Object.prototype.hasOwnProperty.call(fiber.memoizedProps, "data-fiber-inspection-boundary");

export const getFiberTreeNodes = (rootFiber: Fiber): FiberTreeNode[] => {
  const fiberTreeNodes: FiberTreeNode[] = [];

  const addFiber = (fiber: Fiber, depth: number, parentFiberId: string | null): void => {
    const name = getFiberName(fiber);
    const fiberId = name ? String(getFiberId(fiber)) : parentFiberId;
    const nodeIndex = name ? fiberTreeNodes.length : -1;
    const childDepth = name ? depth + 1 : depth;
    const childParentFiberId = name ? fiberId : parentFiberId;

    if (name && fiberId) {
      fiberTreeNodes.push({
        depth,
        fiber,
        fiberId,
        hasChildren: false,
        name,
        parentFiberId,
      });
    }

    if (getIsInspectionBoundary(fiber)) return;

    const childStartIndex = fiberTreeNodes.length;
    let childFiber = fiber.child;
    while (childFiber) {
      addFiber(childFiber, childDepth, childParentFiberId);
      childFiber = childFiber.sibling;
    }

    if (nodeIndex >= 0) {
      fiberTreeNodes[nodeIndex].hasChildren = fiberTreeNodes.length > childStartIndex;
    }
  };

  addFiber(rootFiber, 0, null);
  return fiberTreeNodes;
};

export const getFiberNode = (
  fiberTreeNodes: FiberTreeNode[],
  fiberId: string,
): FiberTreeNode | undefined =>
  fiberTreeNodes.find((fiberTreeNode) => fiberTreeNode.fiberId === fiberId);

export const getIsDescendant = (
  fiberTreeNodes: FiberTreeNode[],
  fiberId: string,
  ancestorFiberId: string,
): boolean => {
  let parentFiberId = getFiberNode(fiberTreeNodes, fiberId)?.parentFiberId ?? null;

  while (parentFiberId) {
    if (parentFiberId === ancestorFiberId) return true;
    parentFiberId = getFiberNode(fiberTreeNodes, parentFiberId)?.parentFiberId ?? null;
  }

  return false;
};

export const getVisibleFiberNodes = (
  fiberTreeNodes: FiberTreeNode[],
  collapsedFiberIds: Set<string>,
): FiberTreeNode[] =>
  fiberTreeNodes.filter((fiberTreeNode) => {
    let parentFiberId = fiberTreeNode.parentFiberId;

    while (parentFiberId) {
      if (collapsedFiberIds.has(parentFiberId)) return false;
      parentFiberId = getFiberNode(fiberTreeNodes, parentFiberId)?.parentFiberId ?? null;
    }

    return true;
  });

export const getSearchMatch = (name: string, searchText: string): SearchMatch | null => {
  if (!searchText) return null;

  if (searchText.startsWith("/") && searchText.endsWith("/") && searchText.length > 2) {
    try {
      const match = name.match(new RegExp(searchText.slice(1, -1), "i"));
      if (match?.index !== undefined && match[0].length > 0) {
        return { start: match.index, end: match.index + match[0].length };
      }
    } catch {
      return null;
    }
  }

  const start = name.toLowerCase().indexOf(searchText.toLowerCase());
  return start < 0 ? null : { start, end: start + searchText.length };
};

export const getEventElement = (event: Event): Element | null => {
  const target = event.composed ? event.composedPath()[0] : event.target;
  return target instanceof Element ? target : null;
};

const getStyleNumber = (value: string): number => Number.parseInt(value, 10) || 0;

export const getElementBoxDimensions = (element: Element): ElementBoxDimensions => {
  const style = window.getComputedStyle(element);
  return {
    borderBottom: getStyleNumber(style.borderBottomWidth),
    borderLeft: getStyleNumber(style.borderLeftWidth),
    borderRight: getStyleNumber(style.borderRightWidth),
    borderTop: getStyleNumber(style.borderTopWidth),
    marginBottom: getStyleNumber(style.marginBottom),
    marginLeft: getStyleNumber(style.marginLeft),
    marginRight: getStyleNumber(style.marginRight),
    marginTop: getStyleNumber(style.marginTop),
    paddingBottom: getStyleNumber(style.paddingBottom),
    paddingLeft: getStyleNumber(style.paddingLeft),
    paddingRight: getStyleNumber(style.paddingRight),
    paddingTop: getStyleNumber(style.paddingTop),
  };
};

export const getBorderWidths = (
  top: number,
  right: number,
  bottom: number,
  left: number,
): CSSProperties => ({
  borderBottomWidth: bottom,
  borderLeftWidth: left,
  borderRightWidth: right,
  borderTopWidth: top,
});

export const getOverlayTipPosition = (
  overlayBox: ElementOverlayBox,
  tipWidth: number,
  tipHeight: number,
): OverlayTipPosition => {
  const { dimensions, rect } = overlayBox;
  const outerTop = rect.top - dimensions.marginTop;
  const outerLeft = rect.left - dimensions.marginLeft;
  const outerHeight = rect.height + dimensions.marginTop + dimensions.marginBottom;
  const minimumTipHeight = Math.max(tipHeight, 20);
  const minimumTipWidth = Math.max(tipWidth, 60);
  const margin = 5;
  let top = outerTop + outerHeight + margin;

  if (outerTop + outerHeight + minimumTipHeight > window.innerHeight) {
    top = Math.max(margin, outerTop - minimumTipHeight - margin);
  }

  return {
    left: Math.min(
      Math.max(margin, outerLeft + margin),
      window.innerWidth - minimumTipWidth - margin,
    ),
    top,
  };
};
