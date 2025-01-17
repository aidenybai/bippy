import {
  getDisplayName,
  getFiberFromHostInstance,
  traverseFiber,
  isInstrumentationActive,
  getRDTHook,
  detectReactBuildType,
  isCompositeFiber,
  getFiberStack,
  getFiberId,
  type Fiber,
  getNearestHostFiber,
  hasRDTHook,
  FragmentTag,
  isHostFiber,
  HostRootTag,
  HostTextTag,
  onCommitFiberRoot,
  traverseRenderedFibers,
} from './index.js';
import React, {
  useState,
  useEffect,
  useRef,
  type ReactNode,
  type MouseEvent,
  useCallback,
  useMemo,
} from 'react';
import {
  Inspector as ReactInspector,
  ObjectRootLabel,
  ObjectLabel,
} from 'react-inspector';
import * as d3 from 'd3';

// Store render counts in a WeakMap
const renderCounts = new WeakMap<Fiber, number>();

interface FiberState {
  props: Record<string, unknown>;
  hookState: Record<string, unknown>;
  timestamp: number;
}

const fiberStates = new Map<string, Array<FiberState>>();

interface Node extends d3.SimulationNodeDatum {
  id: string;
  name: string;
  fiber: Fiber;
  depth: number;
  x?: number;
  y?: number;
}

interface Link extends d3.SimulationLinkDatum<Node> {
  source: string | Node;
  target: string | Node;
}

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

const ControlButton = React.memo(
  ({ onClick, children }: { onClick: () => void; children: ReactNode }) => (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={(e) => {
        e.currentTarget.style.opacity = '1';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.opacity = '0.8';
      }}
      style={{
        padding: '0.5ch 0.75ch',
        background: 'transparent',
        border: '1px solid #282828',
        color: '#FFF',
        borderRadius: '0.25rem',
        cursor: 'pointer',
        fontSize: '0.75rem',
        lineHeight: 1,
        opacity: 0.8,
        transition: 'opacity 150ms',
      }}
    >
      {children}
    </button>
  ),
);

const Controls = React.memo(
  ({
    onZoomIn,
    onZoomOut,
    onReset,
    onFit,
  }: {
    onZoomIn: () => void;
    onZoomOut: () => void;
    onReset: () => void;
    onFit: () => void;
  }) => (
    <div
      style={{
        position: 'absolute',
        right: '1ch',
        bottom: '1ch',
        display: 'flex',
        gap: '0.5ch',
        zIndex: 1,
        background: '#161616',
        padding: '0.5ch',
        borderRadius: '0.25rem',
        border: '1px solid #282828',
      }}
    >
      <ControlButton onClick={onZoomIn}>+</ControlButton>
      <ControlButton onClick={onZoomOut}>-</ControlButton>
      <ControlButton onClick={onReset}>Reset</ControlButton>
      <ControlButton onClick={onFit}>Fit</ControlButton>
    </div>
  ),
);

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

const FiberGraph = React.memo(
  ({
    fiber,
    onFiberSelect,
    isDialogMode = true,
  }: {
    fiber: Fiber;
    onFiberSelect?: (fiber: Fiber) => void;
    isDialogMode?: boolean;
  }) => {
    const svgRef = useRef<SVGSVGElement>(null);
    const [svgWidth, setSvgWidth] = useState(0);
    const [svgHeight, setSvgHeight] = useState(0);
    const svgGroupRef = useRef<SVGGElement>(null);
    const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown>>();
    const linksGroupRef = useRef<SVGGElement>(null);
    const nodesGroupRef = useRef<SVGGElement>(null);
    const renderedFibersRef = useRef<Set<string>>(new Set());
    const flashTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
    const [timelineIndex, setTimelineIndex] = useState<number>(-1);
    const [isPlaying, setIsPlaying] = useState(false);
    const playIntervalRef = useRef<ReturnType<typeof setInterval>>();
    const [activeTab, setActiveTab] = useState<'graph' | 'fiber'>('graph');
    const [tooltip, setTooltip] = useState<string | null>(null);

    const handlePropertyHover = (e: MouseEvent<HTMLElement>, propName: string) => {
      if (!isDialogMode) return;
      const explanation = FIBER_PROP_EXPLANATIONS[propName];
      setTooltip(explanation || null);
    };

    const handlePropertyLeave = () => {
      setTooltip(null);
    };

    const { nodes, links } = useMemo(() => {
      const nodes: Node[] = [];
      const links: Link[] = [];
      const nodeMap = new Map<string, Node>();
      // const stack: Array<{
      //   fiber: Fiber;
      //   depth: number;
      //   parentId: string | null;
      // }> = [{ fiber, depth: 0, parentId: null }];
      let nodeCounter = 0;

      const baseId = getFiberId(fiber).toString();
      const rootId = `${baseId}-${nodeCounter++}`;
      const rootName =
        typeof fiber.type === 'string'
          ? fiber.type
          : fiber.type === null && fiber.tag === HostRootTag
            ? '#root'
            : fiber.type === null && fiber.tag === HostTextTag
              ? '#text'
              : getDisplayName(fiber.type) ||
                fiber.type?.name ||
                fiber.type?.displayName ||
                'Component';

      const rootNode = {
        id: rootId,
        name: rootName,
        fiber,
        depth: 0,
      };
      nodes.push(rootNode);
      nodeMap.set(rootId, rootNode);

      if (fiber.child) {
        const stack = [
          {
            fiber: fiber.child,
            parentId: rootId,
            depth: 1,
          },
        ];

        while (stack.length > 0) {
          const current = stack.pop();
          if (!current) continue;
          const { fiber: currentFiber, parentId, depth } = current;

          if (currentFiber.tag === FragmentTag) {
            if (currentFiber.child) {
              stack.push({
                fiber: currentFiber.child,
                parentId,
                depth,
              });
            }
            if (
              currentFiber.sibling &&
              currentFiber.return === currentFiber.sibling.return
            ) {
              stack.push({
                fiber: currentFiber.sibling,
                parentId: currentFiber.return
                  ? nodeMap.get(getFiberId(currentFiber.return).toString())
                      ?.id || parentId
                  : parentId,
                depth,
              });
            }
            continue;
          }

          if (currentFiber.type === null && isHostFiber(currentFiber)) {
            if (currentFiber.child) {
              stack.push({
                fiber: currentFiber.child,
                parentId,
                depth,
              });
            }
            if (
              currentFiber.sibling &&
              currentFiber.return === currentFiber.sibling.return
            ) {
              stack.push({
                fiber: currentFiber.sibling,
                parentId: currentFiber.return
                  ? nodeMap.get(getFiberId(currentFiber.return).toString())
                      ?.id || parentId
                  : parentId,
                depth,
              });
            }
            continue;
          }

          const childId = `${getFiberId(currentFiber)}-${nodeCounter++}`;
          let name = 'unknown';
          if (typeof currentFiber.type === 'string') {
            name = currentFiber.type;
          } else if (
            currentFiber.type === null &&
            currentFiber.tag === HostTextTag
          ) {
            const text = currentFiber.stateNode?.nodeValue?.trim() || '';
            if (text) {
              name =
                text.length > 20 ? `"${text.slice(0, 20)}..."` : `"${text}"`;
            } else {
              name = '#text';
            }
          } else if (
            currentFiber.type === null &&
            currentFiber.tag === HostRootTag
          ) {
            name = '#root';
          } else {
            name =
              getDisplayName(currentFiber.type) ||
              currentFiber.type?.name ||
              currentFiber.type?.displayName ||
              'Component';
          }

          const node = {
            id: childId,
            name,
            fiber: currentFiber,
            depth,
          };
          nodes.push(node);
          nodeMap.set(childId, node);

          links.push({
            source: parentId,
            target: childId,
          });

          if (currentFiber.child) {
            stack.push({
              fiber: currentFiber.child,
              parentId: childId,
              depth: depth + 1,
            });
          }

          if (
            currentFiber.sibling &&
            currentFiber.return === currentFiber.sibling.return
          ) {
            stack.push({
              fiber: currentFiber.sibling,
              parentId: currentFiber.return
                ? nodeMap.get(getFiberId(currentFiber.return).toString())?.id ||
                  parentId
                : parentId,
              depth,
            });
          }
        }
      }

      return { nodes, links };
    }, [fiber]);

    const { descendants, treeLinks } = useMemo(() => {
      if (!svgWidth || !svgHeight || nodes.length === 0) {
        return { descendants: [], treeLinks: [] };
      }

      const stratify = d3
        .stratify<Node>()
        .id((d) => d.id)
        .parentId((d) => {
          if (d.id === nodes[0].id) return null;
          const parentLink = links.find((link) => link.target === d.id);
          if (
            parentLink?.source &&
            nodes.some((n) => n.id === parentLink.source)
          ) {
            return parentLink.source.toString();
          }
          return null;
        });

      try {
        const root = stratify(nodes);
        if (!root) return { descendants: [], treeLinks: [] };

        const treeLayout = d3
          .tree<Node>()
          .size([svgWidth - 200, svgHeight - 100])
          .nodeSize([180, 200]);

        const treeData = treeLayout(root);
        return {
          descendants: treeData.descendants(),
          treeLinks: treeData.links(),
        };
      } catch (e) {
        console.error('Error creating tree layout:', e);
        return { descendants: [], treeLinks: [] };
      }
    }, [nodes, links, svgWidth, svgHeight]);

    // Setup zoom behavior
    useEffect(() => {
      if (!svgRef.current || !svgGroupRef.current) return;

      const zoom = d3
        .zoom<SVGSVGElement, unknown>()
        .extent([
          [0, 0],
          [svgWidth, svgHeight],
        ])
        .scaleExtent([0.2, 8])
        .on('zoom', ({ transform }: { transform: d3.ZoomTransform }) => {
          if (!svgGroupRef.current) return;
          svgGroupRef.current.style.transform = `translate(${transform.x}px, ${transform.y}px) scale(${transform.k})`;
        });

      zoomRef.current = zoom;
      d3.select(svgRef.current).call(zoom);

      if (!isDialogMode) {
        const scale = 0.4;
        const x = svgWidth / 2;
        const y = svgHeight / 3;
        d3.select(svgRef.current).call(
          zoom.transform,
          d3.zoomIdentity.translate(x, y).scale(scale),
        );
      }

      return () => {
        if (svgRef.current) {
          d3.select(svgRef.current).on('.zoom', null);
        }
      };
    }, [svgWidth, svgHeight, isDialogMode]);

    useEffect(() => {
      if (!linksGroupRef.current || treeLinks.length === 0) return;

      d3.select(linksGroupRef.current)
        .selectAll('path')
        .data(treeLinks)
        .join('path')
        .attr(
          'd',
          d3
            .linkVertical<unknown, d3.HierarchyPointLink<Node>>()
            .x((d) => (d as unknown as { x: number }).x)
            .y((d) => (d as unknown as { y: number }).y),
        )
        .attr('fill', 'none')
        .attr('stroke', '#404040')
        .attr('stroke-width', '2');
    }, [treeLinks]);

    useEffect(() => {
      if (!nodesGroupRef.current || descendants.length === 0) return;

      const nodeElements = d3
        .select(nodesGroupRef.current)
        .selectAll<SVGGElement, d3.HierarchyPointNode<Node>>('g')
        .data(descendants, (d: d3.HierarchyPointNode<Node>) => d.data.id);

      nodeElements.exit().remove();

      const nodeEnter = nodeElements
        .enter()
        .append('g')
        .attr('transform', (d) => `translate(${d.x},${d.y})`)
        .style('cursor', 'pointer')
        .on('click', (event: MouseEvent, d: d3.HierarchyPointNode<Node>) => {
          event.stopPropagation();
          const element = getNearestHostFiber(d.data.fiber)?.stateNode;
          if (element instanceof HTMLElement) {
            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
            const originalOutline = element.style.outline;
            const originalTransition = element.style.transition;
            element.style.outline = '2px solid #FFC799';
            element.style.transition = 'outline 0.1s ease-in-out';
            setTimeout(() => {
              element.style.outline = originalOutline;
              element.style.transition = originalTransition;
            }, 1000);
          }
          onFiberSelect?.(d.data.fiber);
        });

      const nodeUpdate = nodeElements.merge(nodeEnter);
      nodeUpdate.attr('transform', (d) => `translate(${d.x},${d.y})`);

      const updateRect = (
        selection: d3.Selection<
          SVGGElement,
          d3.HierarchyPointNode<Node>,
          SVGGElement,
          unknown
        >,
      ) => {
        selection.each(function (d: d3.HierarchyPointNode<Node>) {
          const g = d3.select(this);
          const isRoot = d.data.id === nodes[0].id;
          const isPreview = !isDialogMode;
          const scale = isRoot ? (isPreview ? 2 : 1.75) : 1;
          const isRendered = renderedFibersRef.current.has(
            getFiberId(d.data.fiber).toString(),
          );

          // Rectangle
          const rect = g
            .selectAll('rect')
            .data([d])
            .join('rect')
            .attr('x', -75 * scale)
            .attr('y', -30 * scale)
            .attr('width', 150 * scale)
            .attr('height', 60 * scale)
            .attr('rx', 6 * scale)
            .attr('fill', isCompositeFiber(d.data.fiber) ? '#FFF' : '#232323')
            .attr('stroke', isRendered ? '#FFC799' : '#505050')
            .attr('stroke-width', isRoot ? '3' : '2');

          rect
            .on('mouseover', function () {
              d3.select(this)
                .attr('stroke', '#808080')
                .attr('stroke-width', isRoot ? '4' : '3');
            })
            .on('mouseout', function () {
              d3.select(this)
                .attr('stroke', isRendered ? '#FFC799' : '#505050')
                .attr('stroke-width', isRoot ? '3' : '2');
            });

          // Get render count from WeakMap
          const renderCount = renderCounts.get(d.data.fiber) || 0;
          const renderText = renderCount > 0 ? ` ×${renderCount}` : '';

          g.selectAll('text.name')
            .data([d])
            .join('text')
            .attr('class', 'name')
            .attr('text-anchor', 'middle')
            .attr('dy', `${-0.6 * scale}em`)
            .attr('fill', isCompositeFiber(d.data.fiber) ? '#000' : '#FFF')
            .attr('font-weight', '500')
            .attr(
              'font-size',
              isRoot ? (isPreview ? '1.75em' : '1.5em') : '1em',
            )
            .text(d.data.name + renderText);

          g.selectAll('text.props')
            .data([d])
            .join('text')
            .attr('class', 'props')
            .attr('text-anchor', 'middle')
            .attr('dy', `${0.9 * scale}em`)
            .attr('fill', isCompositeFiber(d.data.fiber) ? '#666' : '#999')
            .attr(
              'font-size',
              isRoot ? (isPreview ? '1.25em' : '1.1em') : '0.75em',
            )
            .text(() => {
              const props = d.data.fiber.memoizedProps;
              if (!props || typeof props !== 'object') return '';
              const propNames = Object.keys(props);
              if (propNames.length === 0) return '';
              const displayProps = propNames.slice(0, 3);
              if (propNames.length > 3) {
                return `${displayProps.join(', ')}...`;
              }
              return displayProps.join(', ');
            });
        });
      };

      updateRect(nodeUpdate);
    }, [descendants, nodes, isDialogMode, onFiberSelect]);

    const handleZoomIn = useCallback(() => {
      if (!svgRef.current || !zoomRef.current) return;
      d3.select(svgRef.current)
        .transition()
        .duration(200)
        .call(zoomRef.current.scaleBy, 1.5);
    }, []);

    const handleZoomOut = useCallback(() => {
      if (!svgRef.current || !zoomRef.current) return;
      d3.select(svgRef.current)
        .transition()
        .duration(200)
        .call(zoomRef.current.scaleBy, 0.75);
    }, []);

    const handleReset = useCallback(() => {
      if (!svgRef.current || !zoomRef.current) return;
      d3.select(svgRef.current)
        .transition()
        .duration(200)
        .call(zoomRef.current.transform, d3.zoomIdentity);
    }, []);

    const handleFit = useCallback(() => {
      if (!svgRef.current || !svgGroupRef.current || !zoomRef.current) return;
      const bounds = svgGroupRef.current.getBBox();
      const fullWidth = svgWidth;
      const fullHeight = svgHeight;
      const width = bounds.width;
      const height = bounds.height;
      const midX = bounds.x + width / 2;
      const midY = bounds.y + height / 2;
      const scale = 0.9 / Math.max(width / fullWidth, height / fullHeight);
      const translate = [
        fullWidth / 2 - scale * midX,
        fullHeight / 2 - scale * midY,
      ];

      d3.select(svgRef.current)
        .transition()
        .duration(200)
        .call(
          zoomRef.current.transform,
          d3.zoomIdentity.translate(translate[0], translate[1]).scale(scale),
        );
    }, [svgWidth, svgHeight]);

    useEffect(() => {
      if (!svgRef.current) return;
      const resizeObserver = new ResizeObserver(() => {
        if (!svgRef.current) return;
        setSvgWidth(svgRef.current.clientWidth);
        setSvgHeight(svgRef.current.clientHeight);
      });
      resizeObserver.observe(svgRef.current);
      return () => resizeObserver.disconnect();
    }, []);

    useEffect(() => {
      if (nodes.length > 0) {
        setTimeout(handleFit, 0);
      }
    }, [nodes.length, handleFit]);

    useEffect(() => {
      onCommitFiberRoot((root) => {
        // Clear previous timeout
        if (flashTimeoutRef.current) {
          clearTimeout(flashTimeoutRef.current);
        }

        // Update ref directly instead of state
        renderedFibersRef.current = new Set();
        traverseRenderedFibers(root, (renderedFiber) => {
          const fiberId = getFiberId(renderedFiber).toString();
          renderedFibersRef.current.add(fiberId);

          // Save fiber state
          const states = fiberStates.get(fiberId) || [];
          states.push({
            props: renderedFiber.memoizedProps ?? {},
            hookState: renderedFiber.memoizedState ?? {},
            timestamp: Date.now(),
          });
          fiberStates.set(fiberId, states);

          // Increment render count in WeakMap
          renderCounts.set(renderedFiber, (renderCounts.get(renderedFiber) || 0) + 1);
        });

        // Force update only the rendered nodes
        if (nodesGroupRef.current) {
          const nodeElements = d3
            .select(nodesGroupRef.current)
            .selectAll<SVGGElement, d3.HierarchyPointNode<Node>>('g');

          nodeElements.each(function (d) {
            const isRendered = renderedFibersRef.current.has(
              getFiberId(d.data.fiber).toString(),
            );
            if (isRendered) {
              const rect = d3.select(this).select('rect');
              rect
                .attr('stroke', '#FFC799')
                .style('filter', 'drop-shadow(0 0 8px #FFC799)')
                .transition()
                .duration(400)
                .style('filter', 'none')
                .attr('stroke', '#505050');

              // Update the name text to include new render count
              const renderCount = renderCounts.get(d.data.fiber) || 0;
              const renderText = renderCount > 0 ? ` ×${renderCount}` : '';
              d3.select(this)
                .select('text.name')
                .text(d.data.name + renderText);
            }
          });
        }

        // Clear rendered fibers after animation
        flashTimeoutRef.current = setTimeout(() => {
          renderedFibersRef.current = new Set();
        }, 400);
      });

      return () => {
        if (flashTimeoutRef.current) {
          clearTimeout(flashTimeoutRef.current);
        }
      };
    }, []);

    const handleTimelineChange = useCallback((index: number) => {
      setTimelineIndex(index);
      const fiberId = getFiberId(fiber).toString();
      const states = fiberStates.get(fiberId);

      if (states?.[index]) {
        const rdtHook = getRDTHook();
        if (rdtHook?.renderers.size > 0) {
          const renderer = Array.from(rdtHook.renderers.values())?.[0] as {
            currentDispatcherRef?: {
              current?: {
                overrideProps?: (fiber: Fiber, props?: Record<string, unknown>) => void;
                overrideHookState?: (fiber: Fiber, state?: Record<string, unknown>) => void;
              }
            }
          };
          const overrideProps = renderer?.currentDispatcherRef?.current?.overrideProps;
          const overrideHookState = renderer?.currentDispatcherRef?.current?.overrideHookState;

          const state = states?.[index];
          if (state) {
            if (overrideProps) {
              overrideProps(fiber, state.props);
            }
            if (overrideHookState) {
              overrideHookState(fiber, state.hookState);
            }
          }
        }
      }
    }, [fiber]);

    const handlePlayPause = useCallback(() => {
      setIsPlaying(prev => !prev);
    }, []);

    const handleStepForward = useCallback(() => {
      const states = fiberStates.get(getFiberId(fiber).toString());
      if (states) {
        const nextIndex = Math.min(timelineIndex + 1, states.length - 1);
        handleTimelineChange(nextIndex);
      }
    }, [fiber, timelineIndex, handleTimelineChange]);

    const handleStepBack = useCallback(() => {
      const states = fiberStates.get(getFiberId(fiber).toString());
      if (states) {
        const prevIndex = Math.max(timelineIndex - 1, 0);
        handleTimelineChange(prevIndex);
      }
    }, [fiber, timelineIndex, handleTimelineChange]);

    useEffect(() => {
      if (isPlaying) {
        playIntervalRef.current = setInterval(() => {
          const states = fiberStates.get(getFiberId(fiber).toString());
          if (states) {
            const nextIndex = timelineIndex + 1;
            if (nextIndex >= states.length) {
              setIsPlaying(false);
            } else {
              handleTimelineChange(nextIndex);
            }
          }
        }, 1000);
      } else if (playIntervalRef.current) {
        clearInterval(playIntervalRef.current);
      }

      return () => {
        if (playIntervalRef.current) {
          clearInterval(playIntervalRef.current);
        }
      };
    }, [isPlaying, fiber, timelineIndex, handleTimelineChange]);

    return (
      <div style={{ height: '50ch', marginTop: '2ch', display: 'flex', flexDirection: 'column', position: 'relative' }}>
        {isDialogMode && (
          <div style={{
            display: 'flex',
            gap: '0.5ch',
            marginBottom: '1ch',
            padding: '0 1ch',
            borderBottom: '1px solid #282828'
          }}>
            <button
              type="button"
              onClick={() => setActiveTab('graph')}
              style={{
                background: 'transparent',
                border: 'none',
                color: activeTab === 'graph' ? '#FFC799' : '#A0A0A0',
                padding: '1ch',
                cursor: 'pointer',
                position: 'relative',
                fontSize: '0.875rem',
                fontWeight: activeTab === 'graph' ? 500 : 400,
              }}
            >
              Graph View
              {activeTab === 'graph' && (
                <div style={{
                  position: 'absolute',
                  bottom: '-1px',
                  left: 0,
                  right: 0,
                  height: '2px',
                  background: '#FFC799',
                  borderRadius: '2px 2px 0 0',
                }} />
              )}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('fiber')}
              style={{
                background: 'transparent',
                border: 'none',
                color: activeTab === 'fiber' ? '#FFC799' : '#A0A0A0',
                padding: '1ch',
                cursor: 'pointer',
                position: 'relative',
                fontSize: '0.875rem',
                fontWeight: activeTab === 'fiber' ? 500 : 400,
              }}
            >
              Fiber View
              {activeTab === 'fiber' && (
                <div style={{
                  position: 'absolute',
                  bottom: '-1px',
                  left: 0,
                  right: 0,
                  height: '2px',
                  background: '#FFC799',
                  borderRadius: '2px 2px 0 0',
                }} />
              )}
            </button>
          </div>
        )}

        <div style={{ position: 'relative', flex: 1 }}>
          <div style={{
            position: 'absolute',
            inset: 0,
            display: activeTab === 'graph' ? 'block' : 'none'
          }}>
            <Controls
              onZoomIn={handleZoomIn}
              onZoomOut={handleZoomOut}
              onReset={handleReset}
              onFit={handleFit}
            />
            <svg
              ref={svgRef}
              viewBox={`0 0 ${svgWidth} ${svgHeight}`}
              xmlns="http://www.w3.org/2000/svg"
              style={{
                width: '100%',
                height: '100%',
                background: '#101010',
                borderRadius: '0.25rem',
                cursor: 'grab',
              }}
              aria-label="Fiber Tree Visualization"
            >
              <title>Fiber Tree Visualization</title>
              <g ref={svgGroupRef}>
                <g ref={linksGroupRef} className="links" />
                <g ref={nodesGroupRef} className="nodes" />
              </g>
            </svg>
          </div>

          <div style={{
            position: 'absolute',
            inset: 0,
            display: activeTab === 'fiber' ? 'block' : 'none',
            overflow: 'auto',
            background: '#101010',
            borderRadius: '0.25rem',
            padding: '1ch'
          }}>
            <ReactInspector
              // biome-ignore lint/suspicious/noExplicitAny: <explanation>
              theme={theme as any}
              data={fiber}
              expandLevel={isDialogMode ? 1 : 0}
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
            {tooltip && (
              <div style={{
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
              }}>
                {tooltip}
              </div>
            )}
          </div>
        </div>

        {isDialogMode && (
          <div style={{
            background: '#161616',
            padding: '1ch',
            margin: '1ch 1ch 0 1ch',
            borderRadius: '0.25rem',
            border: '1px solid #282828',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.5ch',
            opacity: fiberStates.get(getFiberId(fiber).toString())?.length ? 1 : 0.5,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5ch' }}>
              <button
                type="button"
                onClick={handleStepBack}
                disabled={!fiberStates.get(getFiberId(fiber).toString())?.length}
                style={{
                  background: 'transparent',
                  border: '1px solid #282828',
                  color: '#FFF',
                  borderRadius: '0.25rem',
                  cursor: fiberStates.get(getFiberId(fiber).toString())?.length ? 'pointer' : 'not-allowed',
                  padding: '0.25ch 0.5ch',
                }}
              >
                ⏮
              </button>
              <button
                type="button"
                onClick={handlePlayPause}
                disabled={!fiberStates.get(getFiberId(fiber).toString())?.length}
                style={{
                  background: 'transparent',
                  border: '1px solid #282828',
                  color: '#FFF',
                  borderRadius: '0.25rem',
                  cursor: fiberStates.get(getFiberId(fiber).toString())?.length ? 'pointer' : 'not-allowed',
                  padding: '0.25ch 0.5ch',
                }}
              >
                {isPlaying ? '⏸' : '▶️'}
              </button>
              <button
                type="button"
                onClick={handleStepForward}
                disabled={!fiberStates.get(getFiberId(fiber).toString())?.length}
                style={{
                  background: 'transparent',
                  border: '1px solid #282828',
                  color: '#FFF',
                  borderRadius: '0.25rem',
                  cursor: fiberStates.get(getFiberId(fiber).toString())?.length ? 'pointer' : 'not-allowed',
                  padding: '0.25ch 0.5ch',
                }}
              >
                ⏭
              </button>
              <span style={{ color: '#A0A0A0', fontSize: '0.75rem' }}>
                {timelineIndex >= 0 && fiberStates.get(getFiberId(fiber).toString())?.[timelineIndex]?.timestamp
                  ? new Date(fiberStates.get(getFiberId(fiber).toString())?.[timelineIndex]?.timestamp ?? 0).toLocaleTimeString()
                  : '--:--:--'}
              </span>
              {!fiberStates.get(getFiberId(fiber).toString())?.length && (
                <span style={{ color: '#A0A0A0', fontSize: '0.75rem', marginLeft: 'auto' }}>
                  No state changes recorded yet
                </span>
              )}
            </div>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.25ch',
              height: '2ch',
              position: 'relative',
            }}>
              {(fiberStates.get(getFiberId(fiber).toString()) ?? []).map((state, i) => {
                const isActive = i === timelineIndex;
                return (
                  <div
                    key={state.timestamp}
                    onClick={() => handleTimelineChange(i)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        handleTimelineChange(i);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                    style={{
                      flex: 1,
                      height: '100%',
                      background: isActive ? '#FFC799' : '#282828',
                      cursor: 'pointer',
                      position: 'relative',
                      borderRadius: '0.125rem',
                      transition: 'background-color 150ms',
                      outline: 'none',
                    }}
                    onMouseEnter={(e) => {
                      const target = e.currentTarget;
                      const tooltip = document.createElement('div');
                      tooltip.style.position = 'absolute';
                      tooltip.style.bottom = '100%';
                      tooltip.style.left = '50%';
                      tooltip.style.transform = 'translateX(-50%)';
                      tooltip.style.background = '#161616';
                      tooltip.style.color = '#FFF';
                      tooltip.style.padding = '0.5ch';
                      tooltip.style.borderRadius = '0.25rem';
                      tooltip.style.fontSize = '0.75rem';
                      tooltip.style.whiteSpace = 'nowrap';
                      tooltip.style.pointerEvents = 'none';
                      tooltip.style.border = '1px solid #282828';
                      tooltip.style.zIndex = '1000';

                      const changes: string[] = [];
                      const states = fiberStates.get(getFiberId(fiber).toString());
                      const prevState = i > 0 && states ? states[i - 1] : null;

                      if (prevState) {
                        // Compare props
                        const propChanges = Object.keys(state.props).filter(key =>
                          state.props[key] !== prevState.props[key]
                        );
                        if (propChanges.length > 0) {
                          changes.push(`Props: ${propChanges.join(', ')}`);
                        }

                        // Compare hook state
                        const hookChanges = Object.keys(state.hookState).filter(key =>
                          state.hookState[key] !== prevState.hookState[key]
                        );
                        if (hookChanges.length > 0) {
                          changes.push(`State: ${hookChanges.join(', ')}`);
                        }
                      }

                      tooltip.textContent = changes.length > 0
                        ? changes.join(' | ')
                        : prevState ? 'No changes' : 'Initial state';

                      target.appendChild(tooltip);
                    }}
                    onMouseLeave={(e) => {
                      const tooltip = e.currentTarget.querySelector('div');
                      if (tooltip) {
                        tooltip.remove();
                      }
                    }}
                  />
                );
              })}
              {!fiberStates.get(getFiberId(fiber).toString())?.length && (
                <div style={{
                  flex: 1,
                  height: '100%',
                  background: '#282828',
                  borderRadius: '0.125rem',
                  opacity: 0.5,
                }} />
              )}
            </div>
            <input
              type="range"
              min={0}
              max={(fiberStates.get(getFiberId(fiber).toString())?.length ?? 1) - 1}
              value={timelineIndex}
              onChange={(e) => handleTimelineChange(Number(e.target.value))}
              disabled={!fiberStates.get(getFiberId(fiber).toString())?.length}
              style={{
                width: '100%',
                accentColor: '#FFC799',
                opacity: fiberStates.get(getFiberId(fiber).toString())?.length ? 1 : 0.5,
              }}
            />
          </div>
        )}
      </div>
    );
  },
);

export const Inspector = React.memo(
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

    const handleFiberSelect = (fiber: Fiber) => {
      if (fiber !== selectedFiber) {
        if (!isDialogMode) {
          const currentFiber = getFiberForDisplay();
          if (currentFiber) {
            setFiberHistory([currentFiber]);
          }
          setIsDialogMode(true);
        } else if (selectedFiber) {
          setFiberHistory((prev) => [...prev, selectedFiber]);
        }
        setSelectedFiber(fiber);
      }
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
          {fiber && (
            <FiberGraph
              key={getFiberId(fiber)}
              fiber={fiber}
              onFiberSelect={handleFiberSelect}
              isDialogMode={isDialogMode}
            />
          )}
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

export default Inspector;
