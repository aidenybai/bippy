'use client';

import { useState, useEffect, useCallback, useRef, type JSX } from 'react';
import { codeToHtml } from 'shiki';

interface FiberNode {
  id: string;
  name: string;
  type: 'root' | 'composite' | 'host' | 'text';
  child?: FiberNode;
  sibling?: FiberNode;
}

const createTree = (count: number): FiberNode => ({
  id: 'fiberroot',
  name: 'FiberRootNode',
  type: 'root',
  child: {
    id: 'hostroot',
    name: 'HostRoot',
    type: 'root',
    child: {
      id: 'counter',
      name: 'Counter()',
      type: 'composite',
      child: {
        id: 'button',
        name: '<button/>',
        type: 'host',
        child: {
          id: 'text1',
          name: '"Pressed "',
          type: 'text',
          sibling: {
            id: 'count',
            name: `"${count}"`,
            type: 'text',
            sibling: {
              id: 'text2',
              name: '" times"',
              type: 'text',
            },
          },
        },
      },
    },
  },
});

const NODE_WIDTH = 80;
const NODE_HEIGHT = 24;
const HORIZONTAL_GAP = 60;
const VERTICAL_GAP = 28;

type Phase = 'idle' | 'schedule' | 'render' | 'commit' | 'done';

interface AnimationStep {
  phase: Phase;
  currentNodeId: string | null;
  visitedNodeIds: string[];
  updatedNodeIds: string[];
}

const getTraversalOrder = (node: FiberNode): string[] => {
  const order: string[] = [node.id];
  if (node.child) {
    order.push(...getTraversalOrder(node.child));
  }
  if (node.sibling) {
    order.push(...getTraversalOrder(node.sibling));
  }
  return order;
};

const UPDATED_NODE_IDS = ['counter', 'button', 'count'];

const generateSteps = (count: number): AnimationStep[] => {
  const tree = createTree(count);
  const traversalOrder = getTraversalOrder(tree);
  const steps: AnimationStep[] = [];

  steps.push({
    phase: 'idle',
    currentNodeId: null,
    visitedNodeIds: [],
    updatedNodeIds: [],
  });

  steps.push({
    phase: 'schedule',
    currentNodeId: null,
    visitedNodeIds: [],
    updatedNodeIds: [],
  });

  steps.push({
    phase: 'render',
    currentNodeId: null,
    visitedNodeIds: [],
    updatedNodeIds: [],
  });

  let visitedSoFar: string[] = [];
  let updatedSoFar: string[] = [];

  for (const nodeId of traversalOrder) {
    visitedSoFar = [...visitedSoFar, nodeId];
    if (UPDATED_NODE_IDS.includes(nodeId)) {
      updatedSoFar = [...updatedSoFar, nodeId];
    }

    steps.push({
      phase: 'render',
      currentNodeId: nodeId,
      visitedNodeIds: [...visitedSoFar],
      updatedNodeIds: [...updatedSoFar],
    });
  }

  steps.push({
    phase: 'commit',
    currentNodeId: null,
    visitedNodeIds: [...visitedSoFar],
    updatedNodeIds: [...updatedSoFar],
  });

  steps.push({
    phase: 'done',
    currentNodeId: null,
    visitedNodeIds: [],
    updatedNodeIds: [...updatedSoFar],
  });

  return steps;
};

interface NodePosition {
  node: FiberNode;
  x: number;
  y: number;
  childPositions: NodePosition[];
  siblingPosition?: NodePosition;
}

const calculatePositions = (
  node: FiberNode,
  x: number,
  y: number,
): NodePosition => {
  const childPositions: NodePosition[] = [];
  let siblingPosition: NodePosition | undefined;

  if (node.child) {
    childPositions.push(
      calculatePositions(node.child, x, y + NODE_HEIGHT + VERTICAL_GAP),
    );
  }

  if (node.sibling) {
    siblingPosition = calculatePositions(
      node.sibling,
      x + NODE_WIDTH + HORIZONTAL_GAP,
      y,
    );
  }

  return { node, x, y, childPositions, siblingPosition };
};

const getAllPositions = (pos: NodePosition): NodePosition[] => {
  const positions: NodePosition[] = [pos];
  for (const childPos of pos.childPositions) {
    positions.push(...getAllPositions(childPos));
  }
  if (pos.siblingPosition) {
    positions.push(...getAllPositions(pos.siblingPosition));
  }
  return positions;
};

const FiberNodeComponent = ({
  node,
  x,
  y,
  status,
  onHover,
  isGhost = false,
}: {
  node: FiberNode;
  x: number;
  y: number;
  status: 'idle' | 'current' | 'visited' | 'updated';
  onHover: (node: FiberNode | null, x: number, y: number) => void;
  isGhost?: boolean;
}) => {
  const isActive = status !== 'idle';
  const isCurrent = status === 'current';

  if (isGhost) {
    return (
      <g opacity={0.2}>
        <rect
          x={x}
          y={y}
          width={NODE_WIDTH}
          height={NODE_HEIGHT}
          fill="transparent"
          stroke="#585858"
          strokeWidth={1}
          strokeDasharray="4 2"
        />
      </g>
    );
  }

  return (
    <g
      onMouseEnter={(e) => {
        const rect = (e.target as SVGElement).getBoundingClientRect();
        onHover(node, rect.left, rect.top);
      }}
      onMouseLeave={() => onHover(null, 0, 0)}
      style={{ cursor: 'pointer', transition: 'opacity 0.2s ease, transform 0.2s ease' }}
    >
      <rect
        x={x}
        y={y}
        width={NODE_WIDTH}
        height={NODE_HEIGHT}
        fill={isCurrent ? '#f5be93' : isActive ? '#ffffff' : '#585858'}
        stroke={isCurrent ? '#f5be93' : '#585858'}
        strokeWidth={1}
        style={{ transition: 'all 0.2s ease' }}
      />
      <text
        x={x + NODE_WIDTH / 2}
        y={y + NODE_HEIGHT / 2 + 3}
        textAnchor="middle"
        fontSize={10}
        fontFamily="ui-monospace, monospace"
        fill={isActive ? '#585858' : '#9f9f9f'}
        style={{ pointerEvents: 'none', transition: 'fill 0.2s ease' }}
      >
        {node.name.length > 10 ? `${node.name.slice(0, 9)}…` : node.name}
      </text>
    </g>
  );
};

const Arrow = ({
  x1,
  y1,
  x2,
  y2,
  isVertical,
  opacity,
  label,
}: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  isVertical: boolean;
  opacity: number;
  label?: string;
}) => {
  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;

  return (
    <g opacity={opacity} style={{ transition: 'opacity 0.2s ease' }}>
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#585858" strokeWidth={1} />
      <polygon
        points={
          isVertical
            ? `${x2 - 3},${y2 - 4} ${x2 + 3},${y2 - 4} ${x2},${y2}`
            : `${x2 - 4},${y2 - 3} ${x2 - 4},${y2 + 3} ${x2},${y2}`
        }
        fill="#585858"
      />
      {label && (
        <text
          x={isVertical ? midX + 6 : midX}
          y={isVertical ? midY + 4 : midY - 6}
          fontSize={11}
          fill="#9f9f9f"
          textAnchor={isVertical ? 'start' : 'middle'}
        >
          {label}
        </text>
      )}
    </g>
  );
};

const PlayIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <path d="M8 5v14l11-7z" />
  </svg>
);

const PauseIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
  </svg>
);

const StepBackIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <path d="M6 6h2v12H6V6zm3.5 6l8.5 6V6l-8.5 6z" />
  </svg>
);

const StepForwardIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <path d="M18 6h-2v12h2V6zM6 18l8.5-6L6 6v12z" />
  </svg>
);

const ResetIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z" />
  </svg>
);

const getFiberPreview = (node: FiberNode, count: number): string => {
  switch (node.id) {
    case 'fiberroot':
      return `{
  tag: HostRoot,
  current: Fiber,
  containerInfo: <div id="root">
}`;
    case 'hostroot':
      return `{
  tag: HostRoot,
  stateNode: FiberRootNode,
  child: Counter
}`;
    case 'counter':
      return `{
  tag: FunctionComponent,
  type: Counter,
  memoizedState: { // useState
    baseState: ${count},
    queue: { pending: null }
  },
  child: <button/>
}`;
    case 'button':
      return `{
  tag: HostComponent,
  type: "button",
  stateNode: <button/>,
  memoizedProps: {
    onClick: () => setCount(${count} + 1),
    children: ["Pressed ", "${count}", " times"]
  }
}`;
    case 'text1':
      return `{
  tag: HostText,
  stateNode: Text,
  memoizedProps: "Pressed "
}`;
    case 'count':
      return `{
  tag: HostText,
  stateNode: Text,
  memoizedProps: "${count}"
}`;
    case 'text2':
      return `{
  tag: HostText,
  stateNode: Text,
  memoizedProps: " times"
}`;
    default:
      return `{ name: "${node.name}" }`;
  }
};

export const FiberTree = () => {
  const [count, setCount] = useState(0);
  const [displayCount, setDisplayCount] = useState(0);
  const [stepIndex, setStepIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isFlashing, setIsFlashing] = useState(false);
  const [hoveredNode, setHoveredNode] = useState<{
    node: FiberNode;
    x: number;
    y: number;
  } | null>(null);
  const [highlightedHtml, setHighlightedHtml] = useState<string>('');
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!hoveredNode) return;

    let isCancelled = false;
    const code = getFiberPreview(hoveredNode.node, count);
    codeToHtml(code, { lang: 'javascript', theme: 'vesper' }).then((html) => {
      if (!isCancelled) {
        setHighlightedHtml(
          html.replace(
            /background-color:#[0-9a-fA-F]+/g,
            'background-color:transparent',
          ),
        );
      }
    });

    return () => {
      isCancelled = true;
    };
  }, [hoveredNode, count]);

  const steps = generateSteps(count);
  const currentStep = steps[stepIndex];

  useEffect(() => {
    if (currentStep.phase === 'done' && displayCount !== count) {
      const updateTimer = setTimeout(() => {
        setDisplayCount(count);
        setIsFlashing(true);
      }, 0);
      const flashTimer = setTimeout(() => setIsFlashing(false), 300);
      return () => {
        clearTimeout(updateTimer);
        clearTimeout(flashTimer);
      };
    }
  }, [currentStep.phase, count, displayCount]);

  const currentTree = createTree(displayCount);
  const wipTree = createTree(count);

  const currentPosition = calculatePositions(currentTree, 0, 0);
  const wipPosition = calculatePositions(wipTree, 0, 0);
  const allPositions = getAllPositions(currentPosition);

  const maxX = Math.max(...allPositions.map((p) => p.x)) + NODE_WIDTH + 16;
  const maxY = Math.max(...allPositions.map((p) => p.y)) + NODE_HEIGHT + 16;

  const showWipTree =
    currentStep.phase === 'render' ||
    (currentStep.phase === 'commit' && stepIndex < steps.length - 1);

  useEffect(() => {
    if (!isPlaying) return;

    const timer = setTimeout(
      () => {
        if (stepIndex < steps.length - 1) {
          setStepIndex((prev) => prev + 1);
        } else {
          setIsPlaying(false);
        }
      },
      currentStep.phase === 'schedule'
        ? 800
        : currentStep.phase === 'commit'
          ? 600
          : 400,
    );

    return () => clearTimeout(timer);
  }, [isPlaying, stepIndex, steps.length, currentStep.phase]);

  const handlePlay = () => {
    if (stepIndex >= steps.length - 1) {
      setStepIndex(0);
    }
    setIsPlaying(true);
  };

  const handlePause = () => setIsPlaying(false);

  const handleStepBack = () => {
    setIsPlaying(false);
    setStepIndex((prev) => Math.max(0, prev - 1));
  };

  const handleStepForward = () => {
    setIsPlaying(false);
    if (stepIndex < steps.length - 1) {
      setStepIndex((prev) => prev + 1);
    } else {
      setCount((prev) => prev + 1);
      setStepIndex(0);
    }
  };

  const handleReset = () => {
    setIsPlaying(false);
    setStepIndex(0);
  };

  const handleCounterClick = () => {
    setCount((prev) => prev + 1);
    setStepIndex(0);
    setIsPlaying(true);
  };

  const progressBarRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const stepsLengthRef = useRef(steps.length);

  useEffect(() => {
    stepsLengthRef.current = steps.length;
  }, [steps.length]);

  const updateProgressFromPosition = (clientX: number) => {
    const progressBar = progressBarRef.current;
    if (!progressBar) return;
    const rect = progressBar.getBoundingClientRect();
    const percent = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const newIndex = Math.round(percent * (stepsLengthRef.current - 1));
    setStepIndex(newIndex);
  };

  const handleProgressMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    isDraggingRef.current = true;
    setIsPlaying(false);
    updateProgressFromPosition(e.clientX);
  };

  const handleProgressTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    isDraggingRef.current = true;
    setIsPlaying(false);
    updateProgressFromPosition(e.touches[0].clientX);
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;
      e.preventDefault();
      updateProgressFromPosition(e.clientX);
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!isDraggingRef.current) return;
      updateProgressFromPosition(e.touches[0].clientX);
    };

    const handlePointerUp = () => {
      isDraggingRef.current = false;
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handlePointerUp);
    document.addEventListener('touchmove', handleTouchMove, { passive: true });
    document.addEventListener('touchend', handlePointerUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handlePointerUp);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handlePointerUp);
    };
  }, []);

  const handleNodeHover = useCallback(
    (node: FiberNode | null, x: number, y: number) => {
      if (node) {
        setHoveredNode({ node, x, y });
      } else {
        setHoveredNode(null);
      }
    },
    [],
  );

  const getNodeStatus = (
    nodeId: string,
  ): 'idle' | 'current' | 'visited' | 'updated' => {
    if (currentStep.currentNodeId === nodeId) return 'current';
    if (
      currentStep.phase === 'done' &&
      currentStep.updatedNodeIds.includes(nodeId)
    )
      return 'updated';
    if (currentStep.updatedNodeIds.includes(nodeId)) return 'updated';
    if (currentStep.visitedNodeIds.includes(nodeId)) return 'visited';
    return 'idle';
  };

  const renderTree = (
    pos: NodePosition,
    isWip: boolean,
    wipTreeData?: FiberNode,
    showGhosts = false,
  ): JSX.Element[] => {
    const elements: JSX.Element[] = [];
    const nodeStatus = getNodeStatus(pos.node.id);
    const isNodeVisible =
      !isWip || !showGhosts || currentStep.visitedNodeIds.includes(pos.node.id);
    const isGhost =
      isWip && showGhosts && !currentStep.visitedNodeIds.includes(pos.node.id);

    if (pos.childPositions.length > 0) {
      for (const childPos of pos.childPositions) {
        const childVisible =
          !isWip ||
          !showGhosts ||
          currentStep.visitedNodeIds.includes(childPos.node.id);
        elements.push(
          <Arrow
            key={`${pos.node.id}-child-${childPos.node.id}-${isWip ? 'wip' : 'current'}`}
            x1={pos.x + NODE_WIDTH / 2}
            y1={pos.y + NODE_HEIGHT}
            x2={childPos.x + NODE_WIDTH / 2}
            y2={childPos.y}
            isVertical={true}
            opacity={
              isWip && showGhosts && (!isNodeVisible || !childVisible)
                ? 0.15
                : 1
            }
            label="child"
          />,
        );
        elements.push(...renderTree(childPos, isWip, wipTreeData, showGhosts));
      }
    }

    if (pos.siblingPosition) {
      const siblingVisible =
        !isWip ||
        !showGhosts ||
        currentStep.visitedNodeIds.includes(pos.siblingPosition.node.id);
      elements.push(
        <Arrow
          key={`${pos.node.id}-sibling-${pos.siblingPosition.node.id}-${isWip ? 'wip' : 'current'}`}
          x1={pos.x + NODE_WIDTH}
          y1={pos.y + NODE_HEIGHT / 2}
          x2={pos.siblingPosition.x}
          y2={pos.siblingPosition.y + NODE_HEIGHT / 2}
          isVertical={false}
          opacity={
            isWip && showGhosts && (!isNodeVisible || !siblingVisible)
              ? 0.15
              : 1
          }
          label="sibling"
        />,
      );
      elements.push(
        ...renderTree(pos.siblingPosition, isWip, wipTreeData, showGhosts),
      );
    }

    const nodeToRender =
      isWip && wipTreeData ? findNode(wipTreeData, pos.node.id) : pos.node;

    elements.push(
      <FiberNodeComponent
        key={`${pos.node.id}-${isWip ? 'wip' : 'current'}`}
        node={nodeToRender || pos.node}
        x={pos.x}
        y={pos.y}
        status={isWip ? nodeStatus : 'idle'}
        onHover={handleNodeHover}
        isGhost={isGhost}
      />,
    );

    return elements;
  };

  const findNode = (tree: FiberNode, id: string): FiberNode | null => {
    if (tree.id === id) return tree;
    if (tree.child) {
      const found = findNode(tree.child, id);
      if (found) return found;
    }
    if (tree.sibling) {
      const found = findNode(tree.sibling, id);
      if (found) return found;
    }
    return null;
  };

  return (
    <div ref={containerRef} className="flex flex-col gap-2 w-full">
      <button
        type="button"
        onClick={handleCounterClick}
        disabled={isPlaying}
        className="w-full  bg-white text-[#111] px-2 py-3 text-sm font-mono disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Pressed{' '}
        <span
          className={`inline-block px-1 transition-all duration-300 ${isFlashing ? 'bg-[#f5be93]' : 'bg-[#f5be93]/20'}`}
        >
          {displayCount}
        </span>{' '}
        times
      </button>
      <div className="relative flex flex-col items-center w-full">
        <div className="flex items-center gap-2 py-1 w-full max-w-[600px]">
          <div className="flex items-center shrink-0">
            <button
              onClick={handleStepBack}
              disabled={stepIndex === 0}
              className="p-2 lg:p-1  hover:bg-[#585858] active:bg-[#585858] disabled:opacity-30 text-[#9f9f9f] hover:text-white transition-colors"
            >
              <StepBackIcon />
            </button>
            {isPlaying ? (
              <button
                onClick={handlePause}
                className="p-2 lg:p-1  hover:bg-[#585858] active:bg-[#585858] text-[#9f9f9f] hover:text-white transition-colors"
              >
                <PauseIcon />
              </button>
            ) : (
              <button
                onClick={handlePlay}
                className="p-2 lg:p-1  hover:bg-[#585858] active:bg-[#585858] text-[#9f9f9f] hover:text-white transition-colors"
              >
                <PlayIcon />
              </button>
            )}
            <button
              onClick={handleStepForward}
              className="p-2 lg:p-1  hover:bg-[#585858] active:bg-[#585858] text-[#9f9f9f] hover:text-white transition-colors"
            >
              <StepForwardIcon />
            </button>
            <button
              onClick={handleReset}
              className="p-2 lg:p-1  hover:bg-[#585858] active:bg-[#585858] text-[#9f9f9f] hover:text-white transition-colors"
            >
              <ResetIcon />
            </button>
          </div>

          <div
            ref={progressBarRef}
            className="flex-1 h-2 lg:h-1 bg-[#585858] cursor-pointer relative min-w-16 select-none touch-none"
            onMouseDown={handleProgressMouseDown}
            onTouchStart={handleProgressTouchStart}
          >
            <div
              className="h-full bg-[#9f9f9f] pointer-events-none"
              style={{ width: `${(stepIndex / (steps.length - 1)) * 100}%` }}
            />
            <div
              className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white pointer-events-none"
              style={{ left: `calc(${(stepIndex / (steps.length - 1)) * 100}% - 6px)` }}
            />
          </div>

          <span className="text-base text-[#585858] font-mono tabular-nums shrink-0">
            {stepIndex + 1}/{steps.length}
          </span>
        </div>

        <div className="overflow-x-auto lg:overflow-visible w-full pb-2 mt-4">
          <div className="pb-3 min-w-max">
            {currentStep.phase === 'commit' ? (
            (() => {
              const gapBetweenTrees = 80;
              const wipOffsetX = maxX + gapBetweenTrees;
              const totalWidth = wipOffsetX + maxX;

              return (
                <div key={`commit-${stepIndex}`} className="relative">
                  <svg width={totalWidth} height={maxY + 24} className="overflow-visible">
                    <text x={0} y={12} fontSize={14} fill="#f5be93">
                      current ← workInProgress
                    </text>
                    <g className="animate-fiber-fade-out" transform="translate(0, 24)">
                      {renderTree(currentPosition, false)}
                    </g>
                    <g
                      className="animate-fiber-merge"
                      style={{ '--merge-distance': `${wipOffsetX}px` } as React.CSSProperties}
                    >
                      <g transform="translate(0, 24)">
                        {renderTree(wipPosition, true, wipTree, false)}
                      </g>
                    </g>
                  </svg>
                </div>
              );
            })()
          ) : currentStep.phase === 'done' ? (
            (() => {
              const gapBetweenTrees = 80;
              const wipOffsetX = maxX + gapBetweenTrees;
              const totalWidth = wipOffsetX + maxX;

              return (
                <div key={`done-${stepIndex}`} className="shrink-0">
                  <svg width={totalWidth} height={maxY + 24} className="overflow-visible">
                    <text x={0} y={12} fontSize={14} fill="#9f9f9f">
                      current
                    </text>
                    <g transform="translate(0, 24)">
                      {renderTree(wipPosition, true, wipTree, false)}
                    </g>
                  </svg>
                </div>
              );
            })()
          ) : (
            <>
              {(() => {
                const gapBetweenTrees = 80;
                const wipOffsetX = maxX + gapBetweenTrees;
                const totalWidth = wipOffsetX + maxX;
                const allCurrentPos = getAllPositions(currentPosition);

                return (
                  <svg
                    width={totalWidth}
                    height={maxY + 24}
                    className="overflow-visible"
                  >
                    <text x={0} y={12} fontSize={14} fill="#585858">
                      current
                    </text>
                    <g transform="translate(0, 24)">
                      {renderTree(currentPosition, false)}
                    </g>

                    <g
                      transform={`translate(${wipOffsetX}, 0)`}
                      style={{
                        opacity: showWipTree ? 1 : 0,
                        transition: 'opacity 0.3s ease-out'
                      }}
                    >
                        <text x={0} y={12} fontSize={14} fill="#585858">
                          workInProgress
                          {currentStep.phase === 'render' &&
                            currentStep.currentNodeId && (
                              <tspan fill="#f5be93" dx={8}>
                                rendering...
                              </tspan>
                            )}
                        </text>
                        <g transform="translate(0, 24)">
                          {renderTree(wipPosition, true, wipTree, true)}
                        {currentStep.currentNodeId &&
                          currentStep.phase === 'render' &&
                          (() => {
                            const currentPos = allCurrentPos.find(
                              (p) => p.node.id === currentStep.currentNodeId,
                            );
                            if (!currentPos) return null;
                            return (
                              <g key="wip-pointer">
                                <line
                                  x1={currentPos.x - 28}
                                  y1={currentPos.y + NODE_HEIGHT / 2}
                                  x2={currentPos.x - 4}
                                  y2={currentPos.y + NODE_HEIGHT / 2}
                                  stroke="#f5be93"
                                  strokeWidth={2}
                                />
                                <polygon
                                  points={`${currentPos.x - 2},${currentPos.y + NODE_HEIGHT / 2} ${currentPos.x - 7},${currentPos.y + NODE_HEIGHT / 2 - 4} ${currentPos.x - 7},${currentPos.y + NODE_HEIGHT / 2 + 4}`}
                                  fill="#f5be93"
                                />
                                <text
                                  x={currentPos.x - 26}
                                  y={currentPos.y + NODE_HEIGHT / 2 + 4}
                                  fontSize={11}
                                  fill="#f5be93"
                                  textAnchor="end"
                                >
                                  wip
                                </text>
                              </g>
                            );
                          })()}
                        </g>
                      </g>

                    {showWipTree &&
                      currentStep.phase === 'render' &&
                      currentStep.visitedNodeIds.map((nodeId) => {
                        const sourcePos = allCurrentPos.find(
                          (p) => p.node.id === nodeId,
                        );
                        if (!sourcePos) return null;

                        const isCurrentNode =
                          nodeId === currentStep.currentNodeId;
                        const startX = sourcePos.x + NODE_WIDTH;
                        const startY = sourcePos.y + NODE_HEIGHT / 2 + 24;
                        const endX = wipOffsetX + sourcePos.x;
                        const endY = sourcePos.y + NODE_HEIGHT / 2 + 24;
                        const midX = (startX + endX) / 2;

                        return (
                          <g
                            key={`clone-arrow-${nodeId}`}
                            opacity={isCurrentNode ? 1 : 0.3}
                          >
                            <path
                              d={`M ${startX + 2} ${startY} Q ${midX} ${startY} ${endX - 6} ${endY}`}
                              fill="none"
                              stroke={isCurrentNode ? '#f5be93' : '#585858'}
                              strokeWidth={isCurrentNode ? 1.5 : 1}
                              strokeDasharray={isCurrentNode ? 'none' : '3 2'}
                            />
                            <polygon
                              points={`${endX - 2},${endY} ${endX - 7},${endY - 3} ${endX - 7},${endY + 3}`}
                              fill={isCurrentNode ? '#f5be93' : '#585858'}
                            />
                          </g>
                        );
                      })}
                  </svg>
                );
              })()}
            </>
          )}
          </div>
        </div>

        {hoveredNode && highlightedHtml && (
          <div
            className="fixed z-50  border border-[#585858]/50 bg-[#111] px-2 py-1 shadow-xl max-w-[360px]"
            style={{
              left: Math.min(hoveredNode.x + 10, window.innerWidth - 380),
              top: hoveredNode.y + 30,
            }}
          >
            <div
              className="font-mono [&_pre]:p-0 [&_pre]:m-0 [&_code]:text-xs leading-tight"
              dangerouslySetInnerHTML={{ __html: highlightedHtml }}
            />
          </div>
        )}
      </div>
    </div>
  );
};
