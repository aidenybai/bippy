import { Children, useState, type PointerEvent, type ReactNode } from "react";

const DEFAULT_LEGEND_WIDTH = 420;
const MIN_LEGEND_WIDTH = 240;
const MIN_SOURCE_WIDTH = 320;

const clampLegendWidth = (width: number): number =>
  Math.min(Math.max(width, MIN_LEGEND_WIDTH), window.innerWidth - MIN_SOURCE_WIDTH);

const Divider = ({ onResize }: { onResize: (deltaX: number) => void }) => (
  <div
    role="separator"
    aria-orientation="vertical"
    className="w-1 cursor-col-resize touch-none select-none bg-border transition-colors hover:bg-foreground/40"
    onPointerDown={(event: PointerEvent<HTMLDivElement>) =>
      event.currentTarget.setPointerCapture(event.pointerId)
    }
    onPointerMove={(event: PointerEvent<HTMLDivElement>) => {
      if (event.buttons === 1) onResize(event.movementX);
    }}
  />
);

export const Panes = ({ children }: { children: ReactNode }) => {
  const [legendWidth, setLegendWidth] = useState(DEFAULT_LEGEND_WIDTH);
  const [source, legend] = Children.toArray(children);
  return (
    <div
      className="grid overflow-hidden"
      style={{ gridTemplateColumns: `minmax(0, 1fr) auto ${legendWidth}px` }}
    >
      {source}
      <Divider onResize={(deltaX) => setLegendWidth((width) => clampLegendWidth(width - deltaX))} />
      {legend}
    </div>
  );
};
