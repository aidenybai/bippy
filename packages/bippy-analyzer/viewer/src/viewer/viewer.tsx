import { useState, type ReactNode } from "react";
import {
  Sidebar,
  SidebarContent,
  SidebarInset,
  SidebarLayout,
  SidebarProvider,
} from "@/components/ui/sidebar";
import { Spinner } from "@/components/ui/spinner";
import { describeNode } from "../lib/describe";
import { ViewerProvider, useActiveComponent, useHoveredNode, useViewer } from "./context";
import { JsonPane } from "./json-pane";
import { Legend } from "./legend";
import { SourcePane } from "./source-pane";
import { Toolbar } from "./toolbar";

const Shell = ({ children }: { children: ReactNode }) => {
  const { mode } = useViewer();
  const [isLegendOpen, setLegendOpen] = useState(true);
  return (
    <SidebarProvider open={isLegendOpen && mode === "code"} onOpenChange={setLegendOpen}>
      <div className="grid h-dvh grid-rows-[auto_minmax(0,1fr)_auto] overscroll-none">
        {children}
      </div>
    </SidebarProvider>
  );
};

const Root = ({ children }: { children: ReactNode }) => (
  <ViewerProvider>
    <Shell>{children}</Shell>
  </ViewerProvider>
);

interface PanesProps {
  source: ReactNode;
  legend: ReactNode;
}

const Panes = ({ source, legend }: PanesProps) => (
  <SidebarLayout>
    <SidebarInset>{source}</SidebarInset>
    <Sidebar side="right" title="Legend">
      <SidebarContent>{legend}</SidebarContent>
    </Sidebar>
  </SidebarLayout>
);

const Message = ({ children }: { children: ReactNode }) => (
  <p className="px-4 py-4 text-muted-foreground sm:px-5">{children}</p>
);

const CodePane = () => {
  const { view, viewError, isViewLoading } = useViewer();
  if (viewError)
    return (
      <pre className="h-full overflow-auto px-4 py-4 font-mono whitespace-pre-wrap text-destructive sm:px-5">
        {viewError}
      </pre>
    );
  if (isViewLoading || !view) return <Spinner className="h-full" />;
  return <SourcePane />;
};

const Source = () => {
  const { file, mode } = useViewer();
  const [hasOpenedJson, setHasOpenedJson] = useState(mode === "json");
  if (mode === "json" && !hasOpenedJson) setHasOpenedJson(true);
  if (!file) return <Message>Enter a file path above.</Message>;
  return (
    <>
      <div hidden={mode !== "code"} className="h-full min-h-0">
        <CodePane />
      </div>
      {hasOpenedJson && (
        <div hidden={mode !== "json"} className="h-full min-h-0">
          <JsonPane />
        </div>
      )}
    </>
  );
};

const LegendPane = ({ children }: { children: ReactNode }) => {
  const activeComponent = useActiveComponent();
  return activeComponent ? <Legend>{children}</Legend> : null;
};

const Status = () => {
  const { view } = useViewer();
  const activeComponent = useActiveComponent();
  const hoveredNode = useHoveredNode();
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
