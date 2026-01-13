'use client';

import { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Inspector as ReactInspector } from 'react-inspector';
import {
  type Fiber,
  getFiberFromHostInstance,
  getLatestFiber,
  traverseFiber,
  isCompositeFiber,
  getDisplayName,
  getNearestHostFiber,
} from 'bippy';

const throttle = <Args extends unknown[]>(
  callback: (...args: Args) => void,
  wait: number,
) => {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  return (...args: Args) => {
    if (!timeout) {
      timeout = setTimeout(() => {
        callback(...args);
        timeout = null;
      }, wait);
    }
  };
};

const inspectorTheme = {
  ARROW_ANIMATION_DURATION: '0',
  ARROW_COLOR: '#666',
  ARROW_FONT_SIZE: 12,
  ARROW_MARGIN_RIGHT: 3,
  BASE_BACKGROUND_COLOR: 'none',
  BASE_COLOR: '#FFF',
  BASE_FONT_FAMILY: 'Menlo, monospace',
  BASE_FONT_SIZE: '12px',
  BASE_LINE_HEIGHT: 1.2,
  HTML_ATTRIBUTE_NAME_COLOR: '#888',
  HTML_ATTRIBUTE_VALUE_COLOR: '#f5be93',
  HTML_COMMENT_COLOR: '#666',
  HTML_DOCTYPE_COLOR: '#888',
  HTML_TAG_COLOR: '#f5be93',
  HTML_TAGNAME_COLOR: '#f5be93',
  HTML_TAGNAME_TEXT_TRANSFORM: 'lowercase',
  OBJECT_NAME_COLOR: '#f5be93',
  OBJECT_PREVIEW_ARRAY_MAX_PROPERTIES: 10,
  OBJECT_PREVIEW_OBJECT_MAX_PROPERTIES: 5,
  OBJECT_VALUE_BOOLEAN_COLOR: '#f5be93',
  OBJECT_VALUE_FUNCTION_PREFIX_COLOR: '#f5be93',
  OBJECT_VALUE_NULL_COLOR: '#888',
  OBJECT_VALUE_NUMBER_COLOR: '#f5be93',
  OBJECT_VALUE_REGEXP_COLOR: '#f5be93',
  OBJECT_VALUE_STRING_COLOR: '#fff',
  OBJECT_VALUE_SYMBOL_COLOR: '#f5be93',
  OBJECT_VALUE_UNDEFINED_COLOR: '#888',
  TABLE_BORDER_COLOR: '#292929',
  TABLE_DATA_BACKGROUND_IMAGE: 'none',
  TABLE_DATA_BACKGROUND_SIZE: '0',
  TABLE_SORT_ICON_COLOR: '#888',
  TABLE_TH_BACKGROUND_COLOR: '#111',
  TABLE_TH_HOVER_COLOR: '#1a1a1a',
  TREENODE_FONT_FAMILY: 'Menlo, monospace',
  TREENODE_FONT_SIZE: '11px',
  TREENODE_LINE_HEIGHT: 1.2,
  TREENODE_PADDING_LEFT: 12,
};

interface InspectorOverlayProps {
  isActive: boolean;
}

const InspectorOverlay = ({ isActive }: InspectorOverlayProps) => {
  const [element, setElement] = useState<Element | null>(null);
  const [currentFiber, setCurrentFiber] = useState<Fiber | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });

  const currentCleanedFiber = useMemo(() => {
    if (!currentFiber) return null;
    const clonedFiber = { ...currentFiber };
    for (const key in clonedFiber) {
      const fiberKey = key as keyof Fiber;
      const value = clonedFiber[fiberKey];
      if (!value) delete clonedFiber[fiberKey];
    }
    return clonedFiber;
  }, [currentFiber]);

  useEffect(() => {
    if (!element) return;
    const fiber = getFiberFromHostInstance(element);
    if (!fiber) return;
    const latestFiber = getLatestFiber(fiber);
    const compositeFiber = traverseFiber(latestFiber, (innerFiber) => {
      if (isCompositeFiber(innerFiber)) {
        return true;
      }
    });
    if (!compositeFiber) return;
    const name = getDisplayName(compositeFiber.type);
    setCurrentFiber(compositeFiber);
    setDisplayName(name);
  }, [element]);

  useEffect(() => {
    if (!isActive) {
      setElement(null);
      setRect(null);
      return;
    }

    const handleMouseMove = (event: globalThis.MouseEvent) => {
      const hoveredElement = document.elementFromPoint(
        event.clientX,
        event.clientY,
      );
      if (!hoveredElement) return;
      setElement(hoveredElement);
      setRect(hoveredElement.getBoundingClientRect());
    };

    const throttledMouseMove = throttle(handleMouseMove, 16);
    document.addEventListener('mousemove', throttledMouseMove);
    return () => document.removeEventListener('mousemove', throttledMouseMove);
  }, [isActive]);

  useEffect(() => {
    if (!rect) return;

    const padding = 10;
    const inspectorWidth = 340;
    const inspectorHeight = 280;

    let left = rect.left + rect.width + padding;
    let top = rect.top;

    if (left + inspectorWidth > window.innerWidth) {
      left = Math.max(padding, rect.left - inspectorWidth - padding);
    }

    if (top >= rect.top && top <= rect.bottom) {
      if (rect.bottom + inspectorHeight + padding <= window.innerHeight) {
        top = rect.bottom + padding;
      } else if (rect.top - inspectorHeight - padding >= 0) {
        top = rect.top - inspectorHeight - padding;
      } else {
        top = window.innerHeight - inspectorHeight - padding;
      }
    }

    top = Math.max(
      padding,
      Math.min(top, window.innerHeight - inspectorHeight - padding),
    );
    left = Math.max(
      padding,
      Math.min(left, window.innerWidth - inspectorWidth - padding),
    );

    setPosition({ left, top });
  }, [rect]);

  if (!rect || !isActive || !currentFiber) return null;

  return (
    <>
      <div
        style={{
          backgroundColor: '#111',
          border: '1px solid #292929',
          color: '#FFF',
          height: '22ch',
          left: position.left,
          overflow: 'auto',
          padding: '1rem',
          pointerEvents: 'auto',
          position: 'fixed',
          top: position.top,
          width: '28ch',
          zIndex: 999999,
          fontFamily: 'Menlo, monospace',
        }}
      >
        <ReactInspector
          data={currentCleanedFiber}
          expandLevel={1}
          table={false}
          theme={inspectorTheme as never}
        />

        <div
          style={{
            alignItems: 'center',
            backgroundColor: '#111',
            borderTop: '1px solid #292929',
            bottom: '0',
            display: 'flex',
            gap: '0.75rem',
            left: '0',
            padding: '0.75rem 1rem',
            position: 'absolute',
            right: '0',
            zIndex: 1000,
          }}
        >
          <div
            style={{
              backgroundColor: '#f5be93',
              color: '#111',
              fontSize: '0.75rem',
              padding: '0.25rem 0.5rem',
              fontFamily: 'Menlo, monospace',
            }}
          >
            {`<${displayName || 'unknown'}>`}
          </div>
        </div>
      </div>
      <div
        style={{
          backgroundColor: 'rgba(245, 190, 147, 0.1)',
          border: '1px dashed #111',
          height: rect.height,
          left: rect.left,
          pointerEvents: 'none',
          position: 'fixed',
          top: rect.top,
          width: rect.width,
          zIndex: 999998,
        }}
      />
    </>
  );
};

export const InspectorDemo = () => {
  const [isActive, setIsActive] = useState(false);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={() => setIsActive(!isActive)}
        className="w-full bg-white text-[#111] px-2 py-3 text-sm font-mono cursor-pointer"
      >
        {isActive ? (
          <>
            inspector{' '}
            <span className="inline-block px-1 bg-[#f5be93]">on</span>
            {' '}— hover around!
          </>
        ) : (
          <>
            try the{' '}
            <span className="inline-block px-1 bg-[#f5be93]/20">inspector</span>
          </>
        )}
      </button>
      {isMounted &&
        createPortal(<InspectorOverlay isActive={isActive} />, document.body)}
    </>
  );
};
