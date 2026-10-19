import { Skeleton } from "@/components/ui/skeleton";

const CODE_WIDTHS = ["42%", "18%", "0%", "56%", "71%", "63%", "34%", "77%", "49%", "26%", "12%"];
const SECTIONS = ["variables", "states", "actions"];

export const CodeSkeleton = () => (
  <div className="grid gap-[7px] py-1.5 pr-8 pl-16" aria-busy="true">
    {CODE_WIDTHS.map((width) => (
      <Skeleton key={width} className="h-3" style={{ width }} />
    ))}
  </div>
);

export const LegendSkeleton = () => (
  <div className="grid content-start gap-5 px-4 py-4 sm:px-5" aria-busy="true">
    <div className="flex items-center gap-2">
      <Skeleton className="size-3.5" />
      <Skeleton className="h-3.5 w-24" />
      <Skeleton className="ml-auto h-3.5 w-28" />
    </div>
    <div className="grid gap-5 pl-5">
      {SECTIONS.map((section) => (
        <div key={section} className="grid gap-2">
          <Skeleton className="h-3.5 w-20" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      ))}
    </div>
  </div>
);
