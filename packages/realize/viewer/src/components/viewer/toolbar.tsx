import { useEffect } from "react";
import { Check, ChevronDown } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { buttonVariants } from "@/components/ui/button-variants";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLinkItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getRouteHref } from "@/lib/route";
import { getFileTitle } from "@/lib/source";
import { cn } from "@/lib/utils";
import { VIEW_MODES, isViewMode } from "@/lib/view-mode";
import { useViewer } from "./context";

const usePrefetchModes = (name: string): void => {
  const router = useRouter();
  useEffect(() => {
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
        <TabsTrigger value="state-chart">State chart</TabsTrigger>
        <TabsTrigger value="json">JSON</TabsTrigger>
      </TabsList>
    </Tabs>
  );
};

const Title = () => {
  const { examples, name, mode, view } = useViewer();
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          className={cn(buttonVariants({ variant: "ghost" }), "min-w-0 font-mono text-foreground")}
        >
          <span className="truncate">{getFileTitle(view.file)}</span>
          <ChevronDown className="text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {examples.map((example) => (
            <DropdownMenuLinkItem
              key={example.name}
              render={<Link href={getRouteHref(example.name, mode)} />}
              aria-current={example.name === name ? "page" : undefined}
              className="font-mono"
            >
              <span className="flex-1">{getFileTitle(example.file)}</span>
              {example.name === name && <Check />}
            </DropdownMenuLinkItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <span className="hidden text-muted-foreground tabular-nums sm:inline">
        {view.components.length} components
      </span>
    </>
  );
};

export const Toolbar = () => (
  <div className="flex h-12 items-center gap-2 border-b px-3 sm:gap-3">
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <Title />
    </div>
    <ModeTabs />
  </div>
);
