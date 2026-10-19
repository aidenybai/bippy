import type { ReactNode } from "react";
import { getSolidColor } from "@/lib/colors";
import { useHoverStore, useIsDimmed } from "@/store/hover";
import { useViewer } from "./context";

interface ChipProps {
  nodeIds: string[];
  canDim?: boolean;
  children: ReactNode;
}

const ColoredChip = ({ nodeIds, canDim, color, children }: ChipProps & { color: string }) => {
  const [first] = nodeIds;
  const hover = useHoverStore((state) => state.hover);
  const leave = useHoverStore((state) => state.leave);
  const isHovered = useHoverStore(
    (state) => state.hoveredNodeId !== null && nodeIds.includes(state.hoveredNodeId),
  );
  const isDimmed = useIsDimmed(nodeIds) && canDim;
  return (
    <span
      data-seg={nodeIds.join(" ")}
      className="rounded-sm px-[5px] py-px font-mono text-foreground wrap-anywhere transition-opacity duration-150"
      style={{
        background: color,
        boxShadow: isHovered ? `0 0 0 1.5px ${getSolidColor(color)}` : undefined,
        opacity: isDimmed ? 0.35 : 1,
      }}
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
