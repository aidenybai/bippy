import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { CodeView } from "./code-view";
import type { ViewComponent, ViewState } from "./model";

const getAnalysisUrl = (): string => {
  const url = new URL("/api/analysis", window.location.origin);
  for (const key of ["tsconfig", "component", "file"]) {
    const value = new URLSearchParams(window.location.search).get(key);
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
      .then((result) => {
        if (!result) setError("Component not found");
        else setComponent(result);
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, []);
  return { component, error };
};

interface StateListProps {
  component: ViewComponent;
  selected: ViewState | null;
  onSelect: (state: ViewState | null) => void;
}

const StateList = ({ component, selected, onSelect }: StateListProps) => (
  <>
    {component.regions.map((region, regionIndex) => (
      <section key={regionIndex} className="grid gap-2">
        <h2 className="text-xs font-medium text-muted-foreground">
          {region.placeNames.join(", ") || "other"}
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
  activeHandlerId: string | null;
  onHover: (handlerId: string | null) => void;
}

const HandlerList = ({ component, activeHandlerId, onHover }: HandlerListProps) => (
  <section className="grid gap-2">
    <h2 className="text-xs font-medium text-muted-foreground">what can happen</h2>
    <div className="grid gap-3">
      {component.handlers.map((handler) => (
        <div
          key={handler.id}
          className={`grid gap-1 font-mono text-xs ${activeHandlerId && activeHandlerId !== handler.id ? "opacity-40" : ""}`}
          onMouseEnter={() => onHover(handler.id)}
          onMouseLeave={() => onHover(null)}
        >
          <div className="flex items-center gap-2">
            <Badge variant={handler.kind === "effect" ? "outline" : "default"}>
              {handler.kind === "effect" ? "effect" : "click"}
            </Badge>
            <span>{handler.label}</span>
          </div>
          {handler.updates.map((update, index) => (
            <span key={index} className="text-muted-foreground">
              ⇒ {update.text}
              {update.isAsync ? " (async)" : ""}
            </span>
          ))}
        </div>
      ))}
    </div>
  </section>
);

export const App = () => {
  const { component, error } = useComponent();
  const [selected, setSelected] = useState<ViewState | null>(null);
  const [activeHandlerId, setActiveHandlerId] = useState<string | null>(null);
  if (error) return <pre className="p-4 text-sm text-destructive">{error}</pre>;
  if (!component) return <p className="p-4 text-sm text-muted-foreground">Analyzing…</p>;
  return (
    <div className="grid h-screen grid-cols-[minmax(0,1fr)_360px]">
      <CodeView
        component={component}
        selectedState={selected}
        activeHandlerId={activeHandlerId}
        onHoverHandler={setActiveHandlerId}
      />
      <ScrollArea className="h-screen border-l">
        <aside className="grid gap-5 p-4">
          <div>
            <h1 className="text-sm font-semibold">{component.name}</h1>
            <p className="text-xs text-muted-foreground">
              {component.file.split("/").slice(-3).join("/")}
            </p>
          </div>
          <Separator />
          <StateList component={component} selected={selected} onSelect={setSelected} />
          <Separator />
          <HandlerList
            component={component}
            activeHandlerId={activeHandlerId}
            onHover={setActiveHandlerId}
          />
        </aside>
      </ScrollArea>
    </div>
  );
};
