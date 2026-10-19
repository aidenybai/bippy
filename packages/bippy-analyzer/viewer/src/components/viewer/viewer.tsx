import type { ReactNode } from "react";
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
import type { ViewMode } from "@/lib/view-mode";
import type { Example, ViewFile } from "@/model";
import { useHighlighterWarmup } from "@/hooks/use-highlighter";
import { useUiStore } from "@/store/ui";
import { ViewerProvider, useActiveComponent, useHoveredNode, useViewer } from "./context";
import { DiagramPane } from "./diagram-pane";
import { JsonPane } from "./json-pane";
import { Legend } from "./legend";
import { SourcePane } from "./source-pane";
import { Toolbar } from "./toolbar";

const Shell = ({ children }: { children: ReactNode }) => {
  const { view, mode } = useViewer();
  const isLegendOpen = useUiStore((state) => state.isLegendOpen);
  const setLegendOpen = useUiStore((state) => state.setLegendOpen);
  useHighlighterWarmup();
  const hasLegend = hasLegendContent(view);
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
  name: string;
  mode: ViewMode;
  view: ViewFile;
  json: string | null;
  children: ReactNode;
}

const Root = ({ children, ...props }: RootProps) => (
  <ViewerProvider {...props}>
    <Shell>{children}</Shell>
  </ViewerProvider>
);

interface PanesProps {
  source: ReactNode;
  legend: ReactNode;
}

const Crash = ({ error }: { error: unknown }) => (
  <pre className="h-full overflow-auto px-4 py-4 font-mono whitespace-pre-wrap text-destructive sm:px-5">
    {error instanceof Error ? (error.stack ?? error.message) : String(error)}
  </pre>
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

const Source = () => {
  const { mode } = useViewer();
  if (mode === "diagram") return <DiagramPane />;
  if (mode === "json") return <JsonPane />;
  return <SourcePane />;
};

const LegendPane = ({ children }: { children: ReactNode }) => <Legend>{children}</Legend>;

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
          <span className="truncate">{describeNode(view, hoveredNode)}</span>
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
