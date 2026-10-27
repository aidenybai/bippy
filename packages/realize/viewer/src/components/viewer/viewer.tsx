import type { ReactNode } from "react";
import { ErrorBoundary } from "react-error-boundary";
import {
  Sidebar,
  SidebarContent,
  SidebarInset,
  SidebarLayout,
  SidebarProvider,
} from "@/components/ui/sidebar";
import { hasInspectorContent } from "@/lib/graph";
import type { ViewMode } from "@/lib/view-mode";
import type { Example, ViewFile } from "@/model";
import { useHighlighterWarmup } from "@/hooks/use-highlighter";
import { useUiStore } from "@/store/ui";
import { ViewerProvider, useViewer } from "./context";
import { JsonPane } from "./json-pane";
import { Inspector } from "./inspector";
import { SourcePane } from "./source-pane";
import { StateChartPane } from "./state-chart-pane";
import { Status } from "./status";
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

const Crash = ({ error }: { error: unknown }) => (
  <pre className="h-full overflow-auto px-4 py-4 font-mono whitespace-pre-wrap text-destructive sm:px-5">
    {error instanceof Error ? (error.stack ?? error.message) : String(error)}
  </pre>
);

const Panes = ({ children }: { children: ReactNode }) => <SidebarLayout>{children}</SidebarLayout>;

const Pane = () => {
  const { mode } = useViewer();
  if (mode === "state-chart") return <StateChartPane />;
  if (mode === "json") return <JsonPane />;
  return <SourcePane />;
};

const Source = () => (
  <SidebarInset>
    <ErrorBoundary FallbackComponent={Crash}>
      <Pane />
    </ErrorBoundary>
  </SidebarInset>
);

const InspectorPane = ({ children }: { children: ReactNode }) => (
  <Sidebar side="right" title="Inspector">
    <SidebarContent>
      <ErrorBoundary FallbackComponent={Crash}>
        <Inspector>{children}</Inspector>
      </ErrorBoundary>
    </SidebarContent>
  </Sidebar>
);

export const Viewer = Object.assign(Root, {
  Toolbar,
  Panes,
  Source,
  Inspector: InspectorPane,
  Status,
});
