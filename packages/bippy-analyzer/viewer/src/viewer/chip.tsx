import type { ReactNode } from "react";
import { getSolidColor } from "../lib/colors";
import { useViewer } from "./context";

interface ChipProps {
  nodeIds: string[];
  children: ReactNode;
}

export const Chip = ({ nodeIds, children }: ChipProps) => {
  const { hoveredNodeId, hover, colorByNodeId, isDimmedNode } = useViewer();
  const [first] = nodeIds;
  const color = first ? colorByNodeId.get(first) : undefined;
  if (!first || !color) return <span>{children}</span>;
  const isHovered = hoveredNodeId !== null && nodeIds.includes(hoveredNodeId);
  return (
    <span
      data-seg={nodeIds.join(" ")}
      className="rounded-sm px-[5px] py-px font-mono text-foreground transition-opacity duration-150"
      style={{
        background: color,
        boxShadow: isHovered ? `0 0 0 1.5px ${getSolidColor(color)}` : undefined,
        opacity: isDimmedNode(nodeIds) ? 0.35 : 1,
      }}
      onMouseEnter={() => hover(first)}
      onMouseLeave={() => hover(null)}
    >
      {children}
    </span>
  );
};
