import { useCallback, useMemo, useRef, useState, type MouseEvent } from "react";
import { File, type FileOptions } from "@pierre/diffs/react";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent } from "@/components/ui/tooltip";
import { getCodeTheme, useHighlighter } from "../hooks/use-highlighter";
import { useResolvedTheme } from "../hooks/use-resolved-theme";
import { useTokenBoxes, type TokenLayout } from "../hooks/use-token-boxes";
import { describeNode } from "../lib/describe";
import { getComponentAtLine } from "../lib/graph";
import { getLineFromEvent, type Box } from "../lib/positions";
import type { GraphEdge } from "../model";
import { Arc, ArcHead, type PlacedArc } from "./arc";
import { useLoadedView, useViewer } from "./context";
import { TokenMark, type TokenAnchor } from "./token-mark";

const RESTING_ARC_KINDS = new Set<GraphEdge["kind"]>(["writes", "decides"]);

const FILE_OPTIONS: Omit<FileOptions<undefined, undefined>, "theme"> = {
  overflow: "wrap",
  unsafeCSS:
    ":host { background-color: transparent; --diffs-bg: transparent; } [data-gutter], [data-column-number] { background: transparent; }",
  disableFileHeader: true,
  disableErrorHandling: true,
  preferredHighlighter: "shiki-js",
};

const useActivateAtPointer = (): ((event: MouseEvent) => void) => {
  const view = useLoadedView();
  const { activate } = useViewer();
  return useCallback(
    (event: MouseEvent) => {
      const line = getLineFromEvent(event.nativeEvent);
      const component = line === null ? null : getComponentAtLine(view, line);
      if (component) activate(component.name);
    },
    [view, activate],
  );
};

const useArcs = (layout: TokenLayout): PlacedArc[] => {
  const view = useLoadedView();
  const { causalNodeIds } = useViewer();
  return useMemo(() => {
    const boxes = new Map<string, Box>();
    for (const token of layout.tokens) if (!token.isMultiLine) boxes.set(token.node.id, token.box);
    const isCausal = (edge: GraphEdge): boolean =>
      causalNodeIds !== null && causalNodeIds.has(edge.from) && causalNodeIds.has(edge.to);
    return view.components
      .flatMap((component) => component.graph.edges)
      .filter((edge) => RESTING_ARC_KINDS.has(edge.kind) || isCausal(edge))
      .flatMap((edge) => {
        const from = boxes.get(edge.from);
        const to = boxes.get(edge.to);
        return from && to && from.y !== to.y ? [{ edge, from, to }] : [];
      });
  }, [view, layout, causalNodeIds]);
};

const TokenTooltip = ({ anchor }: { anchor: TokenAnchor | null }) => {
  const { hoveredNode } = useViewer();
  const view = useLoadedView();
  const isOpen = anchor !== null && hoveredNode !== null && hoveredNode.id === anchor.nodeId;
  return (
    <Tooltip open={isOpen}>
      <TooltipContent anchor={anchor?.element} className="font-mono">
        {hoveredNode && describeNode(view, hoveredNode)}
      </TooltipContent>
    </Tooltip>
  );
};

export const SourcePane = () => {
  const view = useLoadedView();
  const isHighlighterReady = useHighlighter() !== null;
  const { colorByNodeId } = useViewer();
  const { theme } = useResolvedTheme();
  const activateAtPointer = useActivateAtPointer();
  const [anchor, setAnchor] = useState<TokenAnchor | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [renderCount, setRenderCount] = useState(0);
  const onPostRender = useCallback(() => setRenderCount((count) => count + 1), []);
  const options = useMemo<FileOptions<undefined, undefined>>(
    () => ({ ...FILE_OPTIONS, theme: getCodeTheme(theme), onPostRender }),
    [theme, onPostRender],
  );
  const file = useMemo(
    () => ({ name: view.file.split("/").at(-1) ?? view.file, contents: view.source }),
    [view],
  );
  const coloredNodes = useMemo(
    () =>
      view.components
        .flatMap((component) => component.graph.nodes)
        .filter((node) => colorByNodeId.has(node.id)),
    [view, colorByNodeId],
  );
  const layout = useTokenBoxes(wrapperRef, coloredNodes, renderCount);
  const arcs = useArcs(layout);
  return (
    <div className="h-full overflow-y-auto overflow-x-hidden overscroll-none">
      <div
        ref={wrapperRef}
        onMouseMove={activateAtPointer}
        className="relative min-w-0 py-1 pr-8 text-[13px]/[19px]"
      >
        {isHighlighterReady ? (
          <File file={file} options={options} disableWorkerPool />
        ) : (
          <Spinner className="h-40" />
        )}
        <svg
          className="pointer-events-none absolute inset-0 overflow-hidden"
          width={layout.width}
          height={layout.height}
        >
          <ArcHead />
          {layout.tokens.map((token) => (
            <TokenMark key={token.node.id} {...token} onEnter={setAnchor} />
          ))}
          {arcs.map((arc) => (
            <Arc key={`${arc.edge.from}-${arc.edge.to}`} {...arc} />
          ))}
        </svg>
        <TokenTooltip anchor={anchor} />
      </div>
    </div>
  );
};
