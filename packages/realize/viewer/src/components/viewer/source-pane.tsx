import { Suspense, useId, useRef, useState, type MouseEvent, type RefObject } from "react";
import { File } from "@pierre/diffs/react";
import { Spinner } from "@/components/ui/spinner";
import { useFileOptions } from "@/hooks/use-file-options";
import { useHighlighter } from "@/hooks/use-highlighter";
import { useIsClient } from "@/hooks/use-is-client";
import { useTokenBoxes, type PlacedToken } from "@/hooks/use-token-boxes";
import { isRestingArc, placeArcs } from "@/lib/arcs";
import { getComponentAtLine } from "@/lib/graph";
import { getLineFromEvent, scrollToLine, type Box } from "@/lib/positions";
import { getFileTitle } from "@/lib/source";
import type { GraphNode } from "@/model";
import { useFocusListener, useViewerStore } from "@/store/viewer";
import { Arc } from "./arc";
import { ArrowMarker } from "./arrow-marker";
import { useViewer } from "./context";
import { TokenMark } from "./token-mark";

const contains = (box: Box, x: number, y: number): boolean =>
  x >= box.x - 2 && x <= box.x + box.width + 2 && y >= box.y && y <= box.y + box.height;

const findTokenAt = (tokens: PlacedToken[], x: number, y: number): PlacedToken | null =>
  tokens.find((token) => !token.isMultiLine && token.rows.some((row) => contains(row, x, y))) ??
  null;

const usePointerTracking = (
  wrapperRef: RefObject<HTMLDivElement | null>,
  tokens: PlacedToken[],
): ((event: MouseEvent) => void) => {
  const { view } = useViewer();
  const activate = useViewerStore((state) => state.activate);
  const hover = useViewerStore((state) => state.hover);
  const leave = useViewerStore((state) => state.leave);
  return (event: MouseEvent) => {
    const wrapper = wrapperRef.current;
    if (!wrapper || event.buttons !== 0) return;
    const origin = wrapper.getBoundingClientRect();
    const token = findTokenAt(tokens, event.clientX - origin.left, event.clientY - origin.top);
    if (token) hover(token.node.id);
    else leave();
    const line = getLineFromEvent(event.nativeEvent);
    const component = line === null ? null : getComponentAtLine(view, line);
    if (component) activate(component.name);
  };
};

const useColoredNodes = (): GraphNode[] => {
  const { view, colorByNodeId } = useViewer();
  return view.components
    .flatMap((component) => component.graph.nodes)
    .filter((node) => colorByNodeId.has(node.id));
};

const useFocusScroll = (wrapperRef: RefObject<HTMLDivElement | null>): void => {
  const { view } = useViewer();
  useFocusListener((name) => {
    const host = wrapperRef.current?.querySelector<HTMLElement>("diffs-container");
    const component = view.components.find((candidate) => candidate.name === name);
    if (host && component?.loc) scrollToLine(host, component.loc.start.line);
  });
};

interface ArcsProps {
  tokens: PlacedToken[];
  markerId: string;
}

const RestingArcs = ({ tokens, markerId }: ArcsProps) => {
  const { view, colorByNodeId } = useViewer();
  const arcs = placeArcs(view, tokens, colorByNodeId, isRestingArc);
  return arcs.map((arc) => (
    <Arc key={`${arc.edge.from}-${arc.edge.to}`} markerId={markerId} {...arc} />
  ));
};

const CausalArcs = ({ tokens, markerId }: ArcsProps) => {
  const { view, colorByNodeId } = useViewer();
  const causalNodeIds = useViewerStore((state) => state.causalNodeIds);
  const arcs =
    causalNodeIds === null
      ? []
      : placeArcs(
          view,
          tokens,
          colorByNodeId,
          (edge) =>
            !isRestingArc(edge) && causalNodeIds.has(edge.from) && causalNodeIds.has(edge.to),
        );
  return arcs.map((arc) => (
    <Arc key={`${arc.edge.from}-${arc.edge.to}`} markerId={markerId} {...arc} />
  ));
};

const getRowKey = (row: Box): string => `${row.x}-${row.y}-${row.width}`;

const getFocusRows = (tokens: PlacedToken[], nodeIds: Set<string> | null): Box[] => {
  const rows = tokens
    .filter((token) => nodeIds?.has(token.node.id) && token.node.kind !== "handler")
    .flatMap((token) => token.rows);
  return [...new Map(rows.map((row) => [getRowKey(row), row])).values()];
};

const FocusScrim = ({ tokens }: { tokens: PlacedToken[] }) => {
  const maskId = useId();
  const causalNodeIds = useViewerStore((state) => state.causalNodeIds);
  const [focusNodeIds, setFocusNodeIds] = useState(causalNodeIds);
  if (causalNodeIds !== null && causalNodeIds !== focusNodeIds) setFocusNodeIds(causalNodeIds);
  return (
    <g
      className="transition-opacity duration-150"
      style={{ opacity: causalNodeIds === null ? 0 : 1 }}
    >
      <mask id={maskId}>
        <rect width="100%" height="100%" fill="white" />
        {getFocusRows(tokens, focusNodeIds).map((row) => (
          <rect
            key={getRowKey(row)}
            x={row.x - 2}
            y={row.y}
            width={row.width + 4}
            height={row.height}
            rx={2}
            fill="black"
          />
        ))}
      </mask>
      <rect
        width="100%"
        height="100%"
        style={{ fill: "var(--color-background)" }}
        fillOpacity={0.6}
        mask={`url(#${maskId})`}
      />
    </g>
  );
};

const Overlay = ({ tokens }: { tokens: PlacedToken[] }) => {
  const { colorByNodeId } = useViewer();
  const markerId = useId();
  return (
    <svg
      className="pointer-events-none absolute inset-0 overflow-hidden"
      width="100%"
      height="100%"
    >
      <defs>
        <ArrowMarker id={`${markerId}solid`} size={7} />
        <ArrowMarker id={`${markerId}hollow`} size={7} isHollow />
      </defs>
      <FocusScrim tokens={tokens} />
      {tokens.map((token) => (
        <TokenMark
          key={token.node.id}
          {...token}
          color={colorByNodeId.get(token.node.id) ?? "transparent"}
        />
      ))}
      <RestingArcs tokens={tokens} markerId={markerId} />
      <CausalArcs tokens={tokens} markerId={markerId} />
    </svg>
  );
};

const CodeView = () => {
  const { view } = useViewer();
  useHighlighter();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [renderCount, setRenderCount] = useState(0);
  const options = useFileOptions(() => setRenderCount((count) => count + 1));
  const file = { name: getFileTitle(view.file), contents: view.source };
  const tokens = useTokenBoxes(wrapperRef, useColoredNodes(), renderCount);
  const trackPointer = usePointerTracking(wrapperRef, tokens);
  const leave = useViewerStore((state) => state.leave);
  useFocusScroll(wrapperRef);
  return (
    <div
      ref={wrapperRef}
      className="relative min-h-full min-w-0 py-1 pr-4 text-[13px]/[19px] sm:pr-8"
      onMouseMove={trackPointer}
      onMouseLeave={leave}
    >
      <File file={file} options={options} disableWorkerPool />
      <Overlay tokens={tokens} />
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
