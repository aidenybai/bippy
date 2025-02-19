import {
  detectReactBuildType,
  type Fiber,
  getDisplayName,
  getFiberFromHostInstance,
  getLatestFiber,
  getRDTHook,
  hasRDTHook,
  isInstrumentationActive,
} from '../index.js';
import { getFiberSource, type FiberSource } from '../source.js';
// biome-ignore lint/style/useImportType: needed for jsx
import React, {
  useEffect,
  useState,
  useImperativeHandle as useImperativeHandleOriginal,
  forwardRef,
  useMemo,
} from 'react';
import ReactDOM from 'react-dom';
import { Inspector as ReactInspector } from 'react-inspector';

const useImperativeHandlePolyfill = (
  ref: React.RefCallback<unknown> | React.RefObject<unknown>,
  init: () => unknown,
  deps: React.DependencyList,
) => {
  // biome-ignore lint/correctness/useExhaustiveDependencies: biome is wrong
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

// biome-ignore lint/suspicious/noExplicitAny: OK
const throttle = (fn: (...args: any[]) => void, wait: number) => {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  return function (this: unknown) {
    if (!timeout) {
      timeout = setTimeout(() => {
        // biome-ignore lint/style/noArguments: perf
        fn.apply(this, arguments as unknown as unknown[]);
        timeout = null;
      }, wait);
    }
  };
};

// biome-ignore lint/suspicious/noExplicitAny: react-inspector types are wrong
const theme: any = {
  BASE_FONT_FAMILY: 'Menlo, monospace',
  BASE_FONT_SIZE: '12px',
  BASE_LINE_HEIGHT: 1.2,

  BASE_BACKGROUND_COLOR: 'none',
  BASE_COLOR: '#FFF',

  OBJECT_PREVIEW_ARRAY_MAX_PROPERTIES: 10,
  OBJECT_PREVIEW_OBJECT_MAX_PROPERTIES: 5,
  OBJECT_NAME_COLOR: '#FFC799',
  OBJECT_VALUE_NULL_COLOR: '#A0A0A0',
  OBJECT_VALUE_UNDEFINED_COLOR: '#A0A0A0',
  OBJECT_VALUE_REGEXP_COLOR: '#FF8080',
  OBJECT_VALUE_STRING_COLOR: '#99FFE4',
  OBJECT_VALUE_SYMBOL_COLOR: '#FFC799',
  OBJECT_VALUE_NUMBER_COLOR: '#FFC799',
  OBJECT_VALUE_BOOLEAN_COLOR: '#FFC799',
  OBJECT_VALUE_FUNCTION_PREFIX_COLOR: '#FFC799',

  HTML_TAG_COLOR: '#FFC799',
  HTML_TAGNAME_COLOR: '#FFC799',
  HTML_TAGNAME_TEXT_TRANSFORM: 'lowercase',
  HTML_ATTRIBUTE_NAME_COLOR: '#A0A0A0',
  HTML_ATTRIBUTE_VALUE_COLOR: '#99FFE4',
  HTML_COMMENT_COLOR: '#8b8b8b94',
  HTML_DOCTYPE_COLOR: '#A0A0A0',

  ARROW_COLOR: '#A0A0A0',
  ARROW_MARGIN_RIGHT: 3,
  ARROW_FONT_SIZE: 12,
  ARROW_ANIMATION_DURATION: '0',

  TREENODE_FONT_FAMILY: 'Menlo, monospace',
  TREENODE_FONT_SIZE: '11px',
  TREENODE_LINE_HEIGHT: 1.2,
  TREENODE_PADDING_LEFT: 12,

  TABLE_BORDER_COLOR: '#282828',
  TABLE_TH_BACKGROUND_COLOR: '#161616',
  TABLE_TH_HOVER_COLOR: '#232323',
  TABLE_SORT_ICON_COLOR: '#A0A0A0',
  TABLE_DATA_BACKGROUND_IMAGE: 'none',
  TABLE_DATA_BACKGROUND_SIZE: '0',
};

export interface InspectorProps {
  enabled?: boolean;
  children?: React.ReactNode;
  dangerouslyRunInProduction?: boolean;
}

export interface InspectorHandle {
  enable: () => void;
  disable: () => void;
  inspectElement: (element: Element) => void;
}

export const RawInspector = forwardRef<InspectorHandle, InspectorProps>(
  (
    { enabled = true, dangerouslyRunInProduction = false }: InspectorProps,
    ref,
  ) => {
    const [element, setElement] = useState<Element | null>(null);
    const [currentFiber, setCurrentFiber] = useState<Fiber | null>(null);
    const [currentFiberSource, setCurrentFiberSource] =
      useState<FiberSource | null>(null);
    const [rect, setRect] = useState<DOMRect | null>(null);
    const [isActive, setIsActive] = useState(true);
    const [isEnabled, setIsEnabled] = useState(enabled);
    const [position, setPosition] = useState({ top: 0, left: 0 });

    const currentCleanedFiber = useMemo(() => {
      if (!currentFiber) return null;
      const clonedFiber = { ...currentFiber };
      for (const key in clonedFiber) {
        const value = clonedFiber[key as keyof Fiber];
        if (!value) delete clonedFiber[key as keyof Fiber];
      }
      return clonedFiber;
    }, [currentFiber]);

    useImperativeHandle(ref, () => ({
      enable: () => setIsEnabled(true),
      disable: () => {
        setIsEnabled(false);
        setElement(null);
        setRect(null);
      },
      inspectElement: (element: Element) => {
        if (!isEnabled) return;
        setElement(element);
        setRect(element.getBoundingClientRect());
      },
    }));

    useEffect(() => {
      (async () => {
        if (!element) return;
        const fiber = getFiberFromHostInstance(element);
        if (!fiber) return;
        const latestFiber = getLatestFiber(fiber);
        const source = await getFiberSource(latestFiber);
        setCurrentFiber(latestFiber);
        if (source) {
          setCurrentFiberSource(source);
        }
      })();
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

      setPosition({ top, left });
    }, [rect]);

    if (!rect || !isActive || !isEnabled) return null;

    if (!currentFiber) return null;

    return (
      <>
        <div
          className="inspector-container"
          style={{
            position: 'fixed',
            backgroundColor: '#101010',
            color: '#FFF',
            zIndex: 50,
            padding: '1rem',
            width: '30ch',
            height: '25ch',
            transition: 'all 150ms ease-in-out',
            overflow: 'auto',
            boxShadow: '0 4px 8px rgba(0, 0, 0, 0.5)',
            border: '1px solid #444',
            borderRadius: '8px',
            opacity: rect ? 1 : 0,
            transform: rect ? 'translateY(0)' : 'translateY(10px)',
            pointerEvents: rect ? 'auto' : 'none',
            top: position.top,
            left: position.left,
          }}
        >
          {currentFiber && (
            <ReactInspector
              theme={theme}
              data={currentCleanedFiber}
              expandLevel={1}
              table={false}
            />
          )}

          <div
            style={{
              position: 'absolute',
              bottom: '0',
              left: '0',
              right: '0',
              display: 'flex',
              alignItems: 'center',
              gap: '1rem',
              backgroundColor: '#101010',
              padding: '0.75rem 1rem',
              borderTop: '1px solid #555',
              borderBottomLeftRadius: '8px',
              borderBottomRightRadius: '8px',
              zIndex: 1000,
            }}
          >
            <div
              style={{
                fontSize: '0.875rem',
                color: '#FFF',
                padding: '0.25rem 0.5rem',
                borderRadius: '4px',
                backgroundColor: '#3a3a3a',
              }}
            >
              {`<${getDisplayName(currentFiber.type) || 'unknown'}>`}
            </div>
            <div
              style={{
                fontSize: '0.75rem',
                color: '#CCC',
              }}
            >
              {currentFiberSource ? (
                <>
                  {currentFiberSource.fileName.split('/').slice(-2).join('/')}{' '}
                  <br />@ line {currentFiberSource.lineNumber}, column{' '}
                  {currentFiberSource.columnNumber}
                </>
              ) : null}
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
            position: 'fixed',
            zIndex: 40,
            pointerEvents: 'none',
            transition: 'all 150ms',
            border: '1px dashed #505050',
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
            opacity: rect ? 1 : 0,
          }}
        />
      </>
    );
  },
);

export const Inspector = forwardRef<InspectorHandle, InspectorProps>(
  (props, ref) => {
    const [root, setRoot] = useState<ShadowRoot | null>(null);

    useEffect(() => {
      const div = document.createElement('div');
      document.body.appendChild(div);
      const shadowRoot = div.attachShadow({ mode: 'open' });
      setRoot(shadowRoot);

      return () => {
        document.body.removeChild(div);
      };
    }, []);

    if (!root) return null;

    return ReactDOM.createPortal(<RawInspector ref={ref} {...props} />, root);
  },
);

export default Inspector;
