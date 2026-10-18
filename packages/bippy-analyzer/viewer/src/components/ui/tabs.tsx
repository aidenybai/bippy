import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { cn } from "@/lib/utils";

export const Tabs = ({ className, ...props }: TabsPrimitive.Root.Props) => (
  <TabsPrimitive.Root data-slot="tabs" className={cn("flex gap-2", className)} {...props} />
);

export const TabsList = ({ className, ...props }: TabsPrimitive.List.Props) => (
  <TabsPrimitive.List
    data-slot="tabs-list"
    className={cn("inline-flex h-7 items-center gap-0.5 rounded-md bg-muted p-0.5", className)}
    {...props}
  />
);

export const TabsTrigger = ({ className, ...props }: TabsPrimitive.Tab.Props) => (
  <TabsPrimitive.Tab
    data-slot="tabs-trigger"
    className={cn(
      "inline-flex h-6 items-center rounded-[5px] px-2 text-muted-foreground transition-colors duration-150 outline-none hover:text-foreground focus-visible:shadow-focus data-[active]:bg-background data-[active]:text-foreground data-[active]:shadow-card",
      className,
    )}
    {...props}
  />
);

export const TabsContent = ({ className, ...props }: TabsPrimitive.Panel.Props) => (
  <TabsPrimitive.Panel
    data-slot="tabs-content"
    className={cn("outline-none", className)}
    {...props}
  />
);
