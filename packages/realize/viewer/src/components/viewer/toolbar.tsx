import { useEffect, type ReactNode } from "react";
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
      className="max-sm:w-full sm:ml-1"
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

const Logo = () => (
  <svg viewBox="0 0 72 72" fill="currentColor" aria-hidden="true" className="size-5">
    <path
      fillRule="evenodd"
      d="M0 0H72V72H0ZM11 13.7A2.7 2.7 0 0 1 13.7 11L20.8 11A2.7 2.7 0 0 1 23.5 13.7L23.5 20.8A2.7 2.7 0 0 0 26.2 23.5L33.3 23.5A2.7 2.7 0 0 0 36 20.8L36 13.7A2.7 2.7 0 0 1 38.7 11L58.3 11A2.7 2.7 0 0 1 61 13.7L61 20.8A2.7 2.7 0 0 1 58.3 23.5L38.7 23.5A2.7 2.7 0 0 0 36 26.2L36 33.3A2.7 2.7 0 0 1 33.3 36L26.2 36A2.7 2.7 0 0 0 23.5 38.7L23.5 58.3A2.7 2.7 0 0 1 20.8 61L13.7 61A2.7 2.7 0 0 1 11 58.3Z"
    />
  </svg>
);

const Root = ({ children }: { children: ReactNode }) => (
  <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-b px-3 pt-2 pb-2.5 sm:h-12 sm:flex-nowrap sm:py-0">
    {children}
  </div>
);

const Brand = () => (
  <div className="flex h-8 shrink-0 items-center gap-2">
    <span className="flex items-center gap-2 px-1 text-[15px]/[20px] font-semibold tracking-[-0.02em] text-foreground">
      <Logo />
      Realize
    </span>
    <span className="h-4 w-px bg-border" />
  </div>
);

const File = () => (
  <div className="flex h-8 min-w-0 flex-1 items-center">
    <Title />
  </div>
);

export const Toolbar = Object.assign(Root, { Brand, File, Modes: ModeTabs });
