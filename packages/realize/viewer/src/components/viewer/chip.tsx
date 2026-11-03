import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useViewerStore, useIsDimmed } from "@/store/viewer";
import { useViewer } from "./context";

interface ChipProps {
  nodeIds: string[];
  canDim?: boolean;
  children: ReactNode;
}

interface ChipStyle extends CSSProperties {
  "--chip-color": string;
}

const ColoredChip = ({ nodeIds, canDim, color, children }: ChipProps & { color: string }) => {
  const [first] = nodeIds;
  const hover = useViewerStore((state) => state.hover);
  const leave = useViewerStore((state) => state.leave);
  const isHovered = useViewerStore(
    (state) => state.hoveredNodeId !== null && nodeIds.includes(state.hoveredNodeId),
  );
  const isDimmed = useIsDimmed(nodeIds) && canDim;
  const style: ChipStyle = { "--chip-color": color, opacity: isDimmed ? 0.35 : 1 };
  return (
    <span
      data-seg={nodeIds.join(" ")}
      className={cn(
        "inline-block max-w-full rounded-sm bg-(--chip-color)/30 px-[5px] py-px font-mono text-foreground wrap-anywhere transition-opacity duration-150",
        isHovered && "shadow-[inset_0_0_0_1.5px_var(--chip-color)]",
      )}
      style={style}
      onMouseEnter={() => first !== undefined && hover(first)}
      onMouseLeave={leave}
    >
      {children}
    </span>
  );
};

export const Chip = ({ nodeIds, canDim = true, children }: ChipProps) => {
  const { colorByNodeId } = useViewer();
  const [first] = nodeIds;
  const color = first !== undefined ? colorByNodeId.get(first) : undefined;
  if (color === undefined) return <span>{children}</span>;
  return (
    <ColoredChip nodeIds={nodeIds} canDim={canDim} color={color}>
      {children}
    </ColoredChip>
  );
};
