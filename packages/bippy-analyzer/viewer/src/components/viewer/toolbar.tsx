import { useEffect } from "react";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { buttonVariants } from "@/components/ui/button-variants";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { hasLegendContent } from "@/lib/graph";
import { getRouteHref } from "@/lib/route";
import { getFileTitle } from "@/lib/source";
import { VIEW_MODES, isViewMode } from "@/lib/view-mode";
import { useViewer } from "./context";
import { ThemeToggle } from "./theme-toggle";

const usePrefetchModes = (name: string | null): void => {
  const router = useRouter();
  useEffect(() => {
    if (name === null) return;
    for (const mode of VIEW_MODES) router.prefetch(getRouteHref(name, mode));
  }, [router, name]);
};

const ModeTabs = () => {
  const { name, mode, setMode } = useViewer();
  usePrefetchModes(name);
  return (
    <Tabs value={mode} onValueChange={(value) => isViewMode(value) && setMode(value)}>
      <TabsList aria-label="View">
        <TabsTrigger value="code">Code</TabsTrigger>
        <TabsTrigger value="diagram">Diagram</TabsTrigger>
        <TabsTrigger value="json">JSON</TabsTrigger>
      </TabsList>
    </Tabs>
  );
};

const Title = () => {
  const { view } = useViewer();
  if (view === null) return <span className="font-medium text-foreground">bippy analyzer</span>;
  return (
    <>
      <Link
        href="/"
        aria-label="Examples"
        title="Examples"
        className={buttonVariants({ variant: "ghost", size: "icon" })}
      >
        <ArrowLeft />
      </Link>
      <span className="truncate font-mono text-foreground">{getFileTitle(view.file)}</span>
      <span className="hidden text-muted-foreground tabular-nums sm:inline">
        {view.components.length} components
      </span>
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
