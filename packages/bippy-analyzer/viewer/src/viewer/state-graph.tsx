import { useMemo } from "react";
import { getSolidColor } from "../lib/colors";
import { getStateTransitions, type StateTransition } from "../lib/diagram";
import { getHandlerNodeId } from "../lib/lookup";
import type { ViewComponent } from "../model";
import { useHoverStore } from "../store/hover";
import { useViewer } from "./context";

const NODE_GAP = 84;
const NODE_RADIUS = 14;
const PADDING = 24;
const BASELINE = 72;

const getNodeX = (index: number): number => PADDING + NODE_RADIUS + index * NODE_GAP;

const getArcPath = ({ from, to }: StateTransition): string => {
  const x1 = getNodeX(from);
  const x2 = getNodeX(to);
  const lift = Math.min(56, 14 + Math.abs(to - from) * 14);
  const isForward = to > from;
  const y = isForward ? BASELINE - NODE_RADIUS : BASELINE + NODE_RADIUS;
  const control = isForward ? y - lift : y + lift;
  return `M ${x1} ${y} C ${x1} ${control}, ${x2} ${control}, ${x2} ${y}`;
};

const TransitionArc = ({
  transition,
  component,
}: {
  transition: StateTransition;
  component: ViewComponent;
}) => {
  const { colorByNodeId, index } = useViewer();
  const nodeId = getHandlerNodeId(component, transition.handlerId);
  const color = nodeId ? colorByNodeId.get(nodeId) : undefined;
  const isMuted = useHoverStore((state) => {
    if (state.hoveredNodeId === null) return false;
    const hovered = index?.nodes.get(state.hoveredNodeId);
    return hovered?.handlerId !== transition.handlerId;
  });
  return (
    <path
      d={getArcPath(transition)}
      fill="none"
      stroke={color ? getSolidColor(color) : "var(--faint)"}
      strokeWidth={1.25}
      strokeDasharray={transition.isAsync ? "4 3" : undefined}
      opacity={isMuted ? 0.15 : 0.8}
      markerEnd="url(#state-arrow)"
    />
  );
};

export const StateGraph = ({ component }: { component: ViewComponent }) => {
  const transitions = useMemo(() => getStateTransitions(component), [component]);
  const width = PADDING * 2 + NODE_RADIUS * 2 + Math.max(0, component.states.length - 1) * NODE_GAP;
  if (component.states.length < 2) return null;
  return (
    <svg width={width} height={BASELINE * 2} className="shrink-0" aria-hidden="true">
      <defs>
        <marker
          id="state-arrow"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
        </marker>
      </defs>
      {transitions.map((transition) => (
        <TransitionArc
          key={`${transition.handlerId}:${transition.from}:${transition.to}`}
          transition={transition}
          component={component}
        />
      ))}
      {component.states.map((state) => (
        <g key={state.index} transform={`translate(${getNodeX(state.index)} ${BASELINE})`}>
          <circle r={NODE_RADIUS} fill="var(--well)" stroke="var(--rule)" />
          <text
            textAnchor="middle"
            dominantBaseline="central"
            className="fill-foreground font-mono text-[11px]"
          >
            S{state.index + 1}
          </text>
        </g>
      ))}
    </svg>
  );
};
