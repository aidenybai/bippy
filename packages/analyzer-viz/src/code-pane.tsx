import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { codeToHtml } from "shiki";
import { getLinesBox, getLocationBox, type Box } from "./code-positions";
import { getSolidColor } from "./mapping";
import type { GraphNode, ViewComponent, ViewLocation } from "./model";

interface CodePaneProps {
  component: ViewComponent;
  colorByNodeId: Map<string, string>;
  hoveredNodeId: string | null;
  onHover: (nodeId: string | null) => void;
  onMeasure: () => void;
}

interface Placed {
  node: GraphNode;
  box: Box;
  isMultiLine: boolean;
}

const useHighlightedSource = (source: string): string => {
  const [html, setHtml] = useState("");
  useEffect(() => {
    let isCurrent = true;
    codeToHtml(source, { lang: "tsx", theme: "github-light" }).then((result) => {
      if (isCurrent) setHtml(result);
    });
    return () => {
      isCurrent = false;
    };
  }, [source]);
  return html;
};

const measure = (container: HTMLElement, component: ViewComponent, nodeIds: Set<string>): Placed[] =>
  component.graph.nodes.flatMap((node) => {
    if (!nodeIds.has(node.id)) return [];
    const isMultiLine = node.loc.start.line !== node.loc.end.line;
    const box = isMultiLine
      ? getLinesBox(container, node.loc as ViewLocation)
      : getLocationBox(container, node.loc as ViewLocation);
    return box && box.height > 0 ? [{ node, box, isMultiLine }] : [];
  });

export const CodePane = ({ component, colorByNodeId, hoveredNodeId, onHover, onMeasure }: CodePaneProps) => {
  const html = useHighlightedSource(component.source);
  const containerRef = useRef<HTMLDivElement>(null);
  const [placed, setPlaced] = useState<Placed[]>([]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || !html) return;
    const run = (): void => {
      setPlaced(measure(container, component, new Set(colorByNodeId.keys())));
      onMeasure();
    };
    run();
    document.fonts.ready.then(run);
    const observer = new ResizeObserver(run);
    observer.observe(container);
    return () => observer.disconnect();
  }, [html, component, colorByNodeId, onMeasure]);

  const width = containerRef.current?.scrollWidth ?? 0;
  const height = containerRef.current?.scrollHeight ?? 0;

  return (
    <div
      ref={containerRef}
      className="relative w-max min-w-full px-2 py-1 [&_pre]:m-0 [&_pre]:bg-transparent! [&_pre]:font-mono [&_pre]:text-xs [&_pre]:leading-[21px] [&_.line]:inline-block [&_.line]:min-w-full"
    >
      <div dangerouslySetInnerHTML={{ __html: html }} />
      <svg className="pointer-events-none absolute inset-0 overflow-visible" width={width} height={height}>
        {placed.map(({ node, box, isMultiLine }) => {
          const color = colorByNodeId.get(node.id) ?? "transparent";
          const isHovered = node.id === hoveredNodeId;
          return (
            <rect
              key={node.id}
              data-node={node.id}
              className="pointer-events-auto cursor-default"
              x={box.x - 2}
              y={box.y + 1}
              width={box.width + 4}
              height={box.height - 2}
              rx={2}
              fill={isMultiLine ? "none" : color}
              stroke={isHovered ? getSolidColor(color) : isMultiLine ? color : "none"}
              strokeWidth={isHovered ? 2 : 1}
              style={{ mixBlendMode: "multiply" }}
              onMouseEnter={() => onHover(node.id)}
              onMouseLeave={() => onHover(null)}
            >
              <title>{node.label}</title>
            </rect>
          );
        })}
      </svg>
    </div>
  );
};
