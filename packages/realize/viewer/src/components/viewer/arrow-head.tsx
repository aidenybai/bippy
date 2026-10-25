export interface Point {
  x: number;
  y: number;
}

interface ArrowHeadProps {
  from: Point;
  tip: Point;
  color: string;
  size: number;
}

export const ArrowHead = ({ from, tip, color, size }: ArrowHeadProps) => {
  const length = Math.hypot(tip.x - from.x, tip.y - from.y) || 1;
  const unitX = (tip.x - from.x) / length;
  const unitY = (tip.y - from.y) / length;
  const baseX = tip.x - unitX * size;
  const baseY = tip.y - unitY * size;
  const spreadX = (-unitY * size) / 2;
  const spreadY = (unitX * size) / 2;
  return (
    <path
      d={`M ${tip.x} ${tip.y} L ${baseX + spreadX} ${baseY + spreadY} L ${baseX - spreadX} ${baseY - spreadY} Z`}
      style={{ fill: color }}
    />
  );
};
