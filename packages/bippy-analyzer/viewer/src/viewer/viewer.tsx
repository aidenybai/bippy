import type { ReactNode } from "react";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Spinner } from "@/components/ui/spinner";
import { useIsMobile } from "@/hooks/use-mobile";
import { describeNode } from "../lib/describe";
import { ViewerProvider, useViewer } from "./context";
import { JsonPane } from "./json-pane";
import { Legend } from "./legend";
import { SourcePane } from "./source-pane";
import { Toolbar } from "./toolbar";

const Root = ({ children }: { children: ReactNode }) => (
  <ViewerProvider>
    <div className="grid h-dvh grid-rows-[auto_minmax(0,1fr)_auto] overscroll-none">{children}</div>
  </ViewerProvider>
);

interface PanesProps {
  source: ReactNode;
  legend: ReactNode;
}

const Panes = ({ source, legend }: PanesProps) => {
  const isMobile = useIsMobile();
  return (
    <ResizablePanelGroup
      key={isMobile ? "vertical" : "horizontal"}
      orientation={isMobile ? "vertical" : "horizontal"}
      className="min-h-0"
    >
      <ResizablePanel defaultSize={isMobile ? "55" : "70"} minSize={isMobile ? 160 : 320}>
        {source}
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel defaultSize={isMobile ? "45" : "30"} minSize={isMobile ? 120 : 240}>
        {legend}
      </ResizablePanel>
    </ResizablePanelGroup>
  );
};

const Message = ({ children }: { children: ReactNode }) => (
  <p className="px-4 py-4 text-muted-foreground sm:px-5">{children}</p>
);

const Source = () => {
  const { file, mode, view, viewError, isViewLoading } = useViewer();
  if (!file) return <Message>Enter a file path above.</Message>;
  if (mode === "json") return <JsonPane />;
  if (viewError)
    return (
      <pre className="h-full overflow-auto px-4 py-4 font-mono whitespace-pre-wrap text-destructive sm:px-5">
        {viewError}
      </pre>
    );
  if (isViewLoading || !view) return <Spinner className="h-full" />;
  return <SourcePane />;
};

const LegendPane = ({ children }: { children: ReactNode }) => {
  const { activeComponent } = useViewer();
  return activeComponent ? <Legend>{children}</Legend> : null;
};

const Status = () => {
  const { hoveredNode, activeComponent, view } = useViewer();
  return (
    <div className="flex h-8 items-center gap-4 overflow-hidden border-t px-3 whitespace-nowrap text-muted-foreground tabular-nums">
      {activeComponent && (
        <span className="shrink-0">
          {activeComponent.name} · {activeComponent.states.length} states ·{" "}
          {activeComponent.handlers.length} actions
        </span>
      )}
      {hoveredNode && (
        <>
          <span className="hidden shrink-0 sm:inline">
            Line {hoveredNode.loc.start.line}, Offset {hoveredNode.loc.start.column}
          </span>
          <span className="truncate">{view && describeNode(view, hoveredNode)}</span>
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
