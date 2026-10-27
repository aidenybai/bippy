import type { ReactNode } from "react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { describeNode } from "@/lib/describe";
import { hasInspectorContent } from "@/lib/graph";
import { ArcKey } from "./arc-key";
import { useHoveredNode, useViewer } from "./context";
import { ThemeToggle } from "./theme-toggle";

const Root = ({ children }: { children: ReactNode }) => (
  <div className="flex h-9 items-center gap-4 border-t pr-1.5 pl-3 whitespace-nowrap text-muted-foreground tabular-nums">
    {children}
  </div>
);

const Hover = () => {
  const { view } = useViewer();
  const hoveredNode = useHoveredNode();
  return (
    <div className="flex min-w-0 flex-1 items-center gap-4 overflow-hidden">
      {hoveredNode && (
        <>
          <span className="hidden shrink-0 sm:inline">
            Line {hoveredNode.loc.start.line}, Offset {hoveredNode.loc.start.column}
          </span>
          <span className="truncate">{describeNode(view, hoveredNode)}</span>
        </>
      )}
    </div>
  );
};

const Key = () => {
  const { mode } = useViewer();
  return mode === "code" ? <ArcKey /> : null;
};

const Controls = () => {
  const { view, mode } = useViewer();
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      {hasInspectorContent(view) && <SidebarTrigger label="inspector" disabled={mode === "json"} />}
      <ThemeToggle />
    </div>
  );
};

export const Status = Object.assign(Root, { Hover, Key, Controls });
