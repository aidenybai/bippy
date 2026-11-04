import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { cn } from "@/lib/utils";

export const Tabs = ({ className, ...props }: TabsPrimitive.Root.Props) => (
  <TabsPrimitive.Root
    data-slot="tabs"
    className={cn("flex flex-col gap-2", className)}
    {...props}
  />
);

export const TabsList = ({ className, children, ...props }: TabsPrimitive.List.Props) => (
  <TabsPrimitive.List
    data-slot="tabs-list"
    className={cn(
      "relative inline-flex h-[32px] w-fit items-center justify-center rounded-[10px] bg-muted p-[3px] text-muted-foreground",
      className,
    )}
    {...props}
  >
    <TabsPrimitive.Indicator
      data-slot="tabs-indicator"
      renderBeforeHydration
      className="absolute top-[calc(var(--active-tab-top)-1px)] left-[calc(var(--active-tab-left)-1px)] h-[calc(var(--active-tab-height)+2px)] w-[calc(var(--active-tab-width)+2px)] rounded-[8px] bg-background shadow-sm transition-[left,width] duration-300 ease-out-soft dark:border dark:border-input dark:bg-input/30"
    />
    {children}
  </TabsPrimitive.List>
);

export const TabsTrigger = ({ className, ...props }: TabsPrimitive.Tab.Props) => (
  <TabsPrimitive.Tab
    data-slot="tabs-trigger"
    className={cn(
      "relative inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-[6px] rounded-[8px] border border-transparent px-[6px] py-[2px] text-[14px]/[20px] font-medium whitespace-nowrap text-foreground/60 transition-colors hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 data-active:text-foreground dark:text-muted-foreground dark:hover:text-foreground dark:data-active:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-[16px]",
      className,
    )}
    {...props}
  />
);
