import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";

import { cn } from "@/lib/utils";

const Tabs = ({ className, ...props }: TabsPrimitive.Root.Props) => {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn("group/tabs flex flex-col gap-2", className)}
      {...props}
    />
  );
};

const TabsList = ({ className, ...props }: TabsPrimitive.List.Props) => {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        "group/tabs-list inline-flex h-8 w-fit items-center justify-center gap-1 rounded-none bg-transparent p-tabs-list text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
};

const TabsTrigger = ({ className, ...props }: TabsPrimitive.Tab.Props) => {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(
        "relative inline-flex h-tabs-trigger flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent bg-transparent px-1.5 py-0.5 text-sm font-medium whitespace-nowrap text-foreground/60 transition-all outline-none hover:text-foreground disabled:pointer-events-none disabled:opacity-50 has-data-[icon=inline-end]:pr-1 has-data-[icon=inline-start]:pl-1 aria-disabled:pointer-events-none aria-disabled:opacity-50 data-[active]:text-foreground dark:text-muted-foreground dark:hover:text-foreground dark:data-[active]:border-transparent dark:data-[active]:bg-transparent dark:data-[active]:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        "after:absolute after:inset-x-0 after:bottom-[-5px] after:h-0.5 after:bg-foreground after:opacity-0 after:transition-opacity data-[active]:after:opacity-100",
        className,
      )}
      {...props}
    />
  );
};

export { Tabs, TabsList, TabsTrigger };
