export const diagramMetrics = {
  rowHeight: 20,
  indent: 20,
  nodeRadius: 3,
  fontSize: 10,
  annotationFontSize: 6,
  labelOffset: 7,
  strokeWidth: 0.5,
};

export interface Point {
  x: number;
  y: number;
}

export interface EdgeGeometry {
  from: Point;
  to: Point;
  kind?: "parent" | "owner" | "reference" | "context" | "portal";
  bend?: number;
  side?: "left" | "right";
  labelPosition?: Point;
}

export const getEdgePath = ({
  from,
  to,
  kind = "parent",
  bend = 40,
  side = "left",
}: EdgeGeometry) => {
  if (kind === "parent" || kind === "context") return `M ${from.x} ${from.y} V ${to.y} H ${to.x}`;
  if (kind === "portal")
    return `M ${from.x} ${from.y} Q ${(from.x + to.x) / 2} ${Math.min(from.y, to.y) - bend} ${to.x} ${to.y}`;
  const radius = Math.hypot(to.x - from.x, to.y - from.y) / 2;
  const sweep = Number(to.y < from.y !== (side === "right"));
  return `M ${from.x} ${from.y} A ${radius} ${radius} 0 0 ${sweep} ${to.x} ${to.y}`;
};

export const getEdgeLabelPosition = ({
  from,
  to,
  kind = "parent",
  bend = 40,
  side = "left",
  labelPosition,
}: EdgeGeometry): Point => {
  if (labelPosition) return labelPosition;
  if (kind === "portal")
    return {
      x: (from.x + to.x) / 2,
      y: (from.y + to.y) / 4 + (Math.min(from.y, to.y) - bend) / 2 - 6,
    };
  if (kind === "owner" || kind === "reference") {
    const direction = (to.y < from.y ? -1 : 1) * (side === "left" ? 1 : -1);
    return {
      x: (from.x + to.x) / 2 - (direction * (to.y - from.y)) / 2,
      y: (from.y + to.y) / 2 + (direction * (to.x - from.x)) / 2 - 6,
    };
  }
  return { x: (from.x + to.x) / 2, y: to.y - 6 };
};
