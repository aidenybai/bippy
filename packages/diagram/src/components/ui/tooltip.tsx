"use client";

import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import * as stylex from "@stylexjs/stylex";
import { createContext, useContext, useId } from "react";
import { colors } from "../../diagram/tokens.stylex";
import { mergeClassNames } from "../../diagram/dom-props";

export interface TooltipProps extends TooltipPrimitive.Root.Props {
  contentId?: string;
}

export interface TooltipContentProps extends Omit<
  TooltipPrimitive.Popup.Props,
  "className" | "id"
> {
  className?: string;
  side?: TooltipPrimitive.Positioner.Props["side"];
  sideOffset?: number;
}

const styles = stylex.create({
  positioner: { zIndex: 50 },
  content: {
    maxWidth: 320,
    borderRadius: 7,
    backgroundColor: colors.tooltip,
    color: colors.tooltipText,
    paddingInline: 7,
    paddingBlock: 2,
    fontFamily: "system-ui, sans-serif",
    fontSize: 12,
    lineHeight: "20px",
  },
});

export const TooltipProvider = ({ delay = 300, ...props }: TooltipPrimitive.Provider.Props) => (
  <TooltipPrimitive.Provider delay={delay} {...props} />
);
const TooltipDescriptionContext = createContext<string | undefined>(undefined);

export const Tooltip = ({ contentId, ...props }: TooltipProps) => {
  const generatedId = useId();
  const descriptionId = contentId ?? generatedId;
  return (
    <TooltipDescriptionContext value={descriptionId}>
      <TooltipPrimitive.Root {...props} />
    </TooltipDescriptionContext>
  );
};
export const TooltipTrigger = ({
  "aria-describedby": description,
  ...props
}: TooltipPrimitive.Trigger.Props) => {
  const descriptionId = useContext(TooltipDescriptionContext);
  return (
    <TooltipPrimitive.Trigger
      data-slot="tooltip-trigger"
      aria-describedby={mergeClassNames(description, descriptionId)}
      {...props}
    />
  );
};
export const TooltipContent = ({
  className,
  side = "top",
  sideOffset = 4,
  ...props
}: TooltipContentProps) => {
  const descriptionId = useContext(TooltipDescriptionContext);
  return (
    <TooltipPrimitive.Portal keepMounted>
      <TooltipPrimitive.Positioner
        side={side}
        sideOffset={sideOffset}
        {...stylex.props(styles.positioner)}
      >
        <TooltipPrimitive.Popup
          data-slot="tooltip-content"
          id={descriptionId}
          role="tooltip"
          {...props}
          className={mergeClassNames(stylex.props(styles.content).className, className)}
        />
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  );
};
