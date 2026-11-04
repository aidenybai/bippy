import { Accordion as AccordionPrimitive } from "@base-ui/react/accordion";
import { cn } from "@/lib/utils";

export const Accordion = (props: AccordionPrimitive.Root.Props) => (
  <AccordionPrimitive.Root data-slot="accordion" {...props} />
);

export const AccordionItem = (props: AccordionPrimitive.Item.Props) => (
  <AccordionPrimitive.Item data-slot="accordion-item" {...props} />
);

export const AccordionTrigger = ({ className, ...props }: AccordionPrimitive.Trigger.Props) => (
  <AccordionPrimitive.Header render={<h2 />}>
    <AccordionPrimitive.Trigger
      data-slot="accordion-trigger"
      className={cn("outline-none focus-visible:shadow-focus", className)}
      {...props}
    />
  </AccordionPrimitive.Header>
);

export const AccordionContent = ({ className, ...props }: AccordionPrimitive.Panel.Props) => (
  <AccordionPrimitive.Panel
    data-slot="accordion-content"
    className={cn(
      "h-(--accordion-panel-height) overflow-hidden transition-[height] duration-200 ease-out data-ending-style:h-0 data-starting-style:h-0",
      className,
    )}
    {...props}
  />
);
