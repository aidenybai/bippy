import {
  Suspense,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
  type RefObject,
} from "react";
import { File } from "@pierre/diffs/react";
import { Spinner } from "@/components/ui/spinner";
import { useFileOptions } from "@/hooks/use-file-options";
import { useHighlighter } from "@/hooks/use-highlighter";
import { useIsClient } from "@/hooks/use-is-client";
import { useTokenBoxes, type PlacedToken, type TokenLayout } from "@/hooks/use-token-boxes";
import { isRestingArc, placeArcs } from "@/lib/arcs";
import { getComponentAtLine } from "@/lib/graph";
import {
  createLineLookup,
  getLineFromEvent,
  getRangeRows,
  scrollToLine,
  type Box,
} from "@/lib/positions";
import { getFileTitle } from "@/lib/source";
import type { GraphNode } from "@/model";
import { useFocusListener, useHasHover, useViewerStore } from "@/store/viewer";
import { Arc } from "./arc";
import { useViewer } from "./context";
import { TokenMark } from "./token-mark";

const contains = (box: Box, x: number, y: number): boolean =>
  x >= box.x - 2 && x <= box.x + box.width + 2 && y >= box.y && y <= box.y + box.height;

const findTokenAt = (tokens: PlacedToken[], x: number, y: number): PlacedToken | null =>
  tokens.find((token) => token.rows.some((row) => contains(row, x, y))) ?? null;

const usePointerTracking = (
  wrapperRef: RefObject<HTMLDivElement | null>,
  layout: TokenLayout,
): ((event: MouseEvent) => void) => {
  const { view } = useViewer();
  const activate = useViewerStore((state) => state.activate);
  const hover = useViewerStore((state) => state.hover);
  const leave = useViewerStore((state) => state.leave);
  return (event: MouseEvent) => {
    const wrapper = wrapperRef.current;
    if (!wrapper || event.buttons !== 0) return;
    const origin = wrapper.getBoundingClientRect();
    const token = findTokenAt(
      layout.tokens,
      event.clientX - origin.left,
      event.clientY - origin.top,
    );
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

const RestingArcs = ({ layout }: { layout: TokenLayout }) => {
  const { view, colorByNodeId } = useViewer();
  const arcs = placeArcs(view, layout.tokens, colorByNodeId, isRestingArc);
  return arcs.map((arc) => <Arc key={`${arc.edge.from}-${arc.edge.to}`} {...arc} />);
};

const CausalArcs = ({ layout }: { layout: TokenLayout }) => {
  const { view, colorByNodeId } = useViewer();
  const causalNodeIds = useViewerStore((state) => state.causalNodeIds);
  const arcs =
    causalNodeIds === null
      ? []
      : placeArcs(
          view,
          layout.tokens,
          colorByNodeId,
          (edge) =>
            !isRestingArc(edge) && causalNodeIds.has(edge.from) && causalNodeIds.has(edge.to),
        );
  return arcs.map((arc) => <Arc key={`${arc.edge.from}-${arc.edge.to}`} {...arc} />);
};

interface OverlayProps {
  wrapperRef: RefObject<HTMLDivElement | null>;
  layout: TokenLayout;
}

const useFocusRows = (wrapperRef: RefObject<HTMLDivElement | null>, layout: TokenLayout): Box[] => {
  const index = useViewerStore((state) => state.index);
  const causalNodeIds = useViewerStore((state) => state.causalNodeIds);
  const [rows, setRows] = useState<Box[]>([]);
  useLayoutEffect(() => {
    const wrapper = wrapperRef.current;
    const host = wrapper?.querySelector<HTMLElement>("diffs-container");
    if (!wrapper || !host || causalNodeIds === null) return;
    const lookup = createLineLookup(host, wrapper);
    const rowByKey = new Map<string, Box>();
    for (const nodeId of causalNodeIds) {
      const node = index.nodes.get(nodeId);
      if (!node || node.kind === "handler") continue;
      for (const row of getRangeRows(lookup, node.loc))
        rowByKey.set(`${row.x}-${row.y}-${row.width}`, row);
    }
    setRows([...rowByKey.values()]);
  }, [wrapperRef, index, causalNodeIds, layout]);
  return rows;
};

const FocusScrim = ({ wrapperRef, layout }: OverlayProps) => {
  const maskId = useId();
  const hasHover = useHasHover();
  const rows = useFocusRows(wrapperRef, layout);
  return (
    <g className="transition-opacity duration-150" style={{ opacity: hasHover ? 1 : 0 }}>
      <mask id={maskId}>
        <rect width={layout.width} height={layout.height} fill="white" />
        {rows.map((row) => (
          <rect
            key={`${row.x}-${row.y}-${row.width}`}
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
        width={layout.width}
        height={layout.height}
        style={{ fill: "var(--color-background)" }}
        fillOpacity={0.6}
        mask={`url(#${maskId})`}
      />
    </g>
  );
};

const Overlay = ({ wrapperRef, layout }: OverlayProps) => {
  const { colorByNodeId } = useViewer();
  return (
    <svg
      className="pointer-events-none absolute inset-0 overflow-hidden"
      width={layout.width}
      height={layout.height}
    >
      <FocusScrim wrapperRef={wrapperRef} layout={layout} />
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

const CodeView = () => {
  const { view } = useViewer();
  useHighlighter();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [renderCount, setRenderCount] = useState(0);
  const options = useFileOptions(() => setRenderCount((count) => count + 1));
  const file = { name: getFileTitle(view.file), contents: view.source };
  const layout = useTokenBoxes(wrapperRef, useColoredNodes(), renderCount);
  const trackPointer = usePointerTracking(wrapperRef, layout);
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
      <Overlay wrapperRef={wrapperRef} layout={layout} />
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
