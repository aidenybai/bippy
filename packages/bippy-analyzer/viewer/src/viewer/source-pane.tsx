import { useCallback, useMemo, useRef, useState, type MouseEvent, type RefObject } from "react";
import { File, type FileEditChangeHandler, type FileOptions } from "@pierre/diffs/react";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent } from "@/components/ui/tooltip";
import { getCodeTheme, useHighlighter } from "../hooks/use-highlighter";
import { useResolvedTheme } from "../hooks/use-resolved-theme";
import { useTokenBoxes, type PlacedToken, type TokenLayout } from "../hooks/use-token-boxes";
import { isRestingArc, placeArcs } from "../lib/arcs";
import { describeNode } from "../lib/describe";
import { getComponentAtLine } from "../lib/graph";
import { getLineFromEvent, type Box } from "../lib/positions";
import { useEditorStore, useHasDraft } from "../store/editor";
import { useHoverStore, type TokenAnchor } from "../store/hover";
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

const contains = (box: Box, x: number, y: number): boolean =>
  x >= box.x - 2 && x <= box.x + box.width + 2 && y >= box.y && y <= box.y + box.height;

const findTokenAt = (tokens: PlacedToken[], x: number, y: number): PlacedToken | null =>
  tokens.find((token) => !token.isMultiLine && contains(token.box, x, y)) ?? null;

const createAnchor = (token: PlacedToken, wrapper: HTMLElement): TokenAnchor => ({
  nodeId: token.node.id,
  getBoundingClientRect: () => {
    const origin = wrapper.getBoundingClientRect();
    const { box } = token;
    return new DOMRect(origin.left + box.x, origin.top + box.y, box.width, box.height);
  },
});

const usePointerTracking = (
  wrapperRef: RefObject<HTMLDivElement | null>,
  layout: TokenLayout,
): ((event: MouseEvent) => void) => {
  const view = useLoadedView();
  const activate = useHoverStore((state) => state.activate);
  const hover = useHoverStore((state) => state.hover);
  const leave = useHoverStore((state) => state.leave);
  return useCallback(
    (event: MouseEvent) => {
      const wrapper = wrapperRef.current;
      if (!wrapper) return;
      const origin = wrapper.getBoundingClientRect();
      const token = findTokenAt(
        layout.tokens,
        event.clientX - origin.left,
        event.clientY - origin.top,
      );
      if (token) hover(token.node.id, createAnchor(token, wrapper));
      else leave();
      const line = getLineFromEvent(event.nativeEvent);
      const component = line === null ? null : getComponentAtLine(view, line);
      if (component) activate(component.name);
    },
    [wrapperRef, layout, view, activate, hover, leave],
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
      <TooltipContent anchor={anchor} className="font-mono">
        {hoveredNode && describeNode(view, hoveredNode)}
      </TooltipContent>
    </Tooltip>
  );
};

const Overlay = ({ layout }: { layout: TokenLayout }) => {
  const { colorByNodeId } = useViewer();
  return (
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
  );
};

export const SourcePane = () => {
  const view = useLoadedView();
  const isHighlighterReady = useHighlighter() !== null;
  const { colorByNodeId } = useViewer();
  const { theme } = useResolvedTheme();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [renderCount, setRenderCount] = useState(0);
  const onPostRender = useCallback(() => setRenderCount((count) => count + 1), []);
  const hasDraft = useHasDraft();
  const generation = useEditorStore((state) => state.generation);
  const setDraft = useEditorStore((state) => state.setDraft);
  const leave = useHoverStore((state) => state.leave);
  const onEditChange = useCallback<FileEditChangeHandler<undefined, undefined>>(
    (event) => setDraft(event.editor.getText()),
    [setDraft],
  );
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
  const trackPointer = usePointerTracking(wrapperRef, layout);
  return (
    <div className="h-full overflow-y-auto overflow-x-hidden overscroll-none">
      <div
        ref={wrapperRef}
        onMouseMove={hasDraft ? undefined : trackPointer}
        onMouseLeave={leave}
        className="relative min-w-0 py-1 pr-8 text-[13px]/[19px]"
      >
        {isHighlighterReady ? (
          <File
            key={`${view.file}:${generation}`}
            file={file}
            options={options}
            disableWorkerPool
            edit
            onEditChange={onEditChange}
            onEditComplete={() => "reject"}
          />
        ) : (
          <Spinner className="h-40" />
        )}
        {!hasDraft && <Overlay layout={layout} />}
        <TokenTooltip />
      </div>
    </div>
  );
};
