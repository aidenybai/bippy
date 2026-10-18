import type { ReactNode } from "react";
import { ViewerProvider, useViewer } from "./context";
import { Legend } from "./legend";
import { SourcePane } from "./source-pane";
import { Toolbar } from "./toolbar";

const Root = ({ children }: { children: ReactNode }) => (
  <ViewerProvider>
    <div className="grid h-screen grid-rows-[auto_minmax(0,1fr)_auto]">{children}</div>
  </ViewerProvider>
);

const Panes = ({ children }: { children: ReactNode }) => (
  <div className="grid grid-cols-[minmax(0,1fr)_420px] overflow-hidden">{children}</div>
);

const Message = ({ children }: { children: ReactNode }) => (
  <p className="p-4 text-sm text-muted-foreground">{children}</p>
);

const Source = () => {
  const { file, view, viewError, isViewLoading } = useViewer();
  if (!file) return <Message>Enter a file path above.</Message>;
  if (viewError) return <pre className="p-4 text-sm text-destructive">{viewError}</pre>;
  if (isViewLoading || !view) return <Message>Loading…</Message>;
  return <SourcePane />;
};

const LegendPane = () => {
  const { activeComponent } = useViewer();
  return activeComponent ? <Legend /> : <div />;
};

const Status = () => {
  const { hoveredNode, activeComponent } = useViewer();
  return (
    <div className="flex h-8 items-center gap-3 border-t px-3 text-xs text-muted-foreground">
      {activeComponent && (
        <span>
          {activeComponent.name} · {activeComponent.states.length} states ·{" "}
          {activeComponent.handlers.length} handlers
        </span>
      )}
      {hoveredNode && (
        <>
          <span>
            Line {hoveredNode.loc.start.line}, Offset {hoveredNode.loc.start.column}
          </span>
          <span>{hoveredNode.label}</span>
        </>
      )}
    </div>
  );
};

export const Viewer = Object.assign(Root, {
  Toolbar,
  Panes,
  Source,
  Legend: LegendPane,
  Status,
});
