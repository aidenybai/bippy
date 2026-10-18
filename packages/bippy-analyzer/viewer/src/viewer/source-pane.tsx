import { useCallback, useMemo, useRef, useState, type MouseEvent } from "react";
import { File, type FileOptions } from "@pierre/diffs/react";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent } from "@/components/ui/tooltip";
import { getCodeTheme, useHighlighter } from "../hooks/use-highlighter";
import { useResolvedTheme } from "../hooks/use-resolved-theme";
import { useTokenBoxes, type TokenLayout } from "../hooks/use-token-boxes";
import { isRestingArc, placeArcs } from "../lib/arcs";
import { describeNode } from "../lib/describe";
import { getComponentAtLine } from "../lib/graph";
import { getLineFromEvent } from "../lib/positions";
import { useHoverStore } from "../store/hover";
import { Arc, ArcHead } from "./arc";
import { useHoveredNode, useLoadedView, useViewer } from "./context";
import { TokenMark } from "./token-mark";

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
  const activate = useHoverStore((state) => state.activate);
  return useCallback(
    (event: MouseEvent) => {
      const line = getLineFromEvent(event.nativeEvent);
      const component = line === null ? null : getComponentAtLine(view, line);
      if (component) activate(component.name);
    },
    [view, activate],
  );
};

const RestingArcs = ({ layout }: { layout: TokenLayout }) => {
  const view = useLoadedView();
  const { colorByNodeId } = useViewer();
  const arcs = useMemo(
    () => placeArcs(view, layout.tokens, colorByNodeId, isRestingArc),
    [view, layout, colorByNodeId],
  );
  return arcs.map((arc) => <Arc key={`${arc.edge.from}-${arc.edge.to}`} {...arc} />);
};

const CausalArcs = ({ layout }: { layout: TokenLayout }) => {
  const view = useLoadedView();
  const { colorByNodeId } = useViewer();
  const causalNodeIds = useHoverStore((state) => state.causalNodeIds);
  const arcs = useMemo(
    () =>
      causalNodeIds === null
        ? []
        : placeArcs(
            view,
            layout.tokens,
            colorByNodeId,
            (edge) =>
              !isRestingArc(edge) && causalNodeIds.has(edge.from) && causalNodeIds.has(edge.to),
          ),
    [view, layout, colorByNodeId, causalNodeIds],
  );
  return arcs.map((arc) => <Arc key={`${arc.edge.from}-${arc.edge.to}`} {...arc} />);
};

const TokenTooltip = () => {
  const view = useLoadedView();
  const hoveredNode = useHoveredNode();
  const anchor = useHoverStore((state) => state.anchor);
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
            <TokenMark
              key={token.node.id}
              {...token}
              color={colorByNodeId.get(token.node.id) ?? "transparent"}
            />
          ))}
          <RestingArcs layout={layout} />
          <CausalArcs layout={layout} />
        </svg>
        <TokenTooltip />
      </div>
    </div>
  );
};
