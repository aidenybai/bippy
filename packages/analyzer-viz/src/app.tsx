import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { CodeView } from "./code-view";
import type { ViewComponent, ViewState } from "./model";

const getQuery = (): URLSearchParams => new URLSearchParams(window.location.search);

interface ComponentKey {
  name: string;
  file: string;
}

const getAnalysisUrl = (key: ComponentKey | null): string => {
  const url = new URL("/api/analysis", window.location.origin);
  const tsconfig = getQuery().get("tsconfig");
  if (tsconfig) url.searchParams.set("tsconfig", tsconfig);
  const file = key?.file ?? getQuery().get("file");
  if (file) url.searchParams.set("file", file);
  if (key) url.searchParams.set("component", key.name);
  return url.toString();
};

const useComponent = (
  key: ComponentKey | null,
): { component: ViewComponent | null; error: string | null } => {
  const [component, setComponent] = useState<ViewComponent | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let isCurrent = true;
    fetch(getAnalysisUrl(key))
      .then(async (response) => {
        if (!response.ok) throw new Error(await response.text());
        return (await response.json()) as ViewComponent | null;
      })
      .then((result) => {
        if (!isCurrent) return;
        if (!result) setError("Component not found");
        else setComponent(result);
      })
      .catch((cause: unknown) => {
        if (isCurrent) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      isCurrent = false;
    };
  }, [key?.name, key?.file]);
  return { component, error };
};

const getShortFile = (file: string): string => file.split("/").slice(-2).join("/");

interface StateListProps {
  component: ViewComponent;
  selected: ViewState | null;
  onSelect: (state: ViewState | null) => void;
  onPreview: (state: ViewState | null) => void;
}

const StateList = ({ component, selected, onSelect, onPreview }: StateListProps) => (
  <>
    {component.regions.map((region, regionIndex) => (
      <section key={regionIndex} className="grid gap-2">
        <h2 className="text-xs font-medium text-muted-foreground">
          states of {region.placeNames.join(", ") || "other"}
        </h2>
        <div className="grid gap-1">
          {region.states.map((stateIndex) => {
            const state = component.states[stateIndex];
            if (!state) return null;
            const isSelected = selected?.index === stateIndex;
            return (
              <Button
                key={stateIndex}
                variant={isSelected ? "secondary" : "ghost"}
                className="h-auto justify-start py-1.5 text-left font-mono text-xs whitespace-normal"
                onClick={() => onSelect(isSelected ? null : state)}
                onMouseEnter={() => onPreview(state)}
                onMouseLeave={() => onPreview(null)}
              >
                <span className="text-muted-foreground">S{stateIndex + 1}</span>
                <span>{state.label}</span>
                {region.firstRenderState === stateIndex && (
                  <Badge variant="outline" className="ml-auto">
                    first render
                  </Badge>
                )}
              </Button>
            );
          })}
          {region.isTruncated && (
            <p className="text-xs text-muted-foreground">… more states not listed</p>
          )}
        </div>
      </section>
    ))}
  </>
);

interface HandlerListProps {
  component: ViewComponent;
  hoveredNodeId: string | null;
  onHover: (nodeId: string | null) => void;
}

const HandlerList = ({ component, hoveredNodeId, onHover }: HandlerListProps) => (
  <section className="grid gap-2">
    <h2 className="text-xs font-medium text-muted-foreground">what can happen</h2>
    <div className="grid gap-2">
      {component.handlers.map((handler) => {
        const nodeId = `${component.name}/handler:${handler.id}`;
        return (
          <div
            key={handler.id}
            className={`grid gap-0.5 font-mono text-xs ${hoveredNodeId && hoveredNodeId !== nodeId ? "opacity-40" : ""}`}
            onMouseEnter={() => onHover(nodeId)}
            onMouseLeave={() => onHover(null)}
          >
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">
                {handler.kind === "effect" ? "effect" : "event"}
              </span>
              <span>{handler.label}</span>
            </div>
            {handler.updates.map((update, index) => (
              <span key={index} className="text-muted-foreground">
                sets {update.text}
                {update.isAsync ? " (async)" : ""}
              </span>
            ))}
          </div>
        );
      })}
    </div>
  </section>
);

export const App = () => {
  const [componentKey, setComponentKey] = useState<ComponentKey | null>(() => {
    const name = getQuery().get("component");
    return name ? { name, file: getQuery().get("file") ?? "" } : null;
  });
  const { component, error } = useComponent(componentKey);
  const [selected, setSelected] = useState<ViewState | null>(null);
  const [previewed, setPreviewed] = useState<ViewState | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);

  if (error) return <pre className="p-4 text-sm text-destructive">{error}</pre>;
  if (!component) return <p className="p-4 text-sm text-muted-foreground">Analyzing…</p>;
  return (
    <div className="grid h-screen grid-cols-[minmax(0,1fr)_380px]">
      <CodeView
        component={component}
        selectedState={previewed ?? selected}
        hoveredNodeId={hoveredNodeId}
        onHoverNode={setHoveredNodeId}
      />
      <ScrollArea className="h-screen border-l">
        <aside className="grid gap-5 p-4">
          <div>
            <h1 className="text-sm font-semibold">{component.name}</h1>
            <p className="text-xs text-muted-foreground">{getShortFile(component.file)}</p>
          </div>
          <Separator />
          <StateList
            component={component}
            selected={selected}
            onSelect={setSelected}
            onPreview={setPreviewed}
          />
          <Separator />
          <HandlerList
            component={component}
            hoveredNodeId={hoveredNodeId}
            onHover={setHoveredNodeId}
          />
        </aside>
      </ScrollArea>
    </div>
  );
};
