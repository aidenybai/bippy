import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import { cn } from "@/lib/utils";

export const Tooltip = (props: TooltipPrimitive.Root.Props) => (
  <TooltipPrimitive.Root data-slot="tooltip" {...props} />
);

type TooltipContentProps = TooltipPrimitive.Popup.Props &
  Pick<
    TooltipPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset" | "anchor"
  >;

export const TooltipContent = ({
  className,
  side = "top",
  sideOffset = 4,
  align = "center",
  alignOffset = 0,
  anchor,
  ...props
}: TooltipContentProps) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Positioner
      align={align}
      alignOffset={alignOffset}
      side={side}
      sideOffset={sideOffset}
      anchor={anchor}
      className="isolate z-50"
    >
      <TooltipPrimitive.Popup
        data-slot="tooltip-content"
        className={cn(
          "z-50 block w-fit max-w-xs rounded-[5px] bg-background px-1.5 py-px text-[12px]/[18px] text-text-2 wrap-anywhere shadow-card",
          className,
        )}
        {...props}
      />
    </TooltipPrimitive.Positioner>
  </TooltipPrimitive.Portal>
);
