"use client";

import {
  getDisplayName,
  getFiber,
  getFiberId,
  getLatestFiber,
  isCompositeFiber,
  type Fiber,
} from "bippy/core";
import {
  type CSSProperties,
  type ReactNode,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { chromeDark, ObjectInspector } from "react-inspector";

import { cn } from "@/lib/utils";

interface FiberTreeNode {
  depth: number;
  fiber: Fiber;
  fiberId: string;
  hasChildren: boolean;
  name: string;
  parentFiberId: string | null;
}

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

interface SearchButtonProps {
  icon: "close" | "down" | "up";
  label: string;
  onClick: () => void;
}

interface SearchMatch {
  end: number;
  start: number;
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

interface FiberTreeLayoutProps {
  children: ReactNode;
}

interface FiberListProps {
  children: ReactNode;
  listElement: RefObject<HTMLDivElement | null>;
}

interface FiberInspectorProps {
  fiberTreeNode: FiberTreeNode | undefined;
}

interface ElementBoxDimensions {
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

interface ElementPickerOverlayProps {
  element: Element | null;
  fiberName: string | null;
}

interface ElementPickerToggleProps {
  isInspecting: boolean;
  onChange: () => void;
}

interface ElementOverlayBox {
  dimensions: ElementBoxDimensions;
  rect: DOMRect;
}

interface OverlayTipPosition {
  left: number;
  top: number;
}

interface InspectorEntry {
  label: string;
  value: unknown;
}

interface InspectorSectionProps {
  entries: InspectorEntry[];
  showIndices?: boolean;
  title: string;
}

interface InspectorValueProps {
  value: unknown;
}

const maximumIndentationSize = 12;
const minimumIndentationSize = 4;
const devtoolsMonoFont =
  "font-[SFMono-Regular,Consolas,'Liberation_Mono',Menlo,Courier,monospace]";
Object.assign(chromeDark, {
  ARROW_COLOR: "#8f949d",
  BASE_BACKGROUND_COLOR: "transparent",
  BASE_COLOR: "#ffffff",
  BASE_FONT_FAMILY:
    '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, Courier, monospace',
  BASE_FONT_SIZE: "13px",
  OBJECT_NAME_COLOR: "#ededed",
  OBJECT_VALUE_BOOLEAN_COLOR: "#cedae0",
  OBJECT_VALUE_FUNCTION_PREFIX_COLOR: "#61dafb",
  OBJECT_VALUE_NULL_COLOR: "#777d88",
  OBJECT_VALUE_NUMBER_COLOR: "#cedae0",
  OBJECT_VALUE_REGEXP_COLOR: "#cedae0",
  OBJECT_VALUE_STRING_COLOR: "#cedae0",
  OBJECT_VALUE_SYMBOL_COLOR: "#cedae0",
  OBJECT_VALUE_UNDEFINED_COLOR: "#777d88",
  TREENODE_FONT_FAMILY:
    '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, Courier, monospace',
  TREENODE_FONT_SIZE: "13px",
  TREENODE_LINE_HEIGHT: 1.69,
});
const fiberTreeClassNames = {
  autoSizerWrapper:
    "min-h-0 w-full flex-[1_1_0] overflow-hidden focus:outline-none",
  button:
    "m-0 flex-[0_0_auto] cursor-pointer rounded border-0 bg-[#1b1d23] p-0 text-[#afb3b9] hover:bg-[rgba(255,255,255,0.2)] hover:text-[#ededed] active:text-[#61dafb] focus:outline-none disabled:cursor-default disabled:bg-[#1b1d23] disabled:text-[#4f5766] [&:focus>span]:bg-[#30343c]",
  buttonContent: "inline-flex items-center rounded p-1 focus:outline-none",
  buttonIcon: "size-4 fill-current",
  componentName: cn(
    "max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-[13px] text-[#61dafb]",
    devtoolsMonoFont
  ),
  components:
    "relative flex h-80 w-full flex-row overflow-hidden border border-[#30343c] bg-[#1b1d23] font-sans leading-normal text-white [-webkit-font-smoothing:auto] [&_*]:box-border [&_*]:[-webkit-font-smoothing:auto] @max-[599px]:h-[420px] @max-[599px]:flex-col",
  currentHighlight: "bg-[#f7923b]",
  element: "h-[22px] text-[#61dafb] hover:bg-[rgba(255,255,255,0.1)]",
  expandCollapseToggle:
    "m-0 inline-flex size-4 flex-[0_0_1rem] items-center justify-center border-0 bg-transparent p-0 text-[#8f949d]",
  frame: "@container w-full",
  icon: "size-4 flex-[0_0_1rem] fill-current",
  indexInput:
    "m-0 box-content min-w-[1.5ch] rounded-sm border border-[#30343c] bg-transparent px-1 py-0 text-center font-inherit text-sm text-white outline-none focus:bg-[#30343c]",
  indexLabel: "whitespace-pre text-sm text-[#8f949d]",
  input:
    "-ml-4 w-[100px] flex-[1_1_100px] border-0 bg-[#1b1d23] pl-6 font-sans text-base text-white outline-none placeholder:text-[#8f949d]",
  inputIcon: "pointer-events-none z-2 text-[#777d88]",
  inspectedElement: "flex h-full min-h-0 w-full flex-col",
  inspectedElementView: cn(
    "min-h-0 flex-[1_1_0] overflow-x-hidden overflow-y-auto text-[13px] leading-[22px]",
    devtoolsMonoFont
  ),
  inspectedElementWrapper:
    "min-h-0 min-w-0 flex-[1_1_35%] overflow-x-hidden overflow-y-auto border-l border-[#30343c] @max-[599px]:flex-[1_1_50%] @max-[599px]:border-l-0",
  leftVRule: "mr-1 ml-2 h-5 w-px bg-[#30343c]",
  list: cn(
    "relative h-full overflow-auto text-[13px] leading-[22px] select-none",
    devtoolsMonoFont
  ),
  resizeBarWrapper: "relative flex-[0_0_0]",
  searchInput: "flex flex-[1_1_auto] items-center",
  selectedComponentName:
    "flex h-full flex-[1_1_auto] items-end overflow-hidden py-1",
  selectedElement: "bg-[#178fb9] text-white hover:bg-[#178fb9]",
  titleRow:
    "flex flex-[0_0_42px] items-center border-b border-[#30343c] p-2 text-[17px]",
  tree: "relative flex h-full min-h-0 w-full flex-col",
  treeSearchInput:
    "flex flex-[0_0_42px] items-center border-b border-[#30343c] p-2",
  treeWrapper:
    "min-h-0 min-w-0 flex-[0_0_65%] overflow-hidden @max-[599px]:flex-[0_0_50%]",
  wrapper:
    "relative inline-flex h-[22px] cursor-default items-center px-1 leading-[22px] whitespace-pre select-none",
};

const setDisplayName = (component: object, displayName: string): void => {
  Reflect.set(component, "displayName", displayName);
};

const getFiberName = (fiber: Fiber): string | null =>
  getDisplayName(fiber.type);

const getIsRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const getPropsEntries = (fiber: Fiber): InspectorEntry[] => {
  if (!getIsRecord(fiber.memoizedProps)) return [];

  return Object.entries(fiber.memoizedProps).map(([label, value]) => ({
    label,
    value,
  }));
};

const getStateEntries = (fiber: Fiber): InspectorEntry[] => {
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

  if (stateEntries.length > 0 || fiber.memoizedState === null)
    return stateEntries;
  return [{ label: "State", value: fiber.memoizedState }];
};

const getObjectName = (value: object): string => {
  const constructorValue = Reflect.get(value, "constructor");
  if (typeof constructorValue === "function" && constructorValue.name) {
    return constructorValue.name;
  }
  return "Object";
};

const getInspectableFiber = (fiber: Fiber): Fiber => {
  const latestFiber = getLatestFiber(fiber);
  let currentFiber: Fiber | null = latestFiber;

  while (currentFiber) {
    if (isCompositeFiber(currentFiber) && getFiberName(currentFiber))
      return currentFiber;
    currentFiber = currentFiber.return;
  }

  return latestFiber;
};

const getStandaloneFiberTreeNode = (fiber: Fiber): FiberTreeNode => {
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

const getEventElement = (event: Event): Element | null => {
  const target = event.composed ? event.composedPath()[0] : event.target;
  return target instanceof Element ? target : null;
};

const getStyleNumber = (value: string): number =>
  Number.parseInt(value, 10) || 0;

const getElementBoxDimensions = (element: Element): ElementBoxDimensions => {
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

const getBorderWidths = (
  top: number,
  right: number,
  bottom: number,
  left: number
): CSSProperties => ({
  borderBottomWidth: bottom,
  borderLeftWidth: left,
  borderRightWidth: right,
  borderTopWidth: top,
});

const getOverlayTipPosition = (
  overlayBox: ElementOverlayBox,
  tipWidth: number,
  tipHeight: number
): OverlayTipPosition => {
  const { dimensions, rect } = overlayBox;
  const outerTop = rect.top - dimensions.marginTop;
  const outerLeft = rect.left - dimensions.marginLeft;
  const outerHeight =
    rect.height + dimensions.marginTop + dimensions.marginBottom;
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
      window.innerWidth - minimumTipWidth - margin
    ),
    top,
  };
};

const getIsInspectionBoundary = (fiber: Fiber): boolean =>
  typeof fiber.memoizedProps === "object" &&
  fiber.memoizedProps !== null &&
  Object.prototype.hasOwnProperty.call(
    fiber.memoizedProps,
    "data-fiber-inspection-boundary"
  );

const getFiberTreeNodes = (rootFiber: Fiber): FiberTreeNode[] => {
  const fiberTreeNodes: FiberTreeNode[] = [];

  const addFiber = (
    fiber: Fiber,
    depth: number,
    parentFiberId: string | null
  ): void => {
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
      fiberTreeNodes[nodeIndex].hasChildren =
        fiberTreeNodes.length > childStartIndex;
    }
  };

  addFiber(rootFiber, 0, null);
  return fiberTreeNodes;
};

const getFiberNode = (
  fiberTreeNodes: FiberTreeNode[],
  fiberId: string
): FiberTreeNode | undefined =>
  fiberTreeNodes.find((fiberNode) => fiberNode.fiberId === fiberId);

const getIsDescendant = (
  fiberTreeNodes: FiberTreeNode[],
  fiberId: string,
  ancestorFiberId: string
): boolean => {
  let parentFiberId =
    getFiberNode(fiberTreeNodes, fiberId)?.parentFiberId ?? null;

  while (parentFiberId) {
    if (parentFiberId === ancestorFiberId) return true;
    parentFiberId =
      getFiberNode(fiberTreeNodes, parentFiberId)?.parentFiberId ?? null;
  }

  return false;
};

const getVisibleFiberNodes = (
  fiberTreeNodes: FiberTreeNode[],
  collapsedFiberIds: Set<string>
): FiberTreeNode[] =>
  fiberTreeNodes.filter((fiberNode) => {
    let parentFiberId = fiberNode.parentFiberId;

    while (parentFiberId) {
      if (collapsedFiberIds.has(parentFiberId)) return false;
      parentFiberId =
        getFiberNode(fiberTreeNodes, parentFiberId)?.parentFiberId ?? null;
    }

    return true;
  });

const getSearchMatch = (
  name: string,
  searchText: string
): SearchMatch | null => {
  if (!searchText) return null;

  if (
    searchText.startsWith("/") &&
    searchText.endsWith("/") &&
    searchText.length > 2
  ) {
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

const searchButtonPaths = {
  close:
    "M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z",
  down: "M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z",
  up: "M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z",
};

const SearchIcon = () => (
  <svg
    className={cn(fiberTreeClassNames.icon, fiberTreeClassNames.inputIcon)}
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
  </svg>
);

const ElementPickerToggle = ({
  isInspecting,
  onChange,
}: ElementPickerToggleProps) => (
  <button
    className={cn(fiberTreeClassNames.button, isInspecting && "text-[#61dafb]")}
    type="button"
    aria-label="Select an element in the page to inspect it"
    aria-pressed={isInspecting}
    data-fiber-inspector-toggle
    title="Select an element in the page to inspect it"
    onClick={onChange}
  >
    <span className={fiberTreeClassNames.buttonContent}>
      <svg
        className={fiberTreeClassNames.icon}
        width="24"
        height="24"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path d="M0 0h24v24H0z" fill="none" />
        <path
          fill="currentColor"
          d="M8.5,22H3.7l-1.4-1.5V3.8l1.3-1.5h17.2l1,1.5v4.9h-1.3V4.3l-0.4-0.6H4.2L3.6,4.3V20l0.7,0.7h4.2V22z M23,13.9l-4.6,3.6l4.6,4.6l-1.1,1.1l-4.7-4.4l-3.3,4.4l-3.2-12.3L23,13.9z"
        />
      </svg>
    </span>
  </button>
);

const SearchButton = ({ icon, label, onClick }: SearchButtonProps) => (
  <button
    className={fiberTreeClassNames.button}
    type="button"
    aria-label={label}
    onClick={onClick}
  >
    <span className={fiberTreeClassNames.buttonContent}>
      <svg
        className={fiberTreeClassNames.icon}
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path d={searchButtonPaths[icon]} />
      </svg>
    </span>
  </button>
);

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
        className={
          isCurrentSearchResult
            ? fiberTreeClassNames.currentHighlight
            : "bg-yellow-300"
        }
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
    return (
      <span
        className={fiberTreeClassNames.expandCollapseToggle}
        aria-hidden="true"
      />
    );
  }

  return (
    <button
      type="button"
      className={cn(
        fiberTreeClassNames.expandCollapseToggle,
        isSelected && "text-white"
      )}
      aria-label={isCollapsed ? "Expand subtree" : "Collapse subtree"}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
    >
      <svg
        className={fiberTreeClassNames.buttonIcon}
        width="24"
        height="24"
        viewBox="0 0 24 24"
      >
        <path d="M0 0h24v24H0z" fill="none" />
        <path
          d={isCollapsed ? "M10 17l5-5-5-5v10z" : "M7 10l5 5 5-5z"}
          fill="currentColor"
        />
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
    className={cn(
      fiberTreeClassNames.element,
      isSelected && fiberTreeClassNames.selectedElement
    )}
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

const FiberTreeLayout = ({ children }: FiberTreeLayoutProps) => (
  <div className={fiberTreeClassNames.components}>{children}</div>
);

const FiberTreePane = ({ children }: FiberTreeLayoutProps) => (
  <section className={fiberTreeClassNames.treeWrapper}>
    <div className={fiberTreeClassNames.tree}>{children}</div>
  </section>
);

const FiberSearch = ({ children }: FiberTreeLayoutProps) => (
  <header className={fiberTreeClassNames.treeSearchInput}>
    <div className={fiberTreeClassNames.searchInput}>{children}</div>
  </header>
);

const FiberList = ({ children, listElement }: FiberListProps) => (
  <div className={fiberTreeClassNames.autoSizerWrapper} tabIndex={0}>
    <div
      ref={listElement}
      className={fiberTreeClassNames.list}
      role="tree"
      aria-label="Fiber tree"
      data-fiber-inspection-boundary
    >
      {children}
    </div>
  </div>
);

const InspectorValue = ({ value }: InspectorValueProps) => {
  if (typeof value === "string") {
    return <span className="text-[#cedae0]">{JSON.stringify(value)}</span>;
  }
  if (typeof value === "number" || typeof value === "bigint") {
    return <span className="text-[#cedae0]">{String(value)}</span>;
  }
  if (typeof value === "boolean") {
    return <span className="text-[#cedae0]">{String(value)}</span>;
  }
  if (typeof value === "function") {
    return (
      <span className="text-[#cedae0]">{`ƒ ${
        value.name || "anonymous"
      }()`}</span>
    );
  }
  if (value === null) return <span className="text-[#777d88]">null</span>;
  if (value === undefined)
    return <span className="text-[#777d88]">undefined</span>;
  if (Array.isArray(value)) {
    return <span className="text-[#cedae0]">{`Array(${value.length})`}</span>;
  }

  return <span className="text-[#cedae0]">{getObjectName(value)}</span>;
};

const InspectorSection = ({
  entries,
  showIndices = false,
  title,
}: InspectorSectionProps) => {
  if (entries.length === 0) return null;

  return (
    <section className="border-b border-[#30343c] p-1">
      <h2 className="font-sans text-[13px] font-medium text-white">{title}</h2>
      <div>
        {entries.map((entry, entryIndex) => (
          <div
            key={`${entry.label}-${entryIndex}`}
            className="flex min-w-0 items-baseline"
          >
            {showIndices ? (
              <span className="mr-1 inline-flex min-w-[22px] items-center justify-center rounded-[2px] bg-[rgba(0,0,0,0.25)] px-1 py-0.5 text-[11px] leading-4 text-[rgba(255,255,255,0.7)]">
                {entryIndex + 1}
              </span>
            ) : null}
            <div className="min-w-0 truncate pl-2">
              <span
                className={showIndices ? "text-[#61dafb]" : "text-[#ededed]"}
              >
                {entry.label}
              </span>
              <span className="mr-2 text-white">: </span>
              <InspectorValue value={entry.value} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};

const FiberInspector = ({ fiberTreeNode }: FiberInspectorProps) => (
  <aside className={fiberTreeClassNames.inspectedElementWrapper}>
    <div className={fiberTreeClassNames.inspectedElement}>
      <header className={fiberTreeClassNames.titleRow}>
        <div className={fiberTreeClassNames.selectedComponentName}>
          <div className={fiberTreeClassNames.componentName}>
            {fiberTreeNode?.name ?? "Fiber"}
          </div>
        </div>
      </header>
      <div
        className={fiberTreeClassNames.inspectedElementView}
        data-fiber-inspection-boundary
      >
        {fiberTreeNode ? (
          <div>
            <InspectorSection
              title="props"
              entries={getPropsEntries(fiberTreeNode.fiber)}
            />
            <InspectorSection
              title="state"
              entries={getStateEntries(fiberTreeNode.fiber)}
              showIndices
            />
            <div className="p-1 [&_span]:not-italic!">
              <ObjectInspector
                data={fiberTreeNode.fiber}
                name="fiber"
                expandLevel={0}
                theme="chromeDark"
              />
            </div>
          </div>
        ) : (
          <FiberInspectorSkeleton />
        )}
      </div>
    </div>
  </aside>
);

const FiberResizeHandle = () => (
  <div className={fiberTreeClassNames.resizeBarWrapper} />
);

const FiberTreeSkeleton = () => (
  <div className="space-y-2 px-3 py-2 motion-safe:animate-pulse" role="status">
    <span className="sr-only">Reading Fiber tree…</span>
    <div className="h-3 w-1/3 rounded-sm bg-neutral-800" />
    <div className="ml-3 h-3 w-2/5 rounded-sm bg-neutral-800" />
    <div className="ml-6 h-3 w-1/2 rounded-sm bg-neutral-800" />
    <div className="ml-9 h-3 w-1/3 rounded-sm bg-neutral-800" />
    <div className="ml-6 h-3 w-3/5 rounded-sm bg-neutral-800" />
    <div className="ml-9 h-3 w-2/5 rounded-sm bg-neutral-800" />
  </div>
);

const FiberInspectorSkeleton = () => (
  <div className="space-y-3 motion-safe:animate-pulse" role="status">
    <span className="sr-only">Reading Fiber details…</span>
    <div className="h-3 w-1/3 rounded-sm bg-neutral-800" />
    <div className="ml-3 h-3 w-3/4 rounded-sm bg-neutral-800" />
    <div className="ml-3 h-3 w-1/2 rounded-sm bg-neutral-800" />
    <div className="h-3 w-2/5 rounded-sm bg-neutral-800" />
    <div className="ml-3 h-3 w-2/3 rounded-sm bg-neutral-800" />
  </div>
);

const ElementPickerOverlay = ({
  element,
  fiberName,
}: ElementPickerOverlayProps) => {
  const [overlayBox, setOverlayBox] = useState<ElementOverlayBox | null>(null);
  const [tipPosition, setTipPosition] = useState<OverlayTipPosition>({
    left: 5,
    top: 5,
  });
  const tipElement = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!element) {
      setOverlayBox(null);
      return;
    }

    let animationFrame = 0;
    const updateOverlayBox = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(() => {
        if (!element.isConnected) {
          setOverlayBox(null);
          return;
        }
        setOverlayBox({
          dimensions: getElementBoxDimensions(element),
          rect: element.getBoundingClientRect(),
        });
      });
    };
    const resizeObserver = new ResizeObserver(updateOverlayBox);

    resizeObserver.observe(element);
    window.addEventListener("resize", updateOverlayBox);
    window.addEventListener("scroll", updateOverlayBox, true);
    updateOverlayBox();

    return () => {
      window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateOverlayBox);
      window.removeEventListener("scroll", updateOverlayBox, true);
    };
  }, [element]);

  useLayoutEffect(() => {
    if (!overlayBox || !tipElement.current) return;
    const tipRect = tipElement.current.getBoundingClientRect();
    setTipPosition(
      getOverlayTipPosition(overlayBox, tipRect.width, tipRect.height)
    );
  }, [fiberName, overlayBox]);

  if (!element || !overlayBox) return null;

  const { dimensions, rect } = overlayBox;
  const elementName = element.tagName.toLowerCase();
  const label = fiberName ? `${elementName} (in ${fiberName})` : elementName;
  const outerWidth =
    rect.width + dimensions.marginLeft + dimensions.marginRight;
  const outerHeight =
    rect.height + dimensions.marginTop + dimensions.marginBottom;

  return createPortal(
    <div aria-hidden="true" data-fiber-element-picker-overlay>
      <div
        className="pointer-events-none fixed z-[10000000] box-content border-solid border-[rgba(255,155,0,0.3)]"
        style={{
          left: rect.left - dimensions.marginLeft,
          top: rect.top - dimensions.marginTop,
          ...getBorderWidths(
            dimensions.marginTop,
            dimensions.marginRight,
            dimensions.marginBottom,
            dimensions.marginLeft
          ),
        }}
      >
        <div
          className="box-content border-solid border-[rgba(255,200,50,0.3)]"
          style={getBorderWidths(
            dimensions.borderTop,
            dimensions.borderRight,
            dimensions.borderBottom,
            dimensions.borderLeft
          )}
        >
          <div
            className="box-content border-solid border-[rgba(77,200,0,0.3)]"
            style={getBorderWidths(
              dimensions.paddingTop,
              dimensions.paddingRight,
              dimensions.paddingBottom,
              dimensions.paddingLeft
            )}
          >
            <div
              className="bg-[rgba(120,170,210,0.7)]"
              style={{
                height: Math.max(
                  0,
                  rect.height -
                    dimensions.borderTop -
                    dimensions.borderBottom -
                    dimensions.paddingTop -
                    dimensions.paddingBottom
                ),
                width: Math.max(
                  0,
                  rect.width -
                    dimensions.borderLeft -
                    dimensions.borderRight -
                    dimensions.paddingLeft -
                    dimensions.paddingRight
                ),
              }}
            />
          </div>
        </div>
      </div>
      <div
        ref={tipElement}
        className="pointer-events-none fixed z-[10000000] flex flex-row flex-nowrap rounded-[2px] bg-[#333740] px-[5px] py-[3px] font-[SFMono-Regular,Consolas,'Liberation_Mono',Menlo,Courier,monospace] text-xs font-bold whitespace-nowrap"
        style={tipPosition}
      >
        <span className="mr-2 border-r border-[#aaa] pr-2 text-[#ee78e6]">
          {label}
        </span>
        <span className="text-[#d7d7d7]">{`${Math.round(
          outerWidth
        )}px × ${Math.round(outerHeight)}px`}</span>
      </div>
    </div>,
    document.body
  );
};

export const FiberTree = () => {
  const [collapsedFiberIds, setCollapsedFiberIds] = useState(
    () => new Set<string>()
  );
  const [doesPreferReducedMotion, setDoesPreferReducedMotion] = useState(false);
  const [indentationSize, setIndentationSize] = useState(
    maximumIndentationSize
  );
  const [inspectedPageFiber, setInspectedPageFiber] = useState<Fiber | null>(
    null
  );
  const [isInspectingPage, setIsInspectingPage] = useState(false);
  const [listWidth, setListWidth] = useState(0);
  const [observedFiber, setObservedFiber] = useState<Fiber | null>(null);
  const [pickerElement, setPickerElement] = useState<Element | null>(null);
  const [pickerFiberName, setPickerFiberName] = useState<string | null>(null);
  const [renderCount, setRenderCount] = useState(0);
  const [searchResultIndex, setSearchResultIndex] = useState(0);
  const [searchText, setSearchText] = useState("");
  const [selectedFiberId, setSelectedFiberId] = useState<string | null>(null);
  const [selectionRequestCount, setSelectionRequestCount] = useState(0);
  const figureElement = useRef<HTMLElement>(null);
  const indentationSizeValue = useRef(maximumIndentationSize);
  const listElement = useRef<HTMLDivElement>(null);
  const previousListWidth = useRef(0);
  const committedFiber = observedFiber ? getLatestFiber(observedFiber) : null;
  const fiberTreeNodes = useMemo(
    () => (committedFiber ? getFiberTreeNodes(committedFiber) : []),
    [committedFiber, renderCount]
  );
  const visibleFiberNodes = useMemo(
    () => getVisibleFiberNodes(fiberTreeNodes, collapsedFiberIds),
    [collapsedFiberIds, fiberTreeNodes]
  );
  const isSelectedFiberVisible = visibleFiberNodes.some(
    (fiberNode) => fiberNode.fiberId === selectedFiberId
  );
  const effectiveSelectedFiberId = inspectedPageFiber
    ? null
    : isSelectedFiberVisible
    ? selectedFiberId
    : visibleFiberNodes[0]?.fiberId ?? null;
  const selectedFiberNode = visibleFiberNodes.find(
    (fiberNode) => fiberNode.fiberId === effectiveSelectedFiberId
  );
  const inspectedPageFiberNode = inspectedPageFiber
    ? getStandaloneFiberTreeNode(inspectedPageFiber)
    : undefined;
  const inspectedFiberNode = inspectedPageFiberNode ?? selectedFiberNode;
  const searchResultFiberIds = visibleFiberNodes
    .filter((fiberNode) => getSearchMatch(fiberNode.name, searchText) !== null)
    .map((fiberNode) => fiberNode.fiberId);
  const currentSearchResultFiberId = searchResultFiberIds[searchResultIndex];
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
      nextIndentationSize = Math.min(
        nextIndentationSize,
        remainingWidth / depth
      );
    }

    nextIndentationSize = Math.max(nextIndentationSize, minimumIndentationSize);
    indentationSizeValue.current = nextIndentationSize;
    setIndentationSize(nextIndentationSize);
  }, [listWidth, visibleFiberNodes]);

  useEffect(() => {
    const figureFiber = getFiber(figureElement.current);
    if (!figureFiber) return;

    const latestFigureFiber = getLatestFiber(figureFiber);
    let rootFiber = latestFigureFiber;
    while (rootFiber.return) rootFiber = rootFiber.return;
    setObservedFiber(rootFiber);
  }, []);

  useEffect(() => {
    if (!isInspectingPage) {
      setPickerElement(null);
      setPickerFiberName(null);
      return;
    }

    const getIsPickerToggle = (element: Element): boolean =>
      element.closest("[data-fiber-inspector-toggle]") !== null;

    const updatePickerTarget = (event: PointerEvent) => {
      const element = getEventElement(event);
      if (!element || getIsPickerToggle(element)) {
        setPickerElement(null);
        setPickerFiberName(null);
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      const hostFiber = getFiber(element);
      const inspectableFiber = hostFiber
        ? getInspectableFiber(hostFiber)
        : null;
      setPickerElement(element);
      setPickerFiberName(
        inspectableFiber ? getFiberName(inspectableFiber) : null
      );
    };

    const selectPickerTarget = (event: PointerEvent) => {
      const element = getEventElement(event);
      if (!element || getIsPickerToggle(element)) return;

      event.preventDefault();
      event.stopPropagation();
      const hostFiber = getFiber(element);
      if (!hostFiber) return;

      const inspectableFiber = getInspectableFiber(hostFiber);
      const inspectableFiberId = String(getFiberId(inspectableFiber));
      const matchingFiberNode = fiberTreeNodes.find(
        (fiberNode) =>
          fiberNode.fiberId === inspectableFiberId ||
          fiberNode.fiber === inspectableFiber ||
          fiberNode.fiber.alternate === inspectableFiber
      );

      if (!matchingFiberNode) {
        setInspectedPageFiber(inspectableFiber);
        setSelectionRequestCount((currentCount) => currentCount + 1);
        return;
      }

      setCollapsedFiberIds((currentFiberIds) => {
        const nextFiberIds = new Set(currentFiberIds);
        let parentFiberId = matchingFiberNode.parentFiberId;
        while (parentFiberId) {
          nextFiberIds.delete(parentFiberId);
          parentFiberId =
            getFiberNode(fiberTreeNodes, parentFiberId)?.parentFiberId ?? null;
        }
        return nextFiberIds;
      });
      setInspectedPageFiber(null);
      setSelectedFiberId(matchingFiberNode.fiberId);
      setSelectionRequestCount((currentCount) => currentCount + 1);
    };

    const stopPointerEvent = (event: PointerEvent) => {
      const element = getEventElement(event);
      if (element && getIsPickerToggle(element)) return;
      event.preventDefault();
      event.stopPropagation();
    };

    const stopInspecting = (event: MouseEvent) => {
      const element = getEventElement(event);
      if (element && getIsPickerToggle(element)) return;
      event.preventDefault();
      event.stopPropagation();
      setIsInspectingPage(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsInspectingPage(false);
    };

    window.addEventListener("click", stopInspecting, true);
    window.addEventListener("pointerdown", selectPickerTarget, true);
    window.addEventListener("pointermove", updatePickerTarget, true);
    window.addEventListener("pointerup", stopPointerEvent, true);
    window.addEventListener("keydown", handleKeyDown, true);

    return () => {
      window.removeEventListener("click", stopInspecting, true);
      window.removeEventListener("pointerdown", selectPickerTarget, true);
      window.removeEventListener("pointermove", updatePickerTarget, true);
      window.removeEventListener("pointerup", stopPointerEvent, true);
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [fiberTreeNodes, isInspectingPage]);

  useEffect(() => {
    const motionPreference = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    );
    const updateMotionPreference = () =>
      setDoesPreferReducedMotion(motionPreference.matches);

    updateMotionPreference();
    motionPreference.addEventListener("change", updateMotionPreference);
    return () =>
      motionPreference.removeEventListener("change", updateMotionPreference);
  }, []);

  useEffect(() => {
    if (doesPreferReducedMotion) return;

    const renderInterval = window.setInterval(() => {
      setRenderCount((currentRenderCount) => currentRenderCount + 1);
    }, 1200);

    return () => window.clearInterval(renderInterval);
  }, [doesPreferReducedMotion]);

  useEffect(() => {
    const selectedElement = listElement.current?.querySelector(
      '[aria-selected="true"]'
    );
    selectedElement?.scrollIntoView({ block: "nearest" });
  }, [effectiveSelectedFiberId, selectionRequestCount]);

  const selectFiber = (fiberId: string) => {
    setInspectedPageFiber(null);
    setSelectedFiberId(fiberId);
    setSelectionRequestCount((currentCount) => currentCount + 1);
  };

  const toggleFiber = (fiberId: string) => {
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

  const setCurrentSearchResult = (nextResultIndex: number) => {
    if (searchResultFiberIds.length === 0) return;
    const normalizedResultIndex =
      (nextResultIndex + searchResultFiberIds.length) %
      searchResultFiberIds.length;
    setSearchResultIndex(normalizedResultIndex);
    selectFiber(searchResultFiberIds[normalizedResultIndex]);
  };

  const updateSearchText = (nextSearchText: string) => {
    setSearchText(nextSearchText);
    setSearchResultIndex(0);

    const firstResult = visibleFiberNodes.find(
      (fiberNode) => getSearchMatch(fiberNode.name, nextSearchText) !== null
    );
    if (firstResult) selectFiber(firstResult.fiberId);
  };

  return (
    <figure
      ref={figureElement}
      className={fiberTreeClassNames.frame}
      aria-label="The visualization inspecting its own Fiber tree"
      data-render-count={renderCount}
    >
      <FiberTreeLayout>
        <FiberTreePane>
          <FiberSearch>
            <ElementPickerToggle
              isInspecting={isInspectingPage}
              onChange={() =>
                setIsInspectingPage((currentValue) => !currentValue)
              }
            />
            <div className={fiberTreeClassNames.leftVRule} />
            <SearchIcon />
            <input
              className={fiberTreeClassNames.input}
              aria-label="Search components"
              placeholder="Search (text or /regex/)"
              value={searchText}
              onChange={(event) => updateSearchText(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  setCurrentSearchResult(
                    searchResultIndex + (event.shiftKey ? -1 : 1)
                  );
                } else if (event.key === "Escape") {
                  updateSearchText("");
                }
              }}
            />
            {searchText ? (
              <>
                <span className={fiberTreeClassNames.indexLabel}>
                  <input
                    className={fiberTreeClassNames.indexInput}
                    aria-label="Current search result"
                    inputMode="numeric"
                    size={1}
                    value={
                      searchResultFiberIds.length > 0
                        ? searchResultIndex + 1
                        : 0
                    }
                    onChange={(event) => {
                      const nextResultIndex =
                        Number(event.currentTarget.value) - 1;
                      if (Number.isInteger(nextResultIndex)) {
                        setCurrentSearchResult(nextResultIndex);
                      }
                    }}
                  />
                  {` | ${searchResultFiberIds.length}`}
                </span>
                <div className={fiberTreeClassNames.leftVRule} />
                <SearchButton
                  icon="up"
                  label="Previous search result"
                  onClick={() => setCurrentSearchResult(searchResultIndex - 1)}
                />
                <SearchButton
                  icon="down"
                  label="Next search result"
                  onClick={() => setCurrentSearchResult(searchResultIndex + 1)}
                />
                <SearchButton
                  icon="close"
                  label="Clear search"
                  onClick={() => updateSearchText("")}
                />
              </>
            ) : null}
          </FiberSearch>
          <FiberList listElement={listElement}>
            {visibleFiberNodes.length > 0 ? (
              visibleFiberNodes.map((fiberNode) => (
                <FiberTreeRow
                  key={fiberNode.fiberId}
                  {...fiberNode}
                  currentSearchText={searchText}
                  indentationSize={indentationSize}
                  isCollapsed={collapsedFiberIds.has(fiberNode.fiberId)}
                  isCurrentSearchResult={
                    fiberNode.fiberId === currentSearchResultFiberId
                  }
                  isSearchResult={searchResultFiberIds.includes(
                    fiberNode.fiberId
                  )}
                  isSelected={fiberNode.fiberId === effectiveSelectedFiberId}
                  onSelect={() => selectFiber(fiberNode.fiberId)}
                  onToggle={() => toggleFiber(fiberNode.fiberId)}
                />
              ))
            ) : (
              <FiberTreeSkeleton />
            )}
          </FiberList>
        </FiberTreePane>
        <FiberResizeHandle />
        <FiberInspector fiberTreeNode={inspectedFiberNode} />
      </FiberTreeLayout>
      <ElementPickerOverlay
        element={pickerElement}
        fiberName={pickerFiberName}
      />
    </figure>
  );
};

setDisplayName(ExpandCollapseToggle, "ExpandCollapseToggle");
setDisplayName(ElementPickerOverlay, "ElementPickerOverlay");
setDisplayName(ElementPickerToggle, "ElementPickerToggle");
setDisplayName(FiberDisplayName, "FiberDisplayName");
setDisplayName(FiberInspector, "FiberInspector");
setDisplayName(FiberInspectorSkeleton, "FiberInspectorSkeleton");
setDisplayName(FiberList, "FiberList");
setDisplayName(FiberResizeHandle, "FiberResizeHandle");
setDisplayName(FiberSearch, "FiberSearch");
setDisplayName(InspectorSection, "InspectorSection");
setDisplayName(InspectorValue, "InspectorValue");
setDisplayName(FiberTree, "FiberTree");
setDisplayName(FiberTreeLayout, "FiberTreeLayout");
setDisplayName(FiberTreePane, "FiberTreePane");
setDisplayName(FiberTreeRow, "FiberTreeRow");
setDisplayName(FiberTreeSkeleton, "FiberTreeSkeleton");
setDisplayName(SearchButton, "SearchButton");
setDisplayName(SearchIcon, "SearchIcon");
