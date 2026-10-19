import { useEffect, useRef } from "react";
import { Code } from "@/components/ui/code";
import { getSourceLine } from "../lib/diagram";
import type { ViewComponent, ViewFile } from "../model";
import { useHoverStore, useIsInactive } from "../store/hover";
import { useLoadedView } from "./context";
import { DecisionTree } from "./decision-tree";

const CodeLine = ({ text }: { text: string }) => (
  <Code className="wrap-anywhere whitespace-pre-wrap">{text}</Code>
);

const ComponentDiagram = ({ view, component }: { view: ViewFile; component: ViewComponent }) => {
  const activate = useHoverStore((state) => state.activate);
  const isInactive = useIsInactive(`${component.name}/`);
  if (!component.loc) return null;
  const { start, end } = component.loc;
  return (
    <section
      data-component={component.name}
      className="grid gap-1.5 transition-opacity duration-150"
      style={{ opacity: isInactive ? 0.45 : 1 }}
      onMouseEnter={() => activate(component.name)}
    >
      <CodeLine text={getSourceLine(view, start.line)} />
      <div className="ml-3 grid gap-2 border-l pl-4">
        {component.regions.map((region, index) => (
          <div key={region.placeNames.join(",") || index} className="grid gap-2">
            {component.regions.length > 1 && (
              <span className="text-muted-foreground">
                States of {region.placeNames.join(", ")}
              </span>
            )}
            <DecisionTree component={component} region={region} />
          </div>
        ))}
      </div>
      {end.line !== start.line && <CodeLine text={getSourceLine(view, end.line)} />}
    </section>
  );
};

export const DiagramPane = () => {
  const view = useLoadedView();
  const paneRef = useRef<HTMLDivElement>(null);
  const focusRequest = useHoverStore((state) => state.focusRequest);
  useEffect(() => {
    if (focusRequest === null) return;
    paneRef.current
      ?.querySelector(`[data-component="${CSS.escape(focusRequest.name)}"]`)
      ?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [focusRequest]);
  return (
    <div
      ref={paneRef}
      className="h-full overflow-y-auto overflow-x-hidden overscroll-none [scrollbar-gutter:stable]"
    >
      <div className="grid gap-6 px-4 py-3 sm:px-5">
        {view.components.map((component) => (
          <ComponentDiagram key={component.name} view={view} component={component} />
        ))}
      </div>
    </div>
  );
};
