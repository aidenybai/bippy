import { useState, type ReactNode } from "react";
import { ErrorBoundary } from "react-error-boundary";
import {
  Sidebar,
  SidebarContent,
  SidebarInset,
  SidebarLayout,
  SidebarProvider,
} from "@/components/ui/sidebar";
import { describeNode } from "@/lib/describe";
import { hasLegendContent } from "@/lib/graph";
import type { Example } from "@/model";
import { ViewerProvider, useActiveComponent, useHoveredNode, useViewer } from "./context";
import { DiagramPane } from "./diagram-pane";
import { Examples } from "./examples";
import { JsonPane } from "./json-pane";
import { Legend } from "./legend";
import { ErrorText, LoadedPane } from "./loaded-pane";
import { LegendSkeleton } from "./skeletons";
import { SourcePane } from "./source-pane";
import { Toolbar } from "./toolbar";

const Shell = ({ children }: { children: ReactNode }) => {
  const { file, view, mode } = useViewer();
  const [isLegendOpen, setLegendOpen] = useState(true);
  const hasLegend = file !== null && (view === null || hasLegendContent(view));
  return (
    <SidebarProvider
      open={isLegendOpen && hasLegend && mode !== "json"}
      onOpenChange={setLegendOpen}
    >
      <div className="grid h-dvh grid-rows-[auto_minmax(0,1fr)_auto] overscroll-none">
        {children}
      </div>
    </SidebarProvider>
  );
};

interface RootProps {
  examples: Example[];
  children: ReactNode;
}

const Root = ({ examples, children }: RootProps) => (
  <ViewerProvider examples={examples}>
    <Shell>{children}</Shell>
  </ViewerProvider>
);

interface PanesProps {
  source: ReactNode;
  legend: ReactNode;
}

const Crash = ({ error }: { error: unknown }) => (
  <ErrorText>{error instanceof Error ? (error.stack ?? error.message) : String(error)}</ErrorText>
);

const Panes = ({ source, legend }: PanesProps) => (
  <SidebarLayout>
    <SidebarInset>
      <ErrorBoundary FallbackComponent={Crash}>{source}</ErrorBoundary>
    </SidebarInset>
    <Sidebar side="right" title="Legend">
      <SidebarContent>
        <ErrorBoundary FallbackComponent={Crash}>{legend}</ErrorBoundary>
      </SidebarContent>
    </Sidebar>
  </SidebarLayout>
);

const FilePanes = () => {
  const { view, mode } = useViewer();
  const [hasOpenedJson, setHasOpenedJson] = useState(mode === "json");
  if (mode === "json" && !hasOpenedJson) setHasOpenedJson(true);
  return (
    <>
      <div hidden={mode !== "code"} className="h-full min-h-0">
        <SourcePane />
      </div>
      <div hidden={mode !== "diagram"} className="h-full min-h-0">
        <LoadedPane>{view && <DiagramPane />}</LoadedPane>
      </div>
      {hasOpenedJson && (
        <div hidden={mode !== "json"} className="h-full min-h-0">
          <JsonPane />
        </div>
      )}
    </>
  );
};

const Source = () => {
  const { file } = useViewer();
  return file === null ? <Examples /> : <FilePanes />;
};

const LegendPane = ({ children }: { children: ReactNode }) => {
  const { view, isViewLoading } = useViewer();
  if (view) return <Legend>{children}</Legend>;
  return isViewLoading ? <LegendSkeleton /> : null;
};

const Status = () => {
  const { file, view } = useViewer();
  const activeComponent = useActiveComponent();
  const hoveredNode = useHoveredNode();
  if (file === null) return null;
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
