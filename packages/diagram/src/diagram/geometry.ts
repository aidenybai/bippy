export const diagramMetrics = {
  rowHeight: 20,
  indent: 20,
  nodeRadius: 3,
  fontSize: 10,
  annotationFontSize: 6,
  labelOffset: 7,
  strokeWidth: 0.5,
};

interface DiagramLabel {
  label: string;
  annotation?: string;
}

export const getLabelWidth = ({ label, annotation }: DiagramLabel) =>
  Array.from(label).length * diagramMetrics.fontSize * 0.61 +
  diagramMetrics.labelOffset +
  (annotation ? Array.from(annotation).length * diagramMetrics.annotationFontSize * 0.61 + 4 : 0);

export interface Point {
  x: number;
  y: number;
}

export interface EdgeGeometry {
  from: Point;
  to: Point;
  kind?:
    | "parent"
    | "owner"
    | "reference"
    | "context"
    | "portal"
    | "data"
    | "update"
    | "subscription";
  waypoints?: readonly Point[];
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
  waypoints,
}: EdgeGeometry) => {
  if (waypoints)
    return `M ${from.x} ${from.y}${[...waypoints, to].map((point) => ` L ${point.x} ${point.y}`).join("")}`;
  if (kind === "data" || kind === "update" || kind === "subscription")
    return `M ${from.x} ${from.y} H ${(from.x + to.x) / 2} V ${to.y} H ${to.x}`;
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
  waypoints,
}: EdgeGeometry): Point => {
  if (labelPosition) return labelPosition;
  if (waypoints || kind === "data" || kind === "update" || kind === "subscription") {
    const middleX = (from.x + to.x) / 2;
    const points = [
      from,
      ...(waypoints ?? [
        { x: middleX, y: from.y },
        { x: middleX, y: to.y },
      ]),
      to,
    ];
    const lengths = points
      .slice(1)
      .map((point, index) => Math.hypot(point.x - points[index].x, point.y - points[index].y));
    let remaining = lengths.reduce((total, length) => total + length, 0) / 2;
    for (const [index, length] of lengths.entries()) {
      if (remaining <= length) {
        const ratio = length === 0 ? 0 : remaining / length;
        return {
          x: points[index].x + (points[index + 1].x - points[index].x) * ratio,
          y: points[index].y + (points[index + 1].y - points[index].y) * ratio - 6,
        };
      }
      remaining -= length;
    }
  }
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
