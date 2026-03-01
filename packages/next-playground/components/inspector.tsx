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
): BuildContextMenuEntriesResult => {
  const candidateElements: Element[] = [selectedElement];
  const parentElement = selectedElement.parentElement;
  if (isInspectableElement(parentElement)) {
    candidateElements.push(parentElement);
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

  const getElementPathId = (element: Element): string => {
    const pathSegments: string[] = [];
    let currentElement: Element | null = element;
    while (currentElement && pathSegments.length < 8) {
      const currentParentElement: Element | null = currentElement.parentElement;
      const siblingIndex = currentParentElement
        ? Array.from(currentParentElement.children).indexOf(currentElement)
        : 0;
      pathSegments.unshift(`${currentElement.tagName.toLowerCase()}-${siblingIndex}`);
      currentElement = currentParentElement;
    }
    return pathSegments.join('/');
  };

  const entryElementMap = new Map<string, Element>();
  const entries = deduplicatedElements.map((innerElement) => {
    const entryId = getElementPathId(innerElement);
    entryElementMap.set(entryId, innerElement);
    const elementSummary = getElementSummary(innerElement);
    return {
      entryId,
      elementTag: elementSummary.elementTag,
      previewText: elementSummary.previewText,
    };
  });
  const activeEntryId = entryElementMap.size > 0
    ? Array.from(entryElementMap.entries()).find(([, innerElement]) => innerElement === selectedElement)?.[0] ?? null
    : null;
  return {
    activeEntryId,
    entries,
    entryElementMap,
  };
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
    entryElementMapRef.current = new Map();
  }, []);

  const selectElement = useCallback((nextSelectedElement: Element, shouldResetDownwardSelection: boolean): void => {
    if (shouldResetDownwardSelection) {
      setActiveEntryId(null);
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
    );
    entryElementMapRef.current = builtEntries.entryElementMap;
    if (builtEntries.entries.length > 0) {
      setContextMenuEntries(builtEntries.entries);
      setActiveEntryId(builtEntries.activeEntryId ?? builtEntries.entries[0].entryId);
    } else {
      const fallbackElementSummary = getElementSummary(targetElement);
      const fallbackEntryId = 'fallback-selected-element';
      entryElementMapRef.current = new Map([[fallbackEntryId, targetElement]]);
      setContextMenuEntries([
        {
          entryId: fallbackEntryId,
          elementTag: fallbackElementSummary.elementTag,
          previewText: fallbackElementSummary.previewText,
        },
      ]);
      setActiveEntryId(fallbackEntryId);
    }
    setContextMenuPosition(clampMenuPosition(requestedPosition));
    setIsContextMenuVisible(true);
  }, []);

  const openMenuForSelectedElement = useCallback((targetElement: Element): void => {
    openContextMenuForElement(targetElement, getLabelPosition(targetElement.getBoundingClientRect()));
  }, [openContextMenuForElement]);

  const moveActiveMenuEntry = useCallback((movementDirection: 'up' | 'down'): void => {
    const menuEntries = contextMenuEntriesRef.current;
    if (menuEntries.length === 0) {
      return;
    }
    const currentEntryIndex = menuEntries.findIndex(
      (innerEntry) => innerEntry.entryId === activeEntryIdRef.current,
    );
    const normalizedCurrentIndex = currentEntryIndex >= 0 ? currentEntryIndex : 0;
    const nextEntryIndex = movementDirection === 'up'
      ? (normalizedCurrentIndex <= 0 ? menuEntries.length - 1 : normalizedCurrentIndex - 1)
      : (normalizedCurrentIndex >= menuEntries.length - 1 ? 0 : normalizedCurrentIndex + 1);
    const nextEntry = menuEntries[nextEntryIndex];
    if (!nextEntry) {
      return;
    }
    setActiveEntryId(nextEntry.entryId);
  }, []);

  const navigateSelectionUp = useCallback((): void => {
    if (!isEnabledRef.current) {
      return;
    }
    const currentSelectedElement = selectedElementRef.current;
    if (!currentSelectedElement) {
      return;
    }
    if (isContextMenuVisibleRef.current) {
      moveActiveMenuEntry('up');
      return;
    }
    const parentElement = currentSelectedElement.parentElement;
    if (!isInspectableElement(parentElement)) {
      return;
    }
    selectElement(parentElement, false);
    openMenuForSelectedElement(parentElement);
  }, [moveActiveMenuEntry, openMenuForSelectedElement, selectElement]);

  const navigateSelectionDown = useCallback((): void => {
    if (!isEnabledRef.current) {
      return;
    }
    const currentSelectedElement = selectedElementRef.current;
    if (!currentSelectedElement) {
      return;
    }
    if (isContextMenuVisibleRef.current) {
      moveActiveMenuEntry('down');
      return;
    }
    const firstChildElement = Array.from(currentSelectedElement.children).find(
      (innerChildElement) => isInspectableElement(innerChildElement),
    );
    if (!firstChildElement) {
      return;
    }
    selectElement(firstChildElement, false);
    openMenuForSelectedElement(firstChildElement);
  }, [moveActiveMenuEntry, openMenuForSelectedElement, selectElement]);

  useEffect(() => {
    if (!isEnabled) {
      return;
    }
    const previousBodyTabIndex = document.body.getAttribute('tabindex');
    document.body.setAttribute('tabindex', '-1');
    document.body.focus();
    return () => {
      if (previousBodyTabIndex === null) {
        document.body.removeAttribute('tabindex');
        return;
      }
      document.body.setAttribute('tabindex', previousBodyTabIndex);
    };
  }, [isEnabled]);

  useEffect(() => {
    if (!isEnabled) {
      closeContextMenu();
      setHighlightRect(null);
      setSelectedElement(null);
      selectedElementRef.current = null;
      entryElementMapRef.current = new Map();
    }
  }, [closeContextMenu, isEnabled]);

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
      const isArrowUpKey = event.key === 'ArrowUp'
        || event.code === 'ArrowUp'
        || event.key === 'Up'
        || event.keyCode === 38;
      const isArrowDownKey = event.key === 'ArrowDown'
        || event.code === 'ArrowDown'
        || event.key === 'Down'
        || event.keyCode === 40;
      if (isArrowUpKey) {
        event.preventDefault();
        navigateSelectionUp();
        return;
      }
      if (isArrowDownKey) {
        event.preventDefault();
        navigateSelectionDown();
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
    document.addEventListener('mousedown', handleOutsideMouseDown);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('click', handleClick);
      document.removeEventListener('contextmenu', handleContextMenu);
      document.removeEventListener('mousedown', handleOutsideMouseDown);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
    };
  }, [closeContextMenu, navigateSelectionDown, navigateSelectionUp, openContextMenuForElement, selectElement]);

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

  const menuEntriesForRender = useMemo(() => {
    if (contextMenuEntries.length > 0) {
      return contextMenuEntries;
    }
    if (!selectedElementSummary) {
      return [];
    }
    return [
      {
        entryId: 'fallback-selected-element',
        elementTag: selectedElementSummary.elementTag,
        previewText: selectedElementSummary.previewText,
      },
    ];
  }, [contextMenuEntries, selectedElementSummary]);

  const isMenuRenderable = isContextMenuVisible && menuEntriesForRender.length > 0;

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
      {isEnabled && (
        <div
          className="mt-2 inline-flex items-center gap-2 rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-200"
          data-inspector-ui="true"
        >
          <button
            className="rounded border border-neutral-600 bg-neutral-800 px-2 py-0.5 font-mono text-neutral-100 hover:bg-neutral-700"
            onClick={navigateSelectionUp}
            type="button"
          >
            ↑
          </button>
          <button
            className="rounded border border-neutral-600 bg-neutral-800 px-2 py-0.5 font-mono text-neutral-100 hover:bg-neutral-700"
            onClick={navigateSelectionDown}
            type="button"
          >
            ↓
          </button>
        </div>
      )}
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
      {isEnabled && selectedElementSummary && labelPosition && !isMenuRenderable && (
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
      {isEnabled && isMenuRenderable && (
        <InspectorContextMenu
          activeEntryId={activeEntryId ?? menuEntriesForRender[0]?.entryId ?? null}
          entries={menuEntriesForRender}
          onHoverEntry={handleMenuEntryHover}
          onSelectEntry={handleMenuEntrySelect}
          position={contextMenuPosition}
        />
      )}
    </div>
  );
};
