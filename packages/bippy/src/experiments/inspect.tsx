import {
  getDisplayName,
  getFiberFromHostInstance,
  traverseFiber,
  isInstrumentationActive,
  getRDTHook,
  detectReactBuildType,
  getFiberStack,
  getFiberId,
  type Fiber,
  getNearestHostFiber,
  hasRDTHook,
  isCompositeFiber,
} from '../index.js';
import React, {
  useState,
  useEffect,
  type ReactNode,
  type MouseEvent,
  useCallback,
} from 'react';
import {
  Inspector as ReactInspector,
  ObjectRootLabel,
  ObjectLabel,
} from 'react-inspector';
import ReactDOM from 'react-dom';

const FIBER_PROP_EXPLANATIONS: Record<string, string> = {
  tag: 'Numeric type identifier for this fiber (e.g. 1=FunctionComponent, 5=HostComponent)',
  elementType: 'The original function/class/element type',
  type: 'The resolved function/class after going through any HOCs',
  stateNode: 'Reference to the actual instance (DOM node, class instance, etc)',
  return: 'Parent fiber',
  child: 'First child fiber',
  sibling: 'Next sibling fiber',
  index: 'Position among siblings',
  ref: 'Ref object or function',
  pendingProps: 'Props that are about to be applied',
  memoizedProps: 'Props from the last render',
  memoizedState: 'State from the last render',
  dependencies: 'Context and other dependencies this fiber subscribes to',
  flags: 'Side-effects flags (e.g. needs update, deletion)',
  lanes: 'Priority lanes for updates',
  childLanes: 'Priority lanes for child updates',
};

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

export interface InspectorProps {
  enabled?: boolean;
  children?: ReactNode;
  dangerouslyRunInProduction?: boolean;
}

const isMac =
  typeof navigator !== 'undefined' &&
  navigator.platform.toLowerCase().includes('mac');

type InspectorTheme = {
  BASE_FONT_FAMILY: string;
  BASE_FONT_SIZE: string;
  BASE_LINE_HEIGHT: number;
  BASE_BACKGROUND_COLOR: string;
  BASE_COLOR: string;
  OBJECT_PREVIEW_ARRAY_MAX_PROPERTIES: number;
  OBJECT_PREVIEW_OBJECT_MAX_PROPERTIES: number;
  OBJECT_NAME_COLOR: string;
  OBJECT_VALUE_NULL_COLOR: string;
  OBJECT_VALUE_UNDEFINED_COLOR: string;
  OBJECT_VALUE_REGEXP_COLOR: string;
  OBJECT_VALUE_STRING_COLOR: string;
  OBJECT_VALUE_SYMBOL_COLOR: string;
  OBJECT_VALUE_NUMBER_COLOR: string;
  OBJECT_VALUE_BOOLEAN_COLOR: string;
  OBJECT_VALUE_FUNCTION_PREFIX_COLOR: string;
  HTML_TAG_COLOR: string;
  HTML_TAGNAME_COLOR: string;
  HTML_TAGNAME_TEXT_TRANSFORM: string;
  HTML_ATTRIBUTE_NAME_COLOR: string;
  HTML_ATTRIBUTE_VALUE_COLOR: string;
  HTML_COMMENT_COLOR: string;
  HTML_DOCTYPE_COLOR: string;
  ARROW_COLOR: string;
  ARROW_MARGIN_RIGHT: number;
  ARROW_FONT_SIZE: number;
  ARROW_ANIMATION_DURATION: string;
  TREENODE_FONT_FAMILY: string;
  TREENODE_FONT_SIZE: string;
  TREENODE_LINE_HEIGHT: number;
  TREENODE_PADDING_LEFT: number;
  TABLE_BORDER_COLOR: string;
  TABLE_TH_BACKGROUND_COLOR: string;
  TABLE_TH_HOVER_COLOR: string;
  TABLE_SORT_ICON_COLOR: string;
  TABLE_DATA_BACKGROUND_IMAGE: string;
  TABLE_DATA_BACKGROUND_SIZE: string;
};

const theme: InspectorTheme = {
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

const BackButton = React.memo(({ onClick }: { onClick: () => void }) => (
  <button
    type="button"
    onClick={onClick}
    style={{
      padding: '0.5ch 1ch',
      background: '#161616',
      border: '1px solid #282828',
      color: '#FFF',
      borderRadius: '0.25rem',
      cursor: 'pointer',
      fontSize: '0.875rem',
      opacity: 0.8,
      transition: 'opacity 150ms',
    }}
    onMouseEnter={(e) => {
      e.currentTarget.style.opacity = '1';
    }}
    onMouseLeave={(e) => {
      e.currentTarget.style.opacity = '0.8';
    }}
  >
    ← Back
  </button>
));

const BreadcrumbButton = React.memo(
  ({
    name,
    onClick,
    onKeyDown,
  }: {
    name: string;
    onClick: () => void;
    onKeyDown: (e: React.KeyboardEvent) => void;
  }) => (
    <button
      type="button"
      onClick={onClick}
      onKeyDown={onKeyDown}
      style={{
        cursor: 'pointer',
        textDecoration: 'underline',
        color: '#A0A0A0',
        background: 'none',
        border: 'none',
        padding: 0,
        font: 'inherit',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = '#232323';
        e.currentTarget.style.color = '#FFF';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = '';
        e.currentTarget.style.color = '#A0A0A0';
      }}
    >
      {name}
    </button>
  ),
);

const CloseButton = React.memo(({ onClick }: { onClick: () => void }) => (
  <button
    type="button"
    onClick={onClick}
    style={{
      border: 'none',
      background: 'none',
      cursor: 'pointer',
      padding: '0.5ch',
      fontSize: '2ch',
      opacity: 0.5,
      color: '#FFF',
    }}
  >
    ×
  </button>
));

export const RawInspector = React.memo(
  ({ enabled = true, dangerouslyRunInProduction = false }: InspectorProps) => {
    const [element, setElement] = useState<Element | null>(null);
    const [rect, setRect] = useState<DOMRect | null>(null);
    const [isActive, setIsActive] = useState(true);
    const [isDialogMode, setIsDialogMode] = useState(false);
    const [tooltip, setTooltip] = useState<string | null>(null);
    const [selectedFiber, setSelectedFiber] = useState<Fiber | null>(null);
    const [position, setPosition] = useState<{ top: number; left: number }>({
      top: 0,
      left: 0,
    });
    const [fiberHistory, setFiberHistory] = useState<Fiber[]>([]);

    const getFiberForDisplay = useCallback(() => {
      if (selectedFiber) return selectedFiber;
      const fiber = getFiberFromHostInstance(element);
      return fiber;
    }, [selectedFiber, element]);

    const handlePropertyHover = (
      _e: MouseEvent<HTMLElement>,
      propName: string,
    ) => {
      if (!isDialogMode) return;

      const explanation = FIBER_PROP_EXPLANATIONS[propName];
      setTooltip(explanation || null);
    };

    const handlePropertyLeave = () => {
      setTooltip(null);
    };

    const handleClose = useCallback(() => {
      setIsDialogMode(false);
      setFiberHistory([]);
      setTooltip(null);
      setSelectedFiber(null);
      setElement(null);
      setRect(null);
    }, []);

    useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'o' && (e.metaKey || e.ctrlKey) && rect) {
          e.preventDefault();
          const currentFiber = getFiberForDisplay();
          if (currentFiber) {
            setFiberHistory([currentFiber]);
          }
          setIsDialogMode(true);
        } else if (e.key === 'Escape') {
          handleClose();
        }
      };

      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }, [rect, getFiberForDisplay, handleClose]);

    useEffect(() => {
      if (!isDialogMode) {
        setTooltip(null);
        setFiberHistory([]);
        setSelectedFiber(null);
        setElement(null);
        setRect(null);
      }
    }, [isDialogMode]);

    useEffect(() => {
      const handleMouseMove = (event: globalThis.MouseEvent) => {
        if (isDialogMode) return;

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

        if (!enabled) {
          setElement(null);
          setRect(null);
          setSelectedFiber(null);
          return;
        }

        // Don't update element if in dialog mode
        if (!isDialogMode) {
          const element = document.elementFromPoint(
            event.clientX,
            event.clientY,
          );
          if (!element) return;
          setElement(element);
          setRect(element.getBoundingClientRect());
          setSelectedFiber(null);
        }
      };

      const throttledMouseMove = throttle(handleMouseMove, 16);

      document.addEventListener('mousemove', throttledMouseMove);
      return () => {
        document.removeEventListener('mousemove', throttledMouseMove);
      };
    }, [enabled, isDialogMode, dangerouslyRunInProduction]);

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

    useEffect(() => {
      if (selectedFiber) {
        const element = getNearestHostFiber(selectedFiber)?.stateNode;
        if (element) {
          setElement(element);
          setRect(element.getBoundingClientRect());
        }
      }
    }, [selectedFiber]);

    const handleBack = () => {
      const previousFiber = fiberHistory[fiberHistory.length - 1];
      if (previousFiber) {
        setFiberHistory((prev) => prev.slice(0, -1));
        setSelectedFiber(previousFiber);
      }
    };

    if (!rect || !isActive) return null;

    const fiber = getFiberForDisplay();
    if (!fiber) return null;

    let foundInspect = false;
    traverseFiber(
      fiber,
      (innerFiber) => {
        if (innerFiber.type === Inspector) {
          foundInspect = true;
          return true;
        }
      },
      true,
    );
    if (foundInspect) return null;

    const dialogStyle = isDialogMode
      ? ({
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: '80vw',
          height: '80vh',
          maxWidth: 'none',
          maxHeight: 'none',
          padding: '2ch',
          boxShadow: '0 0 0 5px rgba(0, 0, 0, 0.3)',
          backgroundColor: '#1a1a1a',
          border: '1px solid #333',
          zIndex: 1000,
        } as const)
      : {};

    const overlayStyle = isDialogMode
      ? ({
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.7)',
          zIndex: 999,
        } as const)
      : {};

    const fiberStack = fiber ? getFiberStack(fiber) : [];

    return (
      <>
        {isDialogMode && (
          <div
            style={overlayStyle}
            onClick={handleClose}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                handleClose();
              }
            }}
            role="button"
            tabIndex={0}
          />
        )}
        <div
          style={{
            position: 'fixed',
            backgroundColor: '#101010',
            color: '#FFF',
            zIndex: 50,
            padding: '1ch',
            width: '50ch',
            height: isDialogMode ? '80ch' : '40ch',
            transition: 'all 150ms, z-index 0ms',
            overflow: 'visible',
            boxShadow: '0 1px 3px 0 rgb(0 0 0 / 0.3)',
            border: '1px solid #282828',
            top: position.top,
            left: position.left,
            opacity: rect ? 1 : 0,
            transform: rect ? 'translateY(0)' : 'translateY(10px)',
            pointerEvents: rect ? 'auto' : 'none',
            display: 'flex',
            flexDirection: 'column',
            ...dialogStyle,
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '1ch' }}>
              {fiberHistory.length > 0 && <BackButton onClick={handleBack} />}
              <h3
                style={{
                  fontSize: '0.875rem',
                  backgroundColor: '#161616',
                  color: '#FFF',
                  padding: '0 0.5ch',
                  borderRadius: '0.125rem',
                  width: 'fit-content',
                  margin: 0,
                }}
              >
                {`<${typeof fiber.type === 'string' ? fiber.type : getDisplayName(fiber.type) || 'unknown'}>`}
                {!isDialogMode && (
                  <span
                    style={{
                      marginLeft: '1ch',
                      opacity: 0.5,
                      fontSize: '0.75rem',
                    }}
                  >
                    {`Press ${isMac ? '⌘' : 'ctrl'}O to expand`}
                  </span>
                )}
              </h3>
            </div>
            {isDialogMode && <CloseButton onClick={handleClose} />}
          </div>
          {isDialogMode && (
            <div
              style={{
                borderTop: '1px solid #282828',
                padding: '0.5ch 0',
                fontSize: '0.75rem',
                color: '#A0A0A0',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {fiberStack.reverse().map((f, i, arr) => {
                const name =
                  typeof f.type === 'string'
                    ? f.type
                    : getDisplayName(f.type) || 'unknown';
                if (!name) return null;
                return (
                  <React.Fragment key={getFiberId(f)}>
                    <BreadcrumbButton
                      name={name}
                      onClick={() => {
                        if (selectedFiber) {
                          setFiberHistory((prev) => [...prev, selectedFiber]);
                        }
                        setSelectedFiber(f);
                        const element = getNearestHostFiber(f)?.stateNode;
                        if (element) {
                          setElement(element);
                          setRect(element.getBoundingClientRect());
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          if (selectedFiber) {
                            setFiberHistory((prev) => [...prev, selectedFiber]);
                          }
                          setSelectedFiber(f);
                          const element = getNearestHostFiber(f)?.stateNode;
                          if (element) {
                            setElement(element);
                            setRect(element.getBoundingClientRect());
                          }
                        }
                      }}
                    />
                    {i < arr.length - 1 && ' > '}
                  </React.Fragment>
                );
              })}
            </div>
          )}
          <div style={{ flex: 1, overflow: 'auto' }}>
            {fiber && (
              <ReactInspector
                // biome-ignore lint/suspicious/noExplicitAny: <explanation>
                theme={theme as any}
                data={fiber}
                expandLevel={1}
                table={false}
                nodeRenderer={(props: {
                  depth: number;
                  name: string;
                  data: unknown;
                  isNonenumerable?: boolean;
                  expanded?: boolean;
                }) => {
                  const Component =
                    props.depth === 0 ? ObjectRootLabel : ObjectLabel;
                  return (
                    <span
                      onMouseEnter={(e) => handlePropertyHover(e, props.name)}
                      onMouseLeave={handlePropertyLeave}
                      style={{
                        cursor: FIBER_PROP_EXPLANATIONS[props.name]
                          ? 'help'
                          : 'default',
                        padding: '1px 0',
                        display: 'inline-block',
                        fontWeight: FIBER_PROP_EXPLANATIONS[props.name]
                          ? 500
                          : 'normal',
                      }}
                    >
                      <Component
                        name={props.name}
                        data={props.data}
                        isNonenumerable={props.isNonenumerable}
                      />
                    </span>
                  );
                }}
              />
            )}
          </div>
          {tooltip && (
            <div
              style={{
                position: 'absolute',
                zIndex: 1001,
                backgroundColor: '#161616',
                color: '#FFF',
                bottom: '2ch',
                right: '2ch',
                pointerEvents: 'none',
                overflowY: 'auto',
                padding: '1ch',
                fontSize: '1ch',
                border: '1px solid #282828',
                borderRadius: '0.25ch',
              }}
            >
              {tooltip}
            </div>
          )}
        </div>
        {!isDialogMode && (
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
        )}
      </>
    );
  },
);

export const Inspector = React.memo(({ ...props }: InspectorProps) => {
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

  return ReactDOM.createPortal(<RawInspector {...props} />, root);
});

export default Inspector;
