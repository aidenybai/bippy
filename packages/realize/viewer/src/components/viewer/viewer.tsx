import type { ReactNode } from "react";
import { ErrorBoundary } from "react-error-boundary";
import {
  Sidebar,
  SidebarContent,
  SidebarInset,
  SidebarLayout,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { describeNode } from "@/lib/describe";
import { hasInspectorContent } from "@/lib/graph";
import type { ViewMode } from "@/lib/view-mode";
import type { Example, ViewFile } from "@/model";
import { useHighlighterWarmup } from "@/hooks/use-highlighter";
import { useUiStore } from "@/store/ui";
import { ArcKey } from "./arc-key";
import { ViewerProvider, useHoveredNode, useViewer } from "./context";
import { JsonPane } from "./json-pane";
import { Inspector } from "./inspector";
import { SourcePane } from "./source-pane";
import { StateChartPane } from "./state-chart-pane";
import { ThemeToggle } from "./theme-toggle";
import { Toolbar } from "./toolbar";

const Shell = ({ children }: { children: ReactNode }) => {
  const { view, mode } = useViewer();
  const isInspectorOpen = useUiStore((state) => state.isInspectorOpen);
  const setInspectorOpen = useUiStore((state) => state.setInspectorOpen);
  useHighlighterWarmup();
  const canShowInspector = hasInspectorContent(view) && mode !== "json";
  return (
    <SidebarProvider
      open={isInspectorOpen && canShowInspector}
      onOpenChange={(open) => {
        if (canShowInspector) setInspectorOpen(open);
      }}
    >
      <div className="grid h-dvh grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)_auto] overscroll-none">
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
  inspector: ReactNode;
}

const Crash = ({ error }: { error: unknown }) => (
  <pre className="h-full overflow-auto px-4 py-4 font-mono whitespace-pre-wrap text-destructive sm:px-5">
    {error instanceof Error ? (error.stack ?? error.message) : String(error)}
  </pre>
);

const Panes = ({ source, inspector }: PanesProps) => (
  <SidebarLayout>
    <SidebarInset>
      <ErrorBoundary FallbackComponent={Crash}>{source}</ErrorBoundary>
    </SidebarInset>
    <Sidebar side="right" title="Inspector">
      <SidebarContent>
        <ErrorBoundary FallbackComponent={Crash}>{inspector}</ErrorBoundary>
      </SidebarContent>
    </Sidebar>
  </SidebarLayout>
);

const Source = () => {
  const { mode } = useViewer();
  if (mode === "state-chart") return <StateChartPane />;
  if (mode === "json") return <JsonPane />;
  return <SourcePane />;
};

const InspectorPane = ({ children }: { children: ReactNode }) => <Inspector>{children}</Inspector>;

const Status = () => {
  const { view, mode } = useViewer();
  const hoveredNode = useHoveredNode();
  return (
    <div className="flex h-9 items-center gap-4 border-t pr-1.5 pl-3 whitespace-nowrap text-muted-foreground tabular-nums">
      <div className="flex min-w-0 flex-1 items-center gap-4 overflow-hidden">
        {hoveredNode && (
          <>
            <span className="hidden shrink-0 sm:inline">
              Line {hoveredNode.loc.start.line}, Offset {hoveredNode.loc.start.column}
            </span>
            <span className="truncate">{describeNode(view, hoveredNode)}</span>
          </>
        )}
      </div>
      {mode === "code" && <ArcKey />}
      <div className="flex shrink-0 items-center gap-0.5">
        {hasInspectorContent(view) && (
          <SidebarTrigger label="inspector" disabled={mode === "json"} />
        )}
        <ThemeToggle />
      </div>
    </div>
  );
};

export const Viewer = Object.assign(Root, {
  Toolbar,
  Panes,
  Source,
  Inspector: InspectorPane,
  Status,
});
