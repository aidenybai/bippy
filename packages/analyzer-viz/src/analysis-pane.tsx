import type { ViewComponent } from "./model";
import { getAnalysisLines, getColorForLine, getSolidColor } from "./mapping";

interface AnalysisPaneProps {
  component: ViewComponent;
  colorByNodeId: Map<string, string>;
  hoveredNodeId: string | null;
  onHover: (nodeId: string | null) => void;
}

export const AnalysisPane = ({ component, colorByNodeId, hoveredNodeId, onHover }: AnalysisPaneProps) => {
  const lines = getAnalysisLines(component);
  return (
    <div className="font-mono text-xs leading-[21px] whitespace-pre">
      {lines.map((line, lineIndex) => (
        <div key={lineIndex} className="flex" style={{ paddingLeft: 8 + line.indent * 16 }}>
          {line.segments.map((segment, segmentIndex) => {
            const nodeIds = segment.nodeId
              ? (line.armNodeIds?.length ? line.armNodeIds : [segment.nodeId])
              : [];
            const color = segment.nodeId ? colorByNodeId.get(segment.nodeId) : undefined;
            const isHovered = hoveredNodeId !== null && nodeIds.includes(hoveredNodeId);
            return (
              <span
                key={segmentIndex}
                data-seg={nodeIds.join(" ") || undefined}
                className={segment.nodeId ? "rounded-[2px] px-0.5 -mx-0.5" : line.indent === 0 ? "text-muted-foreground" : ""}
                style={
                  segment.nodeId
                    ? {
                        background: color ?? getColorForLine(lineIndex),
                        outline: isHovered ? `2px solid ${getSolidColor(color ?? getColorForLine(lineIndex))}` : undefined,
                      }
                    : undefined
                }
                onMouseEnter={segment.nodeId ? () => onHover(nodeIds[0] ?? null) : undefined}
                onMouseLeave={segment.nodeId ? () => onHover(null) : undefined}
              >
                {segment.text}
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
};
