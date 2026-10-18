import { useResolvedTheme } from "../hooks/use-resolved-theme";
import type { PlacedToken } from "../hooks/use-token-boxes";
import { getSolidColor } from "../lib/colors";
import { useHoverStore, useIsDimmed, useIsHovered, useIsInactive } from "../store/hover";

interface TokenVisibility {
  isDimmed: boolean;
  isInactive: boolean;
  isMultiLine: boolean;
}

const getTokenOpacity = ({ isDimmed, isInactive, isMultiLine }: TokenVisibility): number => {
  if (isDimmed) return 0.25;
  if (isInactive) return 0.4;
  return isMultiLine ? 0.5 : 1;
};

interface TokenMarkProps extends PlacedToken {
  color: string;
}

export const TokenMark = ({ node, box, isMultiLine, color }: TokenMarkProps) => {
  const { theme } = useResolvedTheme();
  const hover = useHoverStore((state) => state.hover);
  const leave = useHoverStore((state) => state.leave);
  const isHovered = useIsHovered(node.id);
  const opacity = getTokenOpacity({
    isDimmed: useIsDimmed([node.id]),
    isInactive: useIsInactive(node.id),
    isMultiLine,
  });
  return (
    <rect
      data-node={node.id}
      className="pointer-events-auto cursor-default"
      x={isMultiLine ? box.x - 8 : box.x - 2}
      y={box.y + 1}
      width={isMultiLine ? 3 : box.width + 4}
      height={box.height - 2}
      rx={isMultiLine ? 1.5 : 2}
      fill={isMultiLine ? getSolidColor(color) : color}
      stroke={isHovered ? getSolidColor(color) : "none"}
      strokeWidth={2}
      opacity={opacity}
      style={{ mixBlendMode: theme === "dark" ? "screen" : "multiply" }}
      onMouseEnter={(event) => hover(node.id, { nodeId: node.id, element: event.currentTarget })}
      onMouseLeave={leave}
    />
  );
};
