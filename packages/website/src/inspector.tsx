import {
  detectReactBuildType,
  type Fiber,
  getDisplayName,
  getFiberFromHostInstance,
  getLatestFiber,
  getRDTHook,
  hasRDTHook,
  isInstrumentationActive,
} from 'bippy';
import React, {
  forwardRef,
  useEffect,
  useImperativeHandle as useImperativeHandleOriginal,
  useMemo,
  useState,
} from 'react';
import ReactDOM from 'react-dom';
import { Inspector as ReactInspector } from 'react-inspector';

const useImperativeHandlePolyfill = (
  ref: React.RefCallback<unknown> | React.RefObject<unknown>,
  init: () => unknown,
  deps: React.DependencyList,
) => {
  useEffect(() => {
    if (ref) {
      if (typeof ref === 'function') {
        ref(init());
      } else if (typeof ref === 'object' && 'current' in ref) {
        ref.current = init();
      }
    }
  }, deps);
};

const useImperativeHandle =
  useImperativeHandleOriginal || useImperativeHandlePolyfill;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const throttle = (fn: (...args: any[]) => void, wait: number) => {
  let timeout: null | ReturnType<typeof setTimeout> = null;
  return function (this: unknown, ...args: unknown[]) {
    if (!timeout) {
      timeout = setTimeout(() => {
        fn.apply(this, args as never[]);
        timeout = null;
      }, wait);
    }
  };
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const theme: any = {
  ARROW_ANIMATION_DURATION: '0',
  ARROW_COLOR: '#A0A0A0',
  ARROW_FONT_SIZE: 12,

  ARROW_MARGIN_RIGHT: 3,
  BASE_BACKGROUND_COLOR: 'none',

  BASE_COLOR: '#FFF',
  BASE_FONT_FAMILY: 'Menlo, monospace',
  BASE_FONT_SIZE: '12px',
  BASE_LINE_HEIGHT: 1.2,
  HTML_ATTRIBUTE_NAME_COLOR: '#A0A0A0',
  HTML_ATTRIBUTE_VALUE_COLOR: '#99FFE4',
  HTML_COMMENT_COLOR: '#8b8b8b94',
  HTML_DOCTYPE_COLOR: '#A0A0A0',
  HTML_TAG_COLOR: '#FFC799',
  HTML_TAGNAME_COLOR: '#FFC799',
  HTML_TAGNAME_TEXT_TRANSFORM: 'lowercase',

  OBJECT_NAME_COLOR: '#FFC799',
  OBJECT_PREVIEW_ARRAY_MAX_PROPERTIES: 10,
  OBJECT_PREVIEW_OBJECT_MAX_PROPERTIES: 5,
  OBJECT_VALUE_BOOLEAN_COLOR: '#FFC799',
  OBJECT_VALUE_FUNCTION_PREFIX_COLOR: '#FFC799',
  OBJECT_VALUE_NULL_COLOR: '#A0A0A0',
  OBJECT_VALUE_NUMBER_COLOR: '#FFC799',

  OBJECT_VALUE_REGEXP_COLOR: '#FF8080',
  OBJECT_VALUE_STRING_COLOR: '#99FFE4',
  OBJECT_VALUE_SYMBOL_COLOR: '#FFC799',
  OBJECT_VALUE_UNDEFINED_COLOR: '#A0A0A0',

  TABLE_BORDER_COLOR: '#282828',
  TABLE_DATA_BACKGROUND_IMAGE: 'none',
  TABLE_DATA_BACKGROUND_SIZE: '0',
  TABLE_SORT_ICON_COLOR: '#A0A0A0',

  TABLE_TH_BACKGROUND_COLOR: '#161616',
  TABLE_TH_HOVER_COLOR: '#232323',
  TREENODE_FONT_FAMILY: 'Menlo, monospace',
  TREENODE_FONT_SIZE: '11px',
  TREENODE_LINE_HEIGHT: 1.2,
  TREENODE_PADDING_LEFT: 12,
};

export interface InspectorHandle {
  disable: () => void;
  enable: () => void;
  inspectElement: (element: Element) => void;
}

export interface InspectorProps {
  children?: React.ReactNode;
  dangerouslyRunInProduction?: boolean;
  enabled?: boolean;
}

export const RawInspector = forwardRef<InspectorHandle, InspectorProps>(
  (
    { dangerouslyRunInProduction = false, enabled = true }: InspectorProps,
    ref,
  ) => {
    const [element, setElement] = useState<Element | null>(null);
    const [currentFiber, setCurrentFiber] = useState<Fiber | null>(null);
    const [rect, setRect] = useState<DOMRect | null>(null);
    const [isActive, setIsActive] = useState(true);
    const [isEnabled, setIsEnabled] = useState(enabled);
    const [position, setPosition] = useState({ left: 0, top: 0 });

    const currentCleanedFiber = useMemo(() => {
      if (!currentFiber) return null;
      const clonedFiber = { ...currentFiber };
      for (const key in clonedFiber) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const value = clonedFiber[key as keyof Fiber];
        if (!value) delete clonedFiber[key as keyof Fiber];
      }
      return clonedFiber;
    }, [currentFiber]);

    useImperativeHandle(ref, () => ({
      disable: () => {
        setIsEnabled(false);
        setElement(null);
        setRect(null);
      },
      enable: () => setIsEnabled(true),
      inspectElement: (element: Element) => {
        if (!isEnabled) return;
        setElement(element);
        setRect(element.getBoundingClientRect());
      },
    }));

    useEffect(() => {
      if (!element) return;
      const fiber = getFiberFromHostInstance(element);
      if (!fiber) return;
      const latestFiber = getLatestFiber(fiber);
      setCurrentFiber(latestFiber);
    }, [element]);

    useEffect(() => {
      const handleMouseMove = (event: globalThis.MouseEvent) => {
        const isActive = isInstrumentationActive() || hasRDTHook();
        if (!isActive) {
          setIsActive(false);
          return;
        }

        if (!dangerouslyRunInProduction) {
          const rdtHook = getRDTHook();
          for (const renderer of rdtHook.renderers.values()) {
            const buildType = detectReactBuildType(renderer);
            if (buildType === 'production') {
              setIsActive(false);
              return;
            }
          }
        }

        if (!isEnabled) {
          setElement(null);
          setRect(null);
          return;
        }

        const element = document.elementFromPoint(event.clientX, event.clientY);
        if (!element) return;
        setElement(element);
        setRect(element.getBoundingClientRect());
      };

      const throttledMouseMove = throttle(handleMouseMove, 16);
      document.addEventListener('mousemove', throttledMouseMove);
      return () =>
        document.removeEventListener('mousemove', throttledMouseMove);
    }, [isEnabled, dangerouslyRunInProduction]);

    useEffect(() => {
      if (!rect) return;

      const padding = 10;
      const inspectorWidth = 400;
      const inspectorHeight = 320;

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

    if (!rect || !isActive || !isEnabled) return null;

    if (!currentFiber) return null;

    return (
      <>
        <div
          className="inspector-container"
          style={{
            backgroundColor: '#101010',
            border: '1px solid #444',
            borderRadius: '8px',
            boxShadow: '0 4px 8px rgba(0, 0, 0, 0.5)',
            color: '#FFF',
            height: '25ch',
            left: position.left,
            opacity: rect ? 1 : 0,
            overflow: 'auto',
            padding: '1rem',
            pointerEvents: rect ? 'auto' : 'none',
            position: 'fixed',
            top: position.top,
            transform: rect ? 'translateY(0)' : 'translateY(10px)',
            transition: 'all 150ms ease-in-out',
            width: '30ch',
            zIndex: 50,
          }}
        >
          {currentFiber && (
            <ReactInspector
              data={currentCleanedFiber}
              expandLevel={1}
              table={false}
              // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
              theme={theme}
            />
          )}

          <div
            style={{
              alignItems: 'center',
              backgroundColor: '#101010',
              borderBottomLeftRadius: '8px',
              borderBottomRightRadius: '8px',
              borderTop: '1px solid #555',
              bottom: '0',
              display: 'flex',
              gap: '1rem',
              left: '0',
              padding: '0.75rem 1rem',
              position: 'absolute',
              right: '0',
              zIndex: 1000,
            }}
          >
            <div
              style={{
                backgroundColor: '#3a3a3a',
                borderRadius: '4px',
                color: '#FFF',
                fontSize: '0.875rem',
                padding: '0.25rem 0.5rem',
              }}
            >
              {`<${getDisplayName(currentFiber.type) || 'unknown'}>`}
            </div>
          </div>
        </div>
        <style>{`
          .inspector-container::-webkit-scrollbar {
            width: 8px;
          }
          .inspector-container::-webkit-scrollbar-track {
            background: #1E1E1E;
            border-radius: 8px;
          }
          .inspector-container::-webkit-scrollbar-thumb {
            background: #444;
            border-radius: 8px;
          }
          .inspector-container::-webkit-scrollbar-thumb:hover {
            background: #555;
          }
        `}</style>
        <div
          style={{
            border: '1px dashed #505050',
            height: rect.height,
            left: rect.left,
            opacity: rect ? 1 : 0,
            pointerEvents: 'none',
            position: 'fixed',
            top: rect.top,
            transition: 'all 150ms',
            width: rect.width,
            zIndex: 40,
          }}
        />
      </>
    );
  },
);

export const Inspector = forwardRef<InspectorHandle, InspectorProps>(
  (props, ref) => {
    const [root, setRoot] = useState<null | ShadowRoot>(null);

    useEffect(() => {
      const div = document.createElement('div');
      document.documentElement.appendChild(div);
      const shadowRoot = div.attachShadow({ mode: 'open' });
      setRoot(shadowRoot);

      return () => {
        document.documentElement.removeChild(div);
      };
    }, []);

    if (!root) return null;

    return ReactDOM.createPortal(<RawInspector ref={ref} {...props} />, root);
  },
);

export default Inspector;
