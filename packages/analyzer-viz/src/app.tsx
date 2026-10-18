import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AnalysisPane } from "./analysis-pane";
import { CodePane } from "./code-pane";
import { getAnalysisLines, getColorForLine, getSolidColor } from "./mapping";
import type { ViewComponent } from "./model";

const MARGIN = 64;

const getQuery = (): URLSearchParams => new URLSearchParams(window.location.search);

const getAnalysisUrl = (): string => {
  const url = new URL("/api/analysis", window.location.origin);
  for (const key of ["tsconfig", "file", "component"]) {
    const value = getQuery().get(key);
    if (value) url.searchParams.set(key, value);
  }
  return url.toString();
};

const useComponent = (): { component: ViewComponent | null; error: string | null } => {
  const [component, setComponent] = useState<ViewComponent | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetch(getAnalysisUrl())
      .then(async (response) => {
        if (!response.ok) throw new Error(await response.text());
        return (await response.json()) as ViewComponent | null;
      })
      .then((result) => (result ? setComponent(result) : setError("Component not found")))
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, []);
  return { component, error };
};

const getColorByNodeId = (component: ViewComponent): Map<string, string> => {
  const colors = new Map<string, string>();
  for (const line of getAnalysisLines(component))
    for (const segment of line.segments) {
      const nodeIds = segment.nodeId ? (line.armNodeIds?.length ? line.armNodeIds : [segment.nodeId]) : [];
      for (const nodeId of nodeIds) {
        const node = component.graph.nodes.find((candidate) => candidate.id === nodeId);
        if (node) colors.set(nodeId, getColorForLine(node.loc.start.line));
      }
    }
  return colors;
};

interface Arrow {
  nodeId: string;
  color: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

const getArrowPath = ({ x1, y1, x2, y2 }: Arrow): string =>
  `M ${x1} ${y1} C ${(x1 + 2 * x2) / 3 + MARGIN / 2} ${y1}, ${(x1 * 2 + x2) / 3 - MARGIN / 2} ${y2}, ${x2} ${y2}`;

const collectArrows = (main: HTMLElement, colorByNodeId: Map<string, string>): Arrow[] => {
  const origin = main.getBoundingClientRect();
  const leftRects = new Map<string, DOMRect>();
  for (const element of main.querySelectorAll<SVGRectElement>("[data-node]"))
    leftRects.set(element.dataset.node ?? "", element.getBoundingClientRect());
  const arrows: Arrow[] = [];
  for (const element of main.querySelectorAll<HTMLElement>("[data-seg]")) {
    const right = element.getBoundingClientRect();
    for (const nodeId of (element.dataset.seg ?? "").split(" ")) {
      const left = leftRects.get(nodeId);
      if (!left) continue;
      arrows.push({
        nodeId,
        color: colorByNodeId.get(nodeId) ?? "rgba(0,0,0,0.3)",
        x1: left.right - origin.left + 2,
        y1: left.top + left.height / 2 - origin.top,
        x2: right.left - origin.left - 6,
        y2: right.top + right.height / 2 - origin.top,
      });
    }
  }
  return arrows;
};

const Toolbar = ({ component }: { component: ViewComponent }) => (
  <div className="grid h-8 grid-cols-2 items-center border-b px-3 text-xs">
    <div className="flex items-center gap-2">
      <span className="font-semibold">Source</span>
      <span className="text-muted-foreground">{component.file.split("/").slice(-2).join("/")}</span>
    </div>
    <div className="flex items-center gap-2">
      <span className="font-semibold">Analysis</span>
      <span className="text-muted-foreground">
        {component.name} · {component.states.length} states · {component.handlers.length} handlers
      </span>
    </div>
  </div>
);

export const App = () => {
  const { component, error } = useComponent();
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [arrows, setArrows] = useState<Arrow[]>([]);
  const [tick, setTick] = useState(0);
  const mainRef = useRef<HTMLDivElement>(null);
  const colorByNodeId = useMemo(
    () => (component ? getColorByNodeId(component) : new Map<string, string>()),
    [component],
  );
  const bump = useCallback(() => setTick((value) => value + 1), []);

  useLayoutEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    setArrows(collectArrows(main, colorByNodeId));
  }, [tick, colorByNodeId, component]);

  useEffect(() => {
    window.addEventListener("resize", bump);
    return () => window.removeEventListener("resize", bump);
  }, [bump]);

  if (error) return <pre className="p-4 text-sm text-destructive">{error}</pre>;
  if (!component) return <p className="p-4 text-sm text-muted-foreground">Analyzing…</p>;

  const hoveredNode = component.graph.nodes.find((node) => node.id === hoveredNodeId);
  const visibleArrows = hoveredNodeId
    ? arrows.filter((arrow) => arrow.nodeId === hoveredNodeId)
    : arrows;

  return (
    <div className="grid h-screen grid-rows-[auto_minmax(0,1fr)_auto]">
      <Toolbar component={component} />
      <div ref={mainRef} className="relative grid grid-cols-2 overflow-hidden">
        <div className="overflow-auto border-r" onScroll={bump}>
          <CodePane
            component={component}
            colorByNodeId={colorByNodeId}
            hoveredNodeId={hoveredNodeId}
            onHover={setHoveredNodeId}
            onMeasure={bump}
          />
        </div>
        <div className="overflow-auto py-1" onScroll={bump}>
          <AnalysisPane
            component={component}
            colorByNodeId={colorByNodeId}
            hoveredNodeId={hoveredNodeId}
            onHover={setHoveredNodeId}
          />
        </div>
        <svg className="pointer-events-none absolute inset-0 h-full w-full">
          <defs>
            <marker
              id="head"
              viewBox="0 0 10 10"
              refX="10"
              refY="5"
              markerWidth="8"
              markerHeight="8"
              orient="auto"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
            </marker>
          </defs>
          {visibleArrows.map((arrow, index) => (
            <path
              key={`${arrow.nodeId}-${index}`}
              d={getArrowPath(arrow)}
              fill="none"
              stroke={hoveredNodeId ? "var(--foreground)" : getSolidColor(arrow.color)}
              strokeWidth={hoveredNodeId ? 2 : 1}
              opacity={hoveredNodeId ? 1 : 0.55}
              markerEnd="url(#head)"
            />
          ))}
        </svg>
      </div>
      <div className="grid h-8 grid-cols-2 items-center border-t px-3 text-xs text-muted-foreground">
        <span>
          {hoveredNode
            ? `Line ${hoveredNode.loc.start.line}, Offset ${hoveredNode.loc.start.column}`
            : `${component.source.split("\n").length} lines`}
        </span>
        <span>{hoveredNode ? hoveredNode.label : `${arrows.length} mappings`}</span>
      </div>
    </div>
  );
};
