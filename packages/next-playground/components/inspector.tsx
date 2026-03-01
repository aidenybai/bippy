'use client';

import 'bippy';
import { getFiberFromHostInstance, getLatestFiber } from 'bippy';
import { getSource } from 'bippy/dist/source';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { cn } from './cn';
import {
  InspectorContextMenu,
  type InspectorContextMenuEntry,
  type InspectorContextMenuPosition,
} from './inspector-context-menu';

interface BuildContextMenuEntriesResult {
  activeEntryId: string | null;
  entries: InspectorContextMenuEntry[];
  entryElementMap: Map<string, Element>;
}

interface InspectorElementSummary {
  elementTag: string;
  previewText: string;
}

const INSPECTOR_UI_SELECTOR = '[data-inspector-ui="true"]';

const isInspectableElement = (candidateElement: Element | null): candidateElement is Element => {
  if (!candidateElement) {
    return false;
  }
  return !candidateElement.closest(INSPECTOR_UI_SELECTOR);
};

const getElementPreviewText = (element: Element): string => {
  const elementTextContent = element.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  if (elementTextContent.length > 0) {
    return elementTextContent.length > 60
      ? `${elementTextContent.slice(0, 60)}…`
      : elementTextContent;
  }
  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel && ariaLabel.length > 0) {
    return ariaLabel;
  }
  return 'No preview text';
};

const getElementTag = (element: Element): string => {
  const tagName = element.tagName.toLowerCase();
  const idSegment = element.id.length > 0 ? `#${element.id}` : '';
  const classSegments = Array.from(element.classList).slice(0, 2);
  const classSegment = classSegments.length > 0 ? `.${classSegments.join('.')}` : '';
  return `${tagName}${idSegment}${classSegment}`;
};

const getElementSummary = (element: Element): InspectorElementSummary => {
  return {
    elementTag: getElementTag(element),
    previewText: getElementPreviewText(element),
  };
};

const getLabelPosition = (elementRect: DOMRect): InspectorContextMenuPosition => {
  const minimumPadding = 8;
  const estimatedLabelWidth = 320;
  const clampedLeft = Math.min(
    Math.max(elementRect.left, minimumPadding),
    window.innerWidth - estimatedLabelWidth - minimumPadding,
  );
  const top = Math.max(minimumPadding, elementRect.top - 34);
  return {
    left: clampedLeft,
    top,
  };
};

const clampMenuPosition = (
  requestedPosition: InspectorContextMenuPosition,
): InspectorContextMenuPosition => {
  const minimumPadding = 8;
  const estimatedMenuWidth = 360;
  const estimatedMenuHeight = 280;
  return {
    left: Math.min(
      Math.max(requestedPosition.left, minimumPadding),
      window.innerWidth - estimatedMenuWidth - minimumPadding,
    ),
    top: Math.min(
      Math.max(requestedPosition.top, minimumPadding),
      window.innerHeight - estimatedMenuHeight - minimumPadding,
    ),
  };
};

const buildContextMenuEntries = (
  selectedElement: Element,
  downwardSelectionStack: Element[],
): BuildContextMenuEntriesResult => {
  const candidateElements: Element[] = [selectedElement];
  const parentElement = selectedElement.parentElement;
  if (isInspectableElement(parentElement)) {
    candidateElements.push(parentElement);
  }
  const nextDownwardElement = downwardSelectionStack[0];
  if (nextDownwardElement && isInspectableElement(nextDownwardElement)) {
    candidateElements.push(nextDownwardElement);
  }
  const childElements = Array.from(selectedElement.children)
    .filter((innerChildElement) => isInspectableElement(innerChildElement))
    .slice(0, 8);
  candidateElements.push(...childElements);

  const deduplicatedElements: Element[] = [];
  const seenElements = new Set<Element>();
  for (const candidateElement of candidateElements) {
    if (seenElements.has(candidateElement)) {
      continue;
    }
    seenElements.add(candidateElement);
    deduplicatedElements.push(candidateElement);
  }

  const entryElementMap = new Map<string, Element>();
  const entries = deduplicatedElements.map((innerElement, innerIndex) => {
    const entryId = `entry-${innerIndex}`;
    entryElementMap.set(entryId, innerElement);
    const elementSummary = getElementSummary(innerElement);
    return {
      entryId,
      elementTag: elementSummary.elementTag,
      previewText: elementSummary.previewText,
    };
  });
  return {
    activeEntryId: entries[0]?.entryId ?? null,
    entries,
    entryElementMap,
  };
};

const getEntryIdForElement = (
  entryElementMap: Map<string, Element>,
  targetElement: Element | null,
): string | null => {
  if (!targetElement) {
    return null;
  }
  for (const [entryId, entryElement] of entryElementMap.entries()) {
    if (entryElement === targetElement) {
      return entryId;
    }
  }
  return null;
};

export const Inspector = (): React.JSX.Element => {
  const [activeEntryId, setActiveEntryId] = useState<string | null>(null);
  const [contextMenuEntries, setContextMenuEntries] = useState<InspectorContextMenuEntry[]>([]);
  const [contextMenuPosition, setContextMenuPosition] = useState<InspectorContextMenuPosition>({
    left: 0,
    top: 0,
  });
  const [highlightRect, setHighlightRect] = useState<DOMRect | null>(null);
  const [isContextMenuVisible, setIsContextMenuVisible] = useState(false);
  const [isEnabled, setIsEnabled] = useState(false);
  const [selectedElement, setSelectedElement] = useState<Element | null>(null);
  const activeEntryIdRef = useRef(activeEntryId);
  const contextMenuEntriesRef = useRef(contextMenuEntries);
  const downwardSelectionStackRef = useRef<Element[]>([]);
  const entryElementMapRef = useRef<Map<string, Element>>(new Map());
  const isContextMenuVisibleRef = useRef(isContextMenuVisible);
  const isEnabledRef = useRef(isEnabled);
  const selectedElementRef = useRef<Element | null>(selectedElement);

  activeEntryIdRef.current = activeEntryId;
  contextMenuEntriesRef.current = contextMenuEntries;
  isContextMenuVisibleRef.current = isContextMenuVisible;
  isEnabledRef.current = isEnabled;
  selectedElementRef.current = selectedElement;

  const closeContextMenu = useCallback((): void => {
    setIsContextMenuVisible(false);
    setContextMenuEntries([]);
    setActiveEntryId(null);
  }, []);

  const selectElement = useCallback((nextSelectedElement: Element, shouldResetDownwardSelection: boolean): void => {
    if (shouldResetDownwardSelection) {
      downwardSelectionStackRef.current = [];
    }
    selectedElementRef.current = nextSelectedElement;
    setSelectedElement(nextSelectedElement);
    setHighlightRect(nextSelectedElement.getBoundingClientRect());
  }, []);

  const openContextMenuForElement = useCallback((
    targetElement: Element,
    requestedPosition: InspectorContextMenuPosition,
  ): void => {
    const builtEntries = buildContextMenuEntries(
      targetElement,
      downwardSelectionStackRef.current,
    );
    entryElementMapRef.current = builtEntries.entryElementMap;
    setContextMenuEntries(builtEntries.entries);
    setActiveEntryId(builtEntries.activeEntryId);
    setContextMenuPosition(clampMenuPosition(requestedPosition));
    setIsContextMenuVisible(true);
  }, []);

  useEffect(() => {
    if (!isEnabled) {
      closeContextMenu();
      setHighlightRect(null);
      setSelectedElement(null);
      selectedElementRef.current = null;
      downwardSelectionStackRef.current = [];
      entryElementMapRef.current = new Map();
    }
  }, [closeContextMenu, isEnabled]);

  useEffect(() => {
    if (!isContextMenuVisible) {
      return;
    }
    const currentSelectedElement = selectedElementRef.current;
    if (!currentSelectedElement) {
      return;
    }
    const rebuiltEntries = buildContextMenuEntries(
      currentSelectedElement,
      downwardSelectionStackRef.current,
    );
    entryElementMapRef.current = rebuiltEntries.entryElementMap;
    setContextMenuEntries(rebuiltEntries.entries);
    setActiveEntryId(
      getEntryIdForElement(rebuiltEntries.entryElementMap, currentSelectedElement)
      ?? rebuiltEntries.activeEntryId,
    );
  }, [isContextMenuVisible, selectedElement]);

  useEffect(() => {
    const getInspectableElementFromPoint = (clientX: number, clientY: number): Element | null => {
      const pointedElement = document.elementFromPoint(clientX, clientY);
      if (!isInspectableElement(pointedElement)) {
        return null;
      }
      return pointedElement;
    };

    const handleMouseMove = (event: MouseEvent) => {
      if (!isEnabledRef.current || isContextMenuVisibleRef.current) {
        return;
      }
      const pointedElement = getInspectableElementFromPoint(event.clientX, event.clientY);
      if (!pointedElement) {
        return;
      }
      selectElement(pointedElement, true);
    };

    const handleClick = (event: MouseEvent) => {
      if (!isEnabledRef.current || event.button !== 0) {
        return;
      }
      const pointedElement = getInspectableElementFromPoint(event.clientX, event.clientY);
      if (!pointedElement) {
        return;
      }
      selectElement(pointedElement, true);
      const fiber = getFiberFromHostInstance(pointedElement);
      if (fiber) {
        const latestFiber = getLatestFiber(fiber);
        console.log('Fiber:', latestFiber);

        void (async () => {
          try {
            console.log(await getSource(latestFiber));
          } catch (error) {
            console.error('Error symbolicating stack:', error);
          }
        })();
      }
    };

    const handleContextMenu = (event: MouseEvent) => {
      if (!isEnabledRef.current) {
        return;
      }
      const pointedElement = getInspectableElementFromPoint(event.clientX, event.clientY);
      if (!pointedElement) {
        return;
      }
      event.preventDefault();
      selectElement(pointedElement, true);
      openContextMenuForElement(pointedElement, {
        left: event.clientX,
        top: event.clientY,
      });
    };

    const handleOutsideMouseDown = (event: MouseEvent) => {
      if (!isContextMenuVisibleRef.current) {
        return;
      }
      const targetElement = event.target;
      if (!(targetElement instanceof Element)) {
        return;
      }
      if (targetElement.closest(INSPECTOR_UI_SELECTOR)) {
        return;
      }
      closeContextMenu();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isEnabledRef.current) {
        return;
      }
      const currentSelectedElement = selectedElementRef.current;
      if (!currentSelectedElement) {
        return;
      }
      if (event.key === 'Escape') {
        if (isContextMenuVisibleRef.current) {
          event.preventDefault();
          closeContextMenu();
        }
        return;
      }
      if (event.key === 'Enter') {
        if (!isContextMenuVisibleRef.current) {
          return;
        }
        event.preventDefault();
        const currentActiveEntryId = activeEntryIdRef.current;
        if (!currentActiveEntryId) {
          return;
        }
        const selectedMenuElement = entryElementMapRef.current.get(currentActiveEntryId);
        if (!selectedMenuElement) {
          return;
        }
        selectElement(selectedMenuElement, true);
        closeContextMenu();
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        if (isContextMenuVisibleRef.current && contextMenuEntriesRef.current.length > 0) {
          const currentEntryIndex = contextMenuEntriesRef.current.findIndex(
            (innerEntry) => innerEntry.entryId === activeEntryIdRef.current,
          );
          const nextEntryIndex = currentEntryIndex <= 0
            ? contextMenuEntriesRef.current.length - 1
            : currentEntryIndex - 1;
          const nextEntry = contextMenuEntriesRef.current[nextEntryIndex];
          if (nextEntry) {
            setActiveEntryId(nextEntry.entryId);
          }
          return;
        }
        const parentElement = currentSelectedElement.parentElement;
        if (!isInspectableElement(parentElement)) {
          return;
        }
        downwardSelectionStackRef.current = [
          currentSelectedElement,
          ...downwardSelectionStackRef.current,
        ];
        selectElement(parentElement, false);
        openContextMenuForElement(
          parentElement,
          getLabelPosition(parentElement.getBoundingClientRect()),
        );
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        if (isContextMenuVisibleRef.current && contextMenuEntriesRef.current.length > 0) {
          const currentEntryIndex = contextMenuEntriesRef.current.findIndex(
            (innerEntry) => innerEntry.entryId === activeEntryIdRef.current,
          );
          const nextEntryIndex = currentEntryIndex >= contextMenuEntriesRef.current.length - 1
            ? 0
            : currentEntryIndex + 1;
          const nextEntry = contextMenuEntriesRef.current[nextEntryIndex];
          if (nextEntry) {
            setActiveEntryId(nextEntry.entryId);
          }
          return;
        }
        const nextDownwardElement = downwardSelectionStackRef.current[0];
        if (!nextDownwardElement || !isInspectableElement(nextDownwardElement)) {
          return;
        }
        downwardSelectionStackRef.current = downwardSelectionStackRef.current.slice(1);
        selectElement(nextDownwardElement, false);
        openContextMenuForElement(
          nextDownwardElement,
          getLabelPosition(nextDownwardElement.getBoundingClientRect()),
        );
      }
    };

    const handleViewportChange = () => {
      if (!isEnabledRef.current) {
        return;
      }
      const currentSelectedElement = selectedElementRef.current;
      if (!currentSelectedElement) {
        return;
      }
      setHighlightRect(currentSelectedElement.getBoundingClientRect());
      if (isContextMenuVisibleRef.current) {
        setContextMenuPosition(
          clampMenuPosition(getLabelPosition(currentSelectedElement.getBoundingClientRect())),
        );
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('click', handleClick);
    document.addEventListener('contextmenu', handleContextMenu);
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleOutsideMouseDown);
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('click', handleClick);
      document.removeEventListener('contextmenu', handleContextMenu);
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleOutsideMouseDown);
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
    };
  }, [closeContextMenu, openContextMenuForElement, selectElement]);

  const selectedElementSummary = useMemo(() => {
    if (!selectedElement) {
      return null;
    }
    return getElementSummary(selectedElement);
  }, [selectedElement]);

  const labelPosition = useMemo(() => {
    if (!highlightRect) {
      return null;
    }
    return getLabelPosition(highlightRect);
  }, [highlightRect]);

  const handleMenuEntryHover = (entryId: string): void => {
    setActiveEntryId(entryId);
  };

  const handleMenuEntrySelect = (entryId: string): void => {
    const selectedMenuElement = entryElementMapRef.current.get(entryId);
    if (!selectedMenuElement) {
      return;
    }
    selectElement(selectedMenuElement, true);
    closeContextMenu();
  };

  return (
    <div className="relative">
      <button
        className={cn(
          'transition-colors text-black px-2 py-1 rounded-md',
          isEnabled
            ? 'bg-red-600 text-white hover:bg-red-700'
            : 'bg-white hover:bg-neutral-200',
        )}
        onClick={() => setIsEnabled(!isEnabled)}
      >
        {isEnabled ? 'Disable' : 'Enable'}
      </button>
      {isEnabled && highlightRect && (
        <div
          className="fixed pointer-events-none border border-dashed border-red-600"
          data-inspector-ui="true"
          style={{
            height: highlightRect.height,
            left: highlightRect.left,
            top: highlightRect.top,
            width: highlightRect.width,
          }}
        ></div>
      )}
      {isEnabled && selectedElementSummary && labelPosition && !isContextMenuVisible && (
        <div
          className="fixed z-[999998] pointer-events-none flex max-w-[320px] items-center gap-2 rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-[11px] text-neutral-100 shadow-md"
          data-inspector-ui="true"
          style={{
            left: labelPosition.left,
            top: labelPosition.top,
          }}
        >
          <span className="rounded bg-neutral-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-orange-300">
            {selectedElementSummary.elementTag}
          </span>
          <span className="truncate text-neutral-300">
            {selectedElementSummary.previewText}
          </span>
        </div>
      )}
      {isEnabled && isContextMenuVisible && contextMenuEntries.length > 0 && (
        <InspectorContextMenu
          activeEntryId={activeEntryId}
          entries={contextMenuEntries}
          onHoverEntry={handleMenuEntryHover}
          onSelectEntry={handleMenuEntrySelect}
          position={contextMenuPosition}
        />
      )}
    </div>
  );
};
