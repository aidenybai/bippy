import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { codeToHtml } from "shiki";
import { DiagramCanvas, DiagramEdge } from "diagram";
import { getLinesBox, getLocationBox, type Box } from "./code-positions";
import type {
  ViewComponent,
  ViewHandler,
  ViewLocation,
  ViewState,
} from "./model";
import { getArmMarks, getHandlersFromState, type ArmMark } from "./state-model";

interface CodeViewProps {
  component: ViewComponent;
  selectedState: ViewState | null;
  activeHandlerId: string | null;
  onHoverHandler: (handlerId: string | null) => void;
}

interface Overlay {
  width: number;
  height: number;
  arms: Array<ArmMark & { box: Box; isSingleLine: boolean }>;
  tests: Array<{ id: number; test: string; box: Box }>;
  handlers: Array<{ handler: ViewHandler; box: Box }>;
  bindings: Array<{ id: number; name: string; box: Box }>;
}

const GUTTER_WIDTH = 128;
const PILL_WIDTH = 48;
const UPDATE_LANE_X = 58;
const READ_LANE_X = 98;
const LANE_GAP = 7;
const EDGE_END_X = GUTTER_WIDTH - 6;

const getLaneEdge = (
  fromY: number,
  toY: number,
  laneX: number
): {
  from: { x: number; y: number };
  to: { x: number; y: number };
  waypoints: { x: number; y: number }[];
} => ({
  from: { x: PILL_WIDTH + 4, y: fromY },
  to: { x: EDGE_END_X, y: toY },
  waypoints: [
    { x: laneX, y: fromY },
    { x: laneX, y: toY },
  ],
});

const ARM_FILLS: Record<ArmMark["status"], string> = {
  live: "color-mix(in oklab, var(--primary) 10%, transparent)",
  dead: "color-mix(in oklab, var(--destructive) 8%, transparent)",
  added: "color-mix(in oklab, var(--primary) 18%, transparent)",
  removed: "color-mix(in oklab, var(--destructive) 16%, transparent)",
  unchanged: "transparent",
};

const useHighlightedSource = (source: string): string => {
  const [html, setHtml] = useState("");
  useEffect(() => {
    let isCurrent = true;
    codeToHtml(source, { lang: "tsx", theme: "github-light" }).then(
      (result) => {
        if (isCurrent) setHtml(result);
      }
    );
    return () => {
      isCurrent = false;
    };
  }, [source]);
  return html;
};

const MAX_WHOLE_FILE_LINES = 60;

const getComponentSource = (
  component: ViewComponent
): { source: string; lineOffset: number } => {
  const lines = component.source.split("\n");
  if (!component.loc || lines.length <= MAX_WHOLE_FILE_LINES)
    return { source: component.source, lineOffset: 0 };
  const firstLine = component.loc.start.line;
  return {
    source: lines.slice(firstLine - 1, component.loc.end.line).join("\n"),
    lineOffset: firstLine - 1,
  };
};

const shiftLocation = (
  loc: ViewLocation,
  lineOffset: number
): ViewLocation => ({
  start: { ...loc.start, line: loc.start.line - lineOffset },
  end: { ...loc.end, line: loc.end.line - lineOffset },
});

const measureOverlay = (
  container: HTMLElement,
  component: ViewComponent,
  selectedState: ViewState | null,
  lineOffset: number
): Overlay => {
  const spanBox = (loc: ViewLocation | null): Box | null =>
    loc && getLocationBox(container, shiftLocation(loc, lineOffset));
  const linesBox = (loc: ViewLocation | null): Box | null =>
    loc && getLinesBox(container, shiftLocation(loc, lineOffset));
  const marks = selectedState ? getArmMarks(component, selectedState) : [];
  const arms = marks.flatMap((mark) => {
    const loc = mark.branch[mark.arm];
    const isSingleLine = loc?.start.line === loc?.end.line;
    const box = isSingleLine ? spanBox(loc) : linesBox(loc);
    return box ? [{ ...mark, box, isSingleLine }] : [];
  });
  const tests = component.branches.flatMap((branch) => {
    const box = spanBox(branch.loc);
    return box ? [{ id: branch.id, test: branch.test, box }] : [];
  });
  const handlers = component.handlers.flatMap((handler) => {
    const box = spanBox(handler.loc);
    return box ? [{ handler, box }] : [];
  });
  const bindings = component.bindings.flatMap((binding) => {
    const box = spanBox(binding.loc);
    return box ? [{ id: binding.id, name: binding.name, box }] : [];
  });
  return {
    width: container.scrollWidth,
    height: container.scrollHeight,
    arms,
    tests,
    handlers,
    bindings,
  };
};

const getMiddleY = (box: Box): number => box.y + box.height / 2;

interface HandlerMarkerProps {
  handler: ViewHandler;
  box: Box;
  isActive: boolean;
  isVisible: boolean;
  bindingBoxes: Map<number, Box>;
  testBoxesByBinding: Map<number, Box[]>;
  onHover: (handlerId: string | null) => void;
}

const HandlerMarker = ({
  handler,
  box,
  isActive,
  isVisible,
  bindingBoxes,
  testBoxesByBinding,
  onHover,
}: HandlerMarkerProps) => (
  <g
    opacity={isVisible ? 1 : 0.15}
    onMouseEnter={() => onHover(handler.id)}
    onMouseLeave={() => onHover(null)}
  >
    <rect
      className="pointer-events-auto cursor-pointer"
      x={4}
      y={box.y + 3}
      width={PILL_WIDTH}
      height={box.height - 6}
      rx={4}
      fill={isActive ? "var(--primary)" : "var(--background)"}
      stroke="var(--border)"
    />
    <text
      className="pointer-events-none font-mono text-[10px]"
      x={4 + PILL_WIDTH / 2}
      y={box.y + box.height / 2 + 3.5}
      textAnchor="middle"
      style={{
        fill: isActive ? "var(--primary-foreground)" : "var(--foreground)",
      }}
    >
      {handler.kind === "effect" ? "effect" : "click"}
    </text>
    {[...new Set(handler.updates.map((update) => update.bindingId))].map(
      (bindingId, index) => {
        const target = bindingBoxes.get(bindingId);
        if (!target) return null;
        return (
          <DiagramEdge
            key={bindingId}
            {...getLaneEdge(
              getMiddleY(box),
              getMiddleY(target),
              UPDATE_LANE_X + index * LANE_GAP
            )}
            kind="update"
            directed
          />
        );
      }
    )}
    {isActive &&
      [...new Set(handler.updates.map((update) => update.bindingId))].flatMap(
        (bindingId, index) => {
          const source = bindingBoxes.get(bindingId);
          if (!source) return [];
          return (testBoxesByBinding.get(bindingId) ?? []).map(
            (testBox, testIndex) => (
              <DiagramEdge
                key={`${bindingId}-${testIndex}`}
                {...getLaneEdge(
                  getMiddleY(source),
                  getMiddleY(testBox),
                  READ_LANE_X + index * LANE_GAP
                )}
                kind="data"
                directed
              />
            )
          );
        }
      )}
  </g>
);

export const CodeView = ({
  component,
  selectedState,
  activeHandlerId,
  onHoverHandler,
}: CodeViewProps) => {
  const { source, lineOffset } = getComponentSource(component);
  const html = useHighlightedSource(source);
  const containerRef = useRef<HTMLDivElement>(null);
  const [overlay, setOverlay] = useState<Overlay | null>(null);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || !html) return;
    const measure = (): void =>
      setOverlay(
        measureOverlay(container, component, selectedState, lineOffset)
      );
    measure();
    document.fonts.ready.then(measure);
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, [html, component, selectedState, lineOffset]);

  const visibleHandlerIds =
    selectedState && !activeHandlerId
      ? getHandlersFromState(component, selectedState)
      : new Set(component.handlers.map((handler) => handler.id));
  const bindingBoxes = new Map(
    overlay?.bindings.map((binding) => [binding.id, binding.box])
  );
  const testBoxesByBinding = new Map<number, Box[]>();
  for (const branch of component.branches)
    for (const bindingId of branch.readsBindingIds) {
      const box = overlay?.tests.find((test) => test.id === branch.id)?.box;
      if (box)
        testBoxesByBinding.set(bindingId, [
          ...(testBoxesByBinding.get(bindingId) ?? []),
          box,
        ]);
    }

  return (
    <div className="overflow-auto">
      <div
        className="relative min-w-full w-max py-4 pr-6 [&_pre]:m-0 [&_pre]:bg-transparent! [&_pre]:font-mono [&_pre]:text-xs [&_pre]:leading-5 [&_.line]:inline-block [&_.line]:min-w-full"
        style={{ paddingLeft: GUTTER_WIDTH + 4 }}
        ref={containerRef}
      >
        <div dangerouslySetInnerHTML={{ __html: html }} />
        {overlay && (
          <DiagramCanvas
            className="pointer-events-none absolute inset-0 overflow-visible"
            width={overlay.width}
            height={overlay.height}
            label={`${component.name} dataflow`}
          >
            {overlay.arms.map((arm) => (
              <rect
                key={`${arm.branch.id}-${arm.arm}`}
                x={arm.isSingleLine ? arm.box.x - 2 : 0}
                y={arm.box.y}
                width={arm.isSingleLine ? arm.box.width + 4 : overlay.width}
                height={arm.box.height}
                rx={arm.isSingleLine ? 3 : 0}
                fill={ARM_FILLS[arm.status]}
              />
            ))}
            {overlay.tests.map((test) => (
              <rect
                key={test.id}
                x={test.box.x}
                y={test.box.y + test.box.height - 2}
                width={test.box.width}
                height={2}
                fill="var(--foreground)"
                opacity={0.5}
              >
                <title>{test.test}</title>
              </rect>
            ))}
            {overlay.handlers.map(({ handler, box }) => (
              <HandlerMarker
                key={handler.id}
                handler={handler}
                box={box}
                isActive={activeHandlerId === handler.id}
                isVisible={visibleHandlerIds.has(handler.id)}
                bindingBoxes={bindingBoxes}
                testBoxesByBinding={testBoxesByBinding}
                onHover={onHoverHandler}
              />
            ))}
          </DiagramCanvas>
        )}
      </div>
    </div>
  );
};
