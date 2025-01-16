import React, {
  useState,
  useEffect,
  useRef,
  startTransition,
  useTransition,
  useCallback,
  useDeferredValue,
  memo,
  useMemo,
} from 'react';
import ReactDOM from 'react-dom';
import { Inspector as ReactInspector, ObjectLabel } from 'react-inspector';
import {
  getDisplayName,
  instrument,
  isCompositeFiber,
  isHostFiber,
  traverseRenderedFibers,
  type Fiber,
} from './core.js';
import * as d3 from 'd3';

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

interface TreeNode {
  id: string;
  label: string;
  isHost: boolean;
  isRoot: boolean;
  depth: number;
  fiber: Fiber;
  children: TreeNode[];
}

interface Node extends d3.SimulationNodeDatum {
  id: string;
  label: string;
  isHost: boolean;
  isRoot: boolean;
  depth: number;
  fiber: Fiber;
  x?: number;
  y?: number;
}

interface Link extends d3.SimulationLinkDatum<Node> {
  source: Node;
  target: Node;
}

interface GraphDiff {
  timestamp: number;
  addedNodes: Node[];
  removedNodeIds: string[];
  addedLinks: Link[];
  removedLinks: Link[];
}

interface GraphHistory {
  baseGraph: { nodes: Node[]; links: Link[] };
  diffs: GraphDiff[];
}

const graphHistoryRef: GraphHistory = {
  baseGraph: { nodes: [], links: [] },
  diffs: [],
};

const computeDiff = (
  prev: { nodes: Node[]; links: Link[] },
  next: { nodes: Node[]; links: Link[] },
): GraphDiff => {
  const addedNodes = next.nodes.filter(
    (node) => !prev.nodes.find((n) => n.id === node.id),
  );
  const removedNodeIds = prev.nodes
    .filter((node) => !next.nodes.find((n) => n.id === node.id))
    .map((n) => n.id);

  const addedLinks = next.links.filter(
    (link) =>
      !prev.links.find(
        (l) => l.source.id === link.source.id && l.target.id === link.target.id,
      ),
  );
  const removedLinks = prev.links.filter(
    (link) =>
      !next.links.find(
        (l) => l.source.id === link.source.id && l.target.id === link.target.id,
      ),
  );

  return {
    timestamp: Date.now(),
    addedNodes,
    removedNodeIds,
    addedLinks,
    removedLinks,
  };
};

const applyDiffs = (
  baseGraph: { nodes: Node[]; links: Link[] },
  diffs: GraphDiff[],
  upToTimestamp: number,
) => {
  const result = {
    nodes: [...baseGraph.nodes],
    links: [...baseGraph.links],
  };

  for (const diff of diffs) {
    if (diff.timestamp > upToTimestamp) break;

    // Apply node changes
    result.nodes = result.nodes.filter(
      (node) => !diff.removedNodeIds.includes(node.id),
    );
    result.nodes.push(...diff.addedNodes);

    // Apply link changes
    result.links = result.links.filter(
      (link) =>
        !diff.removedLinks.find(
          (l) =>
            l.source.id === link.source.id && l.target.id === link.target.id,
        ),
    );
    result.links.push(...diff.addedLinks);
  }

  return result;
};

let setGraphDataRef: React.Dispatch<
  React.SetStateAction<{ nodes: Node[]; links: Link[] }>
> | null = null;

const getNodeLabel = (fiber: Fiber): string => {
  // HostComponent (div, span, etc)
  if (isHostFiber(fiber))
    return typeof fiber.type === 'string' ? fiber.type : '';

  // ClassComponent or FunctionComponent
  if (isCompositeFiber(fiber)) {
    return getDisplayName(fiber) ?? '';
  }

  return '';
};

const buildTree = (fiber: Fiber, depth = 0): TreeNode | null => {
  if (fiber.type === ReactInspector || fiber.type === Inspector) {
    return null;
  }

  const node: TreeNode = {
    id: Math.random().toString(),
    label: getNodeLabel(fiber),
    isHost: isHostFiber(fiber),
    isRoot: !fiber.return,
    depth,
    fiber,
    children: [],
  };

  if (fiber.child) {
    const child = buildTree(fiber.child, depth + 1);
    if (child) {
      node.children.push(child);
    }
    let sibling = fiber.child.sibling;
    while (sibling) {
      const siblingNode = buildTree(sibling, depth + 1);
      if (siblingNode) {
        node.children.push(siblingNode);
      }
      sibling = sibling.sibling;
    }
  }

  return node;
};

const treeToGraph = (tree: TreeNode) => {
  const nodes: Node[] = [];
  const links: Link[] = [];

  const processNode = (node: TreeNode) => {
    const graphNode: Node = {
      id: node.id,
      label: node.label,
      isHost: node.isHost,
      isRoot: node.isRoot,
      depth: node.depth,
      fiber: node.fiber,
    };
    nodes.push(graphNode);

    for (const child of node.children) {
      const childGraphNode = processNode(child);
      links.push({ source: graphNode, target: childGraphNode });
    }

    return graphNode;
  };

  processNode(tree);
  return { nodes, links };
};

instrument({
  onCommitFiberRoot: (_, root) => {
    if (root.current && setGraphDataRef) {
      const tree = buildTree(root.current);
      if (!tree) return;
      const newGraphData = treeToGraph(tree);

      // Check if the tree has changed
      let hasChanged = false;
      traverseRenderedFibers(root.current, (fiber) => {
        if (fiber.alternate && fiber.alternate.child !== fiber.child) {
          hasChanged = true;
        }
      });

      if (!hasChanged) return;

      // Compute and store diff
      const diff = computeDiff(graphHistoryRef.baseGraph, newGraphData);
      if (diff.addedNodes.length || diff.removedNodeIds.length) {
        graphHistoryRef.diffs.push(diff);
        graphHistoryRef.baseGraph = newGraphData;

        // Keep only last 100 diffs to prevent memory issues
        if (graphHistoryRef.diffs.length > 100) {
          const newBase = applyDiffs(
            graphHistoryRef.baseGraph,
            graphHistoryRef.diffs.slice(0, 50),
            Number.POSITIVE_INFINITY,
          );
          graphHistoryRef.baseGraph = newBase;
          graphHistoryRef.diffs = graphHistoryRef.diffs.slice(50);
        }
      }

      setGraphDataRef((prev) => {
        if (prev.nodes.length !== newGraphData.nodes.length)
          return newGraphData;
        return prev;
      });
    }
  },
});

const Tooltip = memo(({ node, x, y, onClose }: { node: Node; x: number; y: number; onClose: () => void }) => {
  const tooltipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!tooltipRef.current?.contains(target) && !target.closest('.node')) {
        onClose();
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
    };
  }, [onClose]);

  return ReactDOM.createPortal(
    <div
      ref={tooltipRef}
      className="fixed bg-[#1a1a1a] border border-[#333] rounded-lg p-4 shadow-lg max-w-[400px] max-h-[400px] overflow-auto z-[10000] transition-transform duration-150 ease-out will-change-transform"
      style={{
        transform: `translate3d(${x + 10}px, ${y + 10}px, 0)`,
      }}
    >
      <ReactInspector
        data={node.fiber}
        theme={theme}
        expandLevel={1}
        table={false}
      />
    </div>,
    document.body
  );
});

const ForceGraph = memo(({ value }: { value: number }) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const gRef = useRef<SVGGElement | null>(null);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const simulationRef = useRef<d3.Simulation<Node, Link> | null>(null);
  const [dimensions, setDimensions] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });
  const [graphData, setGraphData] = useState<{ nodes: Node[]; links: Link[] }>({
    nodes: [],
    links: [],
  });
  const isInitialRender = useRef(true);
  const prevNodesLength = useRef(0);
  const [tooltipData, setTooltipData] = useState<{
    node: Node;
    x: number;
    y: number;
  } | null>(null);

  useEffect(() => {
    setGraphDataRef = setGraphData;
    return () => {
      if (simulationRef.current) {
        simulationRef.current.stop();
      }
      setGraphDataRef = null;
    };
  }, []);

  // Setup SVG and zoom only once
  useEffect(() => {
    if (!svgRef.current) return;

    const svg = d3
      .select(svgRef.current)
      .attr('width', dimensions.width)
      .attr('height', dimensions.height);

    svg.selectAll('*').remove();

    const g = svg.append('g');
    gRef.current = g.node();

    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 2])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
      });

    zoomRef.current = zoom;
    svg.call(zoom);

    // Initialize simulation with no nodes
    simulationRef.current = d3
      .forceSimulation<Node>()
      .force('charge', d3.forceManyBody().strength(-100))
      .force(
        'center',
        d3.forceCenter(dimensions.width / 2, dimensions.height / 2),
      )
      .velocityDecay(0.4)
      .alphaMin(0.001)
      .alphaDecay(0.02)
      .stop(); // Stop initially

    return () => {
      if (simulationRef.current) {
        simulationRef.current.stop();
      }
    };
  }, [dimensions.width, dimensions.height]);

  // Handle data updates
  useEffect(() => {
    if (
      !gRef.current ||
      !simulationRef.current ||
      !zoomRef.current ||
      graphData.nodes.length === 0
    )
      return;
    if (prevNodesLength.current === graphData.nodes.length) return;
    prevNodesLength.current = graphData.nodes.length;

    const g = d3.select(gRef.current);
    const simulation = simulationRef.current;
    const zoom = zoomRef.current;

    // Update forces
    simulation
      .nodes(graphData.nodes)
      .force(
        'link',
        d3
          .forceLink<Node, Link>(graphData.links)
          .id((d) => d.id)
          .distance(10),
      )
      .force('charge', d3.forceManyBody().strength(-100))
      .force('x', d3.forceX(dimensions.width / 2).strength(0.02))
      .force('y', d3.forceY(dimensions.height / 2).strength(0.02));

    // Update links
    const link = g
      .selectAll<SVGLineElement, Link>('line')
      .data(graphData.links)
      .join('line')
      .attr('stroke', '#666')
      .attr('stroke-opacity', 0.6)
      .attr('stroke-width', 1.5);

    // Update nodes with key function
    const nodeGroup = g
      .selectAll<SVGGElement, Node>('g.node')
      .data(graphData.nodes, (d) => d.id)
      .join((enter) => {
        const nodeEnter = enter
          .append('g')
          .attr('class', 'node')
          .on('mouseenter', (event, d) => {
            event.stopPropagation();
            const [x, y] = d3.pointer(event, svgRef.current);
            setTooltipData({ node: d, x, y });
          });

        nodeEnter
          .append('circle')
          .attr('r', d => Math.max(3, 8 - d.depth))
          .attr('fill', (d) => (d.isRoot ? '#ff4444' : '#fff'))
          .attr('opacity', (d) => (d.isHost ? 0.4 : 1));

        nodeEnter
          .append('text')
          .attr('x', d => Math.max(3, 8 - d.depth) + 4)
          .attr('y', 4)
          .text((d) => d.label)
          .attr('fill', (d) => (d.isRoot ? '#ff4444' : '#fff'))
          .attr('opacity', (d) => (d.isHost ? 0.4 : 1))
          .attr('font-size', d => `${Math.max(10, 14 - d.depth)}px`);

        return nodeEnter;
      });

    // Setup drag
    const drag = d3
      .drag<SVGGElement, Node>()
      .on('start', (event, d) => {
        if (!event.active) simulation.alphaTarget(0.1).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on('drag', (event, d) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on('end', (event, d) => {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      });

    nodeGroup.call(drag as unknown as d3.DragBehavior<SVGGElement, Node, Node>);

    // Clear old listeners and set new tick
    simulation.on('tick', null);
    simulation.on('tick', () => {
      link
        .attr('x1', (d) => d.source.x ?? 0)
        .attr('y1', (d) => d.source.y ?? 0)
        .attr('x2', (d) => d.target.x ?? 0)
        .attr('y2', (d) => d.target.y ?? 0);

      nodeGroup.attr('transform', (d) => `translate(${d.x ?? 0},${d.y ?? 0})`);
    });

    // Initial zoom to fit
    if (isInitialRender.current && svgRef.current) {
      const bounds = gRef.current.getBBox();
      const padding = 100;

      // Calculate available space with more room
      const availableWidth = dimensions.width - padding * 2;
      const availableHeight = dimensions.height - padding * 2;

      // Calculate scale to fit with more spread
      const scale =
        Math.min(
          availableWidth / bounds.width,
          availableHeight / bounds.height,
        ) * 0.7;

      // Center the graph
      const tx =
        (dimensions.width - bounds.width * scale) / 2 - bounds.x * scale;
      const ty =
        (dimensions.height - bounds.height * scale) / 2 - bounds.y * scale;

      const transform = d3.zoomIdentity.translate(tx, ty).scale(scale);

      d3.select(svgRef.current).call(zoom.transform, transform);
      isInitialRender.current = false;
    }

    // Start simulation with higher alpha for more movement
    simulation.alpha(0.5).restart();
  }, [graphData, dimensions.width, dimensions.height]);

  // Update graph based on slider value
  useEffect(() => {
    if (graphHistoryRef.diffs.length === 0) return;

    const timestamp =
      graphHistoryRef.diffs[
        Math.floor((value / 100) * (graphHistoryRef.diffs.length - 1))
      ]?.timestamp;

    if (timestamp) {
      const graphAtTime = applyDiffs(
        graphHistoryRef.baseGraph,
        graphHistoryRef.diffs,
        timestamp,
      );
      setGraphData(graphAtTime);
    }
  }, [value]);

  return (
    <div className="fixed inset-0 bg-[#101010] z-[1000]">
      <svg ref={svgRef} />
      {tooltipData && (
        <Tooltip
          node={tooltipData.node}
          x={tooltipData.x}
          y={tooltipData.y}
          onClose={() => setTooltipData(null)}
        />
      )}
    </div>
  );
});

const ArrowRight = () => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <title>Arrow Right</title>
      <path d="M6 9h6V5l7 7-7 7v-4H6V9z" />
    </svg>
  );
};

const ArrowLeft = () => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <title>Arrow Left</title>
      <path d="M18 15h-6v4l-7-7 7-7v4h6v6z" />
    </svg>
  );
};

export const Inspector = ({ enabled }: { enabled: boolean }) => {
  const [historyIndex, setHistoryIndex] = useState(0);
  const deferredIndex = useDeferredValue(historyIndex);
  const [isHovering, setIsHovering] = useState(false);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsVisible(false);
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, []);

  useEffect(() => {
    if (isHovering) {
      const timer = setTimeout(() => {
        setIsVisible(true);
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [isHovering]);

  if (!enabled) return null;

  const totalTrees = graphHistoryRef.diffs.length;
  const currentIndex = Math.min(historyIndex, totalTrees - 1);

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setHistoryIndex(Number(e.target.value));
  };

  const handleIncrement = () => {
    setHistoryIndex(index => Math.min(totalTrees - 1, index + 1));
  };

  const handleDecrement = () => {
    setHistoryIndex(index => Math.max(0, index - 1));
  };

  return (
    <>
      {isVisible && <ForceGraph value={currentIndex} />}
      <div
        className="fixed bottom-0 left-0 right-0 z-[9999] flex items-center gap-2.5 bg-[#101010] border-t border-[#282727] px-4 py-2"
        onMouseEnter={() => setIsHovering(true)}
        onMouseLeave={() => {
          setIsHovering(false);
          if (!isVisible) return;
        }}
      >
        <input
          type="range"
          min="0"
          max={Math.max(0, totalTrees - 1)}
          value={currentIndex}
          onChange={handleSliderChange}
          className="flex-1"
        />

        <div className="flex gap-1">
          <button
            type="button"
            onClick={handleDecrement}
            className="bg-transparent hover:bg-white/10 rounded border-none text-white cursor-pointer w-8 h-8 flex items-center justify-center text-base"
          >
            <ArrowLeft />
          </button>
          <span className="text-white min-w-[3em] text-center my-auto">
            {currentIndex + 1}/{totalTrees || 1}
          </span>
          <button
            type="button"
            onClick={handleIncrement}
            className="bg-transparent hover:bg-white/10 rounded border-none text-white cursor-pointer w-8 h-8 flex items-center justify-center text-base"
          >
            <ArrowRight />
          </button>
          <button
            type="button"
            onClick={() => setIsVisible(false)}
            className="bg-transparent hover:bg-white/10 rounded border-none text-white cursor-pointer w-8 h-8 flex items-center justify-center text-base ml-2"
          >
            ×
          </button>
        </div>
      </div>
    </>
  );
};

export default Inspector;
