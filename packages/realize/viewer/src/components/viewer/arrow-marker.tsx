import type { SVGProps } from "react";

interface ArrowMarkerProps {
  id: string;
  size: number;
  isHollow?: boolean;
  markerUnits?: SVGProps<SVGMarkerElement>["markerUnits"];
}

export const ArrowMarker = ({
  id,
  size,
  isHollow = false,
  markerUnits = "userSpaceOnUse",
}: ArrowMarkerProps) => (
  <marker
    id={id}
    viewBox={`0 0 ${size} ${size}`}
    refX={size}
    refY={size / 2}
    markerWidth={size}
    markerHeight={size}
    markerUnits={markerUnits}
    orient="auto"
    overflow="visible"
  >
    <path
      d={`M ${size} ${size / 2} L 0 0 L 0 ${size} Z`}
      style={{
        fill: isHollow ? "var(--color-background)" : "context-stroke",
        stroke: isHollow ? "context-stroke" : "none",
      }}
      strokeLinejoin="round"
    />
  </marker>
);
