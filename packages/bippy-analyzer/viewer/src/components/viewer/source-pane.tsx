import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type RefObject,
} from "react";
import { File } from "@pierre/diffs/react";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent } from "@/components/ui/tooltip";
import { useFileOptions } from "@/hooks/use-file-options";
import { useHighlighter } from "@/hooks/use-highlighter";
import { useIsClient } from "@/hooks/use-is-client";
import { useTokenBoxes, type PlacedToken, type TokenLayout } from "@/hooks/use-token-boxes";
import { isRestingArc, placeArcs } from "@/lib/arcs";
import { describeNode } from "@/lib/describe";
import { getComponentAtLine } from "@/lib/graph";
import { getLineFromEvent, scrollToLine, type Box } from "@/lib/positions";
import { getFileTitle } from "@/lib/source";
import type { GraphNode } from "@/model";
import { useHoverStore, type TokenAnchor } from "@/store/hover";
import { Arc, ArcHead } from "./arc";
import { useHoveredNode, useLoadedView, useViewer } from "./context";
import { TokenMark } from "./token-mark";

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
      if (!wrapper || event.buttons !== 0) return;
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

const useColoredNodes = (): GraphNode[] => {
  const view = useLoadedView();
  const { colorByNodeId } = useViewer();
  return useMemo(
    () =>
      view.components
        .flatMap((component) => component.graph.nodes)
        .filter((node) => colorByNodeId.has(node.id)),
    [view, colorByNodeId],
  );
};

const useFocusScroll = (wrapperRef: RefObject<HTMLDivElement | null>): void => {
  const view = useLoadedView();
  const focusRequest = useHoverStore((state) => state.focusRequest);
  useEffect(() => {
    const host = wrapperRef.current?.querySelector<HTMLElement>("diffs-container");
    const component = view.components.find((candidate) => candidate.name === focusRequest?.name);
    if (host && component?.loc) scrollToLine(host, component.loc.start.line);
  }, [wrapperRef, view, focusRequest]);
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
    <>
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
    </>
  );
};

const CodeView = () => {
  const view = useLoadedView();
  useHighlighter();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [renderCount, setRenderCount] = useState(0);
  const onPostRender = useCallback(() => setRenderCount((count) => count + 1), []);
  const options = useFileOptions(onPostRender);
  const file = useMemo(
    () => ({ name: getFileTitle(view.file), contents: view.source }),
    [view.file, view.source],
  );
  const layout = useTokenBoxes(wrapperRef, useColoredNodes(), renderCount);
  const trackPointer = usePointerTracking(wrapperRef, layout);
  const leave = useHoverStore((state) => state.leave);
  useFocusScroll(wrapperRef);
  return (
    <div
      ref={wrapperRef}
      className="relative min-h-full min-w-0 py-1 pr-8 text-[13px]/[19px]"
      onMouseMove={trackPointer}
      onMouseLeave={leave}
    >
      <File file={file} options={options} disableWorkerPool />
      <Overlay layout={layout} />
    </div>
  );
};

export const SourcePane = () => {
  const isClient = useIsClient();
  const spinner = <Spinner className="h-full" />;
  return (
    <div className="h-full overflow-y-auto overflow-x-hidden overscroll-none [scrollbar-gutter:stable]">
      {isClient ? <Suspense fallback={spinner}>{<CodeView />}</Suspense> : spinner}
    </div>
  );
};
