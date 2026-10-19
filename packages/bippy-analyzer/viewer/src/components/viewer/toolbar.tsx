import { ArrowLeft } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { analyzerJsonQuery } from "@/hooks/queries";
import { hasLegendContent } from "@/lib/graph";
import { getFileTitle } from "@/lib/source";
import { isViewMode } from "@/lib/view-mode";
import { useViewer } from "./context";
import { ThemeToggle } from "./theme-toggle";

const ModeTabs = () => {
  const { file, mode, setMode } = useViewer();
  const queryClient = useQueryClient();
  const prefetchJson = (): void => {
    if (file !== null) void queryClient.prefetchQuery(analyzerJsonQuery(file));
  };
  return (
    <Tabs value={mode} onValueChange={(value) => isViewMode(value) && setMode(value)}>
      <TabsList aria-label="View">
        <TabsTrigger value="code">Code</TabsTrigger>
        <TabsTrigger value="diagram">Diagram</TabsTrigger>
        <TabsTrigger value="json" onMouseEnter={prefetchJson} onFocus={prefetchJson}>
          JSON
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
};

const Title = () => {
  const { file, open, view } = useViewer();
  if (file === null) return <span className="font-medium text-foreground">bippy analyzer</span>;
  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Examples"
        title="Examples"
        onClick={() => open(null)}
      >
        <ArrowLeft />
      </Button>
      <span className="truncate font-mono text-foreground">{getFileTitle(file)}</span>
      {view && (
        <span className="hidden text-muted-foreground tabular-nums sm:inline">
          {view.components.length} components
        </span>
      )}
    </>
  );
};

export const Toolbar = () => {
  const { view, mode } = useViewer();
  const hasLegend = view !== null && hasLegendContent(view);
  return (
    <div className="flex h-11 items-center gap-2 border-b px-3 sm:gap-3">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <Title />
      </div>
      {view !== null && <ModeTabs />}
      {hasLegend && <SidebarTrigger disabled={mode === "json"} />}
      <ThemeToggle />
    </div>
  );
};
