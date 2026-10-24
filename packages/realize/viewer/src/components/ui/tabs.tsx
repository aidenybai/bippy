import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { cn } from "@/lib/utils";

export const Tabs = ({ className, ...props }: TabsPrimitive.Root.Props) => (
  <TabsPrimitive.Root data-slot="tabs" className={cn("flex gap-2", className)} {...props} />
);

export const TabsList = ({ className, ...props }: TabsPrimitive.List.Props) => (
  <TabsPrimitive.List
    data-slot="tabs-list"
    className={cn("inline-flex h-9 items-center gap-1 rounded-lg bg-muted p-1", className)}
    {...props}
  />
);

export const TabsTrigger = ({ className, ...props }: TabsPrimitive.Tab.Props) => (
  <TabsPrimitive.Tab
    data-slot="tabs-trigger"
    className={cn(
      "inline-flex h-7 items-center rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors duration-150 outline-none hover:text-foreground focus-visible:shadow-focus data-[active]:bg-background data-[active]:text-foreground data-[active]:shadow-card",
      className,
    )}
    {...props}
  />
);
