import type { ComponentProps } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { cn } from "@/lib/utils";

export const ResizablePanelGroup = ({ className, ...props }: ComponentProps<typeof Group>) => (
  <Group
    data-slot="resizable-panel-group"
    className={cn("flex h-full w-full aria-[orientation=vertical]:flex-col", className)}
    {...props}
  />
);

export const ResizablePanel = ({ className, ...props }: ComponentProps<typeof Panel>) => (
  <Panel data-slot="resizable-panel" className={cn("min-h-0 min-w-0", className)} {...props} />
);

export const ResizableHandle = ({ className, ...props }: ComponentProps<typeof Separator>) => (
  <Separator
    data-slot="resizable-handle"
    className={cn(
      "relative w-px bg-border transition-colors duration-150 outline-none after:absolute after:inset-y-0 after:left-1/2 after:w-2 after:-translate-x-1/2 hover:bg-faint focus-visible:bg-faint data-[resize=active]:bg-foreground aria-[orientation=horizontal]:h-px aria-[orientation=horizontal]:w-full aria-[orientation=horizontal]:after:inset-x-0 aria-[orientation=horizontal]:after:top-1/2 aria-[orientation=horizontal]:after:h-2 aria-[orientation=horizontal]:after:w-full aria-[orientation=horizontal]:after:-translate-y-1/2 aria-[orientation=horizontal]:after:translate-x-0",
      className,
    )}
    {...props}
  />
);
