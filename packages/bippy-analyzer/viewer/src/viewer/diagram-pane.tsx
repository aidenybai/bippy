import { useMemo } from "react";
import { Code } from "@/components/ui/code";
import { getDiagramRows, getSourceLine } from "../lib/diagram";
import type { ViewComponent, ViewFile } from "../model";
import { useHoverStore, useIsInactive } from "../store/hover";
import { useLoadedView } from "./context";
import { DiagramRowView } from "./diagram-rows";
import { StateGraph } from "./state-graph";

const CodeLine = ({ line, text }: { line: number; text: string }) => (
  <div className="grid grid-cols-[3rem_minmax(0,1fr)] items-baseline gap-3">
    <span className="text-right font-mono text-muted-foreground tabular-nums select-none">
      {line}
    </span>
    <Code className="wrap-anywhere whitespace-pre-wrap">{text}</Code>
  </div>
);

const ComponentDiagram = ({ view, component }: { view: ViewFile; component: ViewComponent }) => {
  const rows = useMemo(() => getDiagramRows(component), [component]);
  const activate = useHoverStore((state) => state.activate);
  const isInactive = useIsInactive(`${component.name}/`);
  if (!component.loc) return null;
  const { start, end } = component.loc;
  return (
    <section
      className="grid gap-1.5 transition-opacity duration-150"
      style={{ opacity: isInactive ? 0.45 : 1 }}
      onMouseEnter={() => activate(component.name)}
    >
      <CodeLine line={start.line} text={getSourceLine(view, start.line)} />
      <div className="grid gap-1.5 border-l pl-3 ml-[3.75rem]">
        {rows.map((row) => (
          <DiagramRowView key={`${row.kind}:${row.line}`} row={row} component={component} />
        ))}
        <StateGraph component={component} />
      </div>
      {end.line !== start.line && <CodeLine line={end.line} text={getSourceLine(view, end.line)} />}
    </section>
  );
};

export const DiagramPane = () => {
  const view = useLoadedView();
  return (
    <div className="h-full overflow-y-auto overflow-x-hidden overscroll-none">
      <div className="grid gap-6 px-2 py-3 pr-6">
        {view.components.map((component) => (
          <ComponentDiagram key={component.name} view={view} component={component} />
        ))}
      </div>
    </div>
  );
};
