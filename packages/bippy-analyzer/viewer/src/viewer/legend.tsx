import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import {
  getBindingNodeId,
  getConditionNodeId,
  getHandlerNodeId,
  getSolidColor,
  getStateArmNodeIds,
  getTransitions,
} from "../lib/analysis";
import type { ViewBinding, ViewHandler, ViewState } from "../model";
import { useIsDimmed, useLoadedView, useNodeColor, useViewer } from "./context";

interface ChipProps {
  nodeIds: string[];
  children: ReactNode;
}

const Chip = ({ nodeIds, children }: ChipProps) => {
  const { hoveredNodeId, hover } = useViewer();
  const [first] = nodeIds;
  const color = useNodeColor(first);
  const isDimmed = useIsDimmed(first);
  if (!first || !color) return <span>{children}</span>;
  const isHovered = hoveredNodeId !== null && nodeIds.includes(hoveredNodeId);
  return (
    <span
      data-seg={nodeIds.join(" ")}
      className="rounded-sm px-1 font-mono"
      style={{
        background: color,
        outline: isHovered ? `2px solid ${getSolidColor(color)}` : undefined,
        opacity: isDimmed ? 0.35 : 1,
      }}
      onMouseEnter={() => hover(first)}
      onMouseLeave={() => hover(null)}
    >
      {children}
    </span>
  );
};

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="grid gap-1">
    <h2 className="px-2 text-xs font-medium text-muted-foreground">{title}</h2>
    <Table>
      <TableBody>{children}</TableBody>
    </Table>
  </section>
);

const Cell = ({ children, className = "" }: { children: ReactNode; className?: string }) => (
  <TableCell className={`py-1 break-all whitespace-normal ${className}`}>{children}</TableCell>
);

const BindingRow = ({ binding }: { binding: ViewBinding }) => {
  const component = useLoadedView();
  const nodeId = getBindingNodeId(component, binding.id);
  return (
    <TableRow>
      <Cell>
        <Chip nodeIds={nodeId ? [nodeId] : []}>{binding.name}</Chip>
      </Cell>
      <Cell className="font-mono text-muted-foreground">
        {binding.domain}
        {binding.initial !== null ? ` = ${binding.initial}` : ""}
        {binding.reachable ? ` · only ${binding.reachable}` : ""}
      </Cell>
    </TableRow>
  );
};

const Conditions = ({ state }: { state: ViewState }) => {
  const component = useLoadedView();
  if (state.label === "always") return <span>always</span>;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {state.label.split(" ∧ ").map((condition, index) => {
        const nodeId = getConditionNodeId(component, condition);
        return (
          <span key={condition} className="flex items-center gap-1">
            {index > 0 && <span className="text-muted-foreground">∧</span>}
            <Chip nodeIds={nodeId ? [nodeId] : []}>{condition}</Chip>
          </span>
        );
      })}
    </div>
  );
};

const StateRow = ({ state }: { state: ViewState }) => {
  const component = useLoadedView();
  return (
    <TableRow>
      <Cell className="w-10 align-top">
        <Badge variant="outline">S{state.index + 1}</Badge>
      </Cell>
      <Cell>
        <Conditions state={state} />
        <div className="mt-1 font-mono text-muted-foreground">
          <Chip nodeIds={getStateArmNodeIds(component, state)}>{state.render || "∅"}</Chip>
        </div>
      </Cell>
    </TableRow>
  );
};

const HandlerRow = ({ handler }: { handler: ViewHandler }) => {
  const component = useLoadedView();
  const nodeId = getHandlerNodeId(component, handler.id);
  const transitions = getTransitions(component, handler.id);
  return (
    <TableRow>
      <Cell className="align-top">
        <Chip nodeIds={nodeId ? [nodeId] : []}>{handler.label}</Chip>
      </Cell>
      <Cell>
        <div className="grid gap-1 font-mono text-muted-foreground">
          {handler.updates.map((update, index) => (
            <span key={`${index}-${update.text}`}>
              sets {update.text}
              {update.isAsync ? " (async)" : ""}
            </span>
          ))}
          {transitions.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {transitions.map((transition) => (
                <Badge key={transition} variant="secondary">
                  {transition}
                </Badge>
              ))}
            </div>
          )}
        </div>
      </Cell>
    </TableRow>
  );
};

export const Legend = () => {
  const component = useLoadedView();
  return (
    <div className="grid gap-5 overflow-auto p-3 text-[13px]">
      <Section title="Data">
        {component.bindings.map((binding) => (
          <BindingRow key={binding.id} binding={binding} />
        ))}
      </Section>
      {component.regions.map((region, regionIndex) => (
        <Section
          key={region.placeNames.join(",") || regionIndex}
          title={
            component.regions.length > 1 ? `States of ${region.placeNames.join(", ")}` : "States"
          }
        >
          {region.states.map((stateIndex) => {
            const state = component.states[stateIndex];
            return state ? <StateRow key={stateIndex} state={state} /> : null;
          })}
        </Section>
      ))}
      <Section title="What can happen">
        {component.handlers.map((handler) => (
          <HandlerRow key={handler.id} handler={handler} />
        ))}
      </Section>
    </div>
  );
};
