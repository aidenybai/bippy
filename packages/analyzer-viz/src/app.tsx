import { useEffect, useMemo, useState } from "react";
import { AnalysisPane } from "./analysis-pane";
import { CodePane } from "./code-pane";
import { getColorByNodeId } from "./mapping";
import type { ViewComponent } from "./model";

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

const Toolbar = ({ component }: { component: ViewComponent }) => (
  <div className="grid h-8 grid-cols-[minmax(0,1fr)_420px] items-center border-b px-3 text-xs">
    <div className="flex items-center gap-2">
      <span className="font-semibold">{component.name}</span>
      <span className="text-muted-foreground">
        {component.file.split("/").slice(-2).join("/")}
      </span>
    </div>
    <span className="text-muted-foreground">
      {component.states.length} states · {component.handlers.length} handlers
    </span>
  </div>
);

export const App = () => {
  const { component, error } = useComponent();
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const colorByNodeId = useMemo(
    () => (component ? getColorByNodeId(component) : new Map<string, string>()),
    [component],
  );

  if (error) return <pre className="p-4 text-sm text-destructive">{error}</pre>;
  if (!component) return <p className="p-4 text-sm text-muted-foreground">Analyzing…</p>;

  const hoveredNode = component.graph.nodes.find((node) => node.id === hoveredNodeId);

  return (
    <div className="grid h-screen grid-rows-[auto_minmax(0,1fr)_auto]">
      <Toolbar component={component} />
      <div className="grid grid-cols-[minmax(0,1fr)_420px] overflow-hidden">
        <div className="overflow-auto border-r">
          <CodePane
            component={component}
            colorByNodeId={colorByNodeId}
            hoveredNodeId={hoveredNodeId}
            onHover={setHoveredNodeId}
          />
        </div>
        <div className="overflow-auto py-1">
          <AnalysisPane
            component={component}
            colorByNodeId={colorByNodeId}
            hoveredNodeId={hoveredNodeId}
            onHover={setHoveredNodeId}
          />
        </div>
      </div>
      <div className="grid h-8 grid-cols-[minmax(0,1fr)_420px] items-center border-t px-3 text-xs text-muted-foreground">
        <span>
          {hoveredNode
            ? `Line ${hoveredNode.loc.start.line}, Offset ${hoveredNode.loc.start.column}`
            : `${component.source.split("\n").length} lines`}
        </span>
        <span>{hoveredNode ? hoveredNode.label : ""}</span>
      </div>
    </div>
  );
};
