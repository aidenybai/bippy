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
    <Tabs
      value={mode}
      onValueChange={(value) => isViewMode(value) && setMode(value)}
      className="max-sm:w-full"
    >
      <TabsList aria-label="View" className="max-sm:w-full">
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
  );
};

export const Toolbar = () => (
  <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-b px-3 pt-2 pb-2.5 sm:h-12 sm:flex-nowrap sm:gap-3 sm:py-0">
    <div className="flex h-8 min-w-0 flex-1 items-center gap-2">
      <span
        role="img"
        aria-label="Realize"
        title="Realize"
        className="shrink-0 px-1 text-[15px]/[20px] font-semibold text-foreground"
      >
        明
      </span>
      <span className="h-4 w-px shrink-0 bg-border" />
      <Title />
    </div>
    <ModeTabs />
  </div>
);
