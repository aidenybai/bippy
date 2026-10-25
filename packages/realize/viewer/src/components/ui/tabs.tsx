import { useLayoutEffect, useRef } from "react";
import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { animate, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

const INDICATOR_SPRING = { type: "spring", bounce: 0.15, duration: 0.35 } as const;

const INDICATOR_HANDOFF_MS = 1000;

interface IndicatorHandoff {
  box: DOMRect;
  changedAt: number;
}

let indicatorHandoff: IndicatorHandoff | null = null;

export const Tabs = ({ className, onValueChange, ...props }: TabsPrimitive.Root.Props) => {
  const rootRef = useRef<HTMLDivElement>(null);
  return (
    <TabsPrimitive.Root
      ref={rootRef}
      data-slot="tabs"
      className={cn("flex flex-col gap-2", className)}
      onValueChange={(value, eventDetails) => {
        const box = rootRef.current
          ?.querySelector('[data-slot="tabs-indicator"]')
          ?.getBoundingClientRect();
        indicatorHandoff = box ? { box, changedAt: performance.now() } : null;
        onValueChange?.(value, eventDetails);
      }}
      {...props}
    />
  );
};

export const TabsList = ({ className, ...props }: TabsPrimitive.List.Props) => (
  <TabsPrimitive.List
    data-slot="tabs-list"
    className={cn(
      "inline-flex h-[32px] w-fit items-center justify-center rounded-[10px] bg-muted p-[3px] text-muted-foreground",
      className,
    )}
    {...props}
  />
);

// HACK: switching tabs navigates and remounts the toolbar, so each indicator mounted right after a change slides from the box recorded on change
const TabsIndicator = () => {
  const indicatorRef = useRef<HTMLSpanElement>(null);
  const isReducedMotion = useReducedMotion();
  useLayoutEffect(() => {
    const indicator = indicatorRef.current;
    if (!indicator) return;
    const isFresh =
      indicatorHandoff !== null &&
      performance.now() - indicatorHandoff.changedAt < INDICATOR_HANDOFF_MS;
    const from = isFresh ? indicatorHandoff?.box : null;
    const to = indicator.getBoundingClientRect();
    if (from && !isReducedMotion)
      animate(
        indicator,
        { left: [from.left - to.left - 1, -1], right: [to.right - from.right - 1, -1] },
        INDICATOR_SPRING,
      );
  }, [isReducedMotion]);
  return (
    <span
      ref={indicatorRef}
      data-slot="tabs-indicator"
      className="absolute -inset-px rounded-[8px] bg-background shadow-sm dark:border dark:border-input dark:bg-input/30"
    />
  );
};

export const TabsTrigger = ({ className, ...props }: TabsPrimitive.Tab.Props) => (
  <TabsPrimitive.Tab
    data-slot="tabs-trigger"
    className={cn(
      "relative inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-[6px] rounded-[8px] border border-transparent px-[6px] py-[2px] text-[14px]/[20px] font-medium whitespace-nowrap text-foreground/60 transition-colors hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 data-active:text-foreground dark:text-muted-foreground dark:hover:text-foreground dark:data-active:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-[16px]",
      className,
    )}
    render={(triggerProps, state) => (
      <button {...triggerProps}>
        {state.active && <TabsIndicator />}
        <span className="relative inline-flex items-center gap-[6px]">{triggerProps.children}</span>
      </button>
    )}
    {...props}
  />
);
