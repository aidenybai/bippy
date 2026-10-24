import { Collapsible as CollapsiblePrimitive } from "@base-ui/react/collapsible";
import { cn } from "@/lib/utils";

export const Collapsible = (props: CollapsiblePrimitive.Root.Props) => (
  <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />
);

export const CollapsibleTrigger = ({ className, ...props }: CollapsiblePrimitive.Trigger.Props) => (
  <CollapsiblePrimitive.Trigger
    data-slot="collapsible-trigger"
    className={cn("outline-none focus-visible:shadow-focus", className)}
    {...props}
  />
);

export const CollapsibleContent = ({ className, ...props }: CollapsiblePrimitive.Panel.Props) => (
  <CollapsiblePrimitive.Panel
    data-slot="collapsible-content"
    className={cn(
      "h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-200 ease-out data-ending-style:h-0 data-starting-style:h-0",
      className,
    )}
    {...props}
  />
);
