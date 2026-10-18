import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
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
import type { ViewBinding, ViewHandler, ViewState, ViewUpdate } from "../model";
import { useIsDimmed, useLoadedComponent, useNodeColor, useViewer } from "./context";

interface ChipProps {
  nodeIds: string[];
  children: ReactNode;
}

const Chip = ({ nodeIds, children }: ChipProps) => {
  const { hoveredNodeId, hover } = useViewer();
  const [first] = nodeIds;
  const color = useNodeColor(first);
  const isDimmed = useIsDimmed(nodeIds);
  if (!first || !color) return <span>{children}</span>;
  const isHovered = hoveredNodeId !== null && nodeIds.includes(hoveredNodeId);
  return (
    <span
      data-seg={nodeIds.join(" ")}
      className="rounded-sm px-[5px] py-px font-mono text-foreground transition-opacity duration-150"
      style={{
        background: color,
        boxShadow: isHovered ? `0 0 0 1.5px ${getSolidColor(color)}` : undefined,
        opacity: isDimmed ? 0.35 : 1,
      }}
      onMouseEnter={() => hover(first)}
      onMouseLeave={() => hover(null)}
    >
      {children}
    </span>
  );
};

interface SectionProps {
  title: string;
  count: number;
  children: ReactNode;
}

const Section = ({ title, count, children }: SectionProps) => (
  <section className="grid gap-2">
    <header className="flex items-center gap-3">
      <h2 className="font-medium text-text-2">{title}</h2>
      <span className="h-px flex-1 bg-border" />
    </header>
    {count === 0 ? (
      <p className="text-faint">None</p>
    ) : (
      <Table className="[&>tbody>tr:first-child]:border-t-0 [&>tbody>tr:last-child]:border-b-0">
        <TableBody>{children}</TableBody>
      </Table>
    )}
  </section>
);

const Cell = ({ children, className }: { children: ReactNode; className?: string }) => (
  <TableCell className={cn("wrap-anywhere whitespace-normal", className)}>{children}</TableCell>
);

const KEY_CELL = "w-0 wrap-normal whitespace-nowrap";

const BindingRow = ({ binding }: { binding: ViewBinding }) => {
  const component = useLoadedComponent();
  const nodeId = getBindingNodeId(component, binding.id);
  return (
    <TableRow>
      <Cell className={KEY_CELL}>
        <Chip nodeIds={nodeId ? [nodeId] : []}>{binding.name}</Chip>
      </Cell>
      <Cell className="font-mono">
        {binding.domain}
        {binding.initial !== null ? ` = ${binding.initial}` : ""}
        {binding.reachable ? ` · only ${binding.reachable}` : ""}
      </Cell>
    </TableRow>
  );
};

const Conditions = ({ state }: { state: ViewState }) => {
  const component = useLoadedComponent();
  if (state.label === "always") return <span className="text-foreground">always</span>;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {state.label.split(" ∧ ").map((condition, index) => {
        const nodeId = getConditionNodeId(component, condition);
        return (
          <span key={condition} className="flex items-center gap-1">
            {index > 0 && <span className="text-faint">∧</span>}
            <Chip nodeIds={nodeId ? [nodeId] : []}>{condition}</Chip>
          </span>
        );
      })}
    </div>
  );
};

const StateRow = ({ state }: { state: ViewState }) => {
  const component = useLoadedComponent();
  return (
    <TableRow>
      <Cell className={KEY_CELL}>
        <Badge variant="outline">S{state.index + 1}</Badge>
      </Cell>
      <Cell>
        <Conditions state={state} />
        <div className="mt-1 font-mono">
          <Chip nodeIds={getStateArmNodeIds(component, state)}>{state.render || "∅"}</Chip>
        </div>
      </Cell>
    </TableRow>
  );
};

const Update = ({ update }: { update: ViewUpdate }) => (
  <div className="grid">
    {update.guard !== null && <span className="text-muted-foreground">if {update.guard}</span>}
    {update.assignments.map((assignment) => (
      <span key={assignment}>
        {assignment}
        {update.isAsync && <span className="text-muted-foreground"> async</span>}
      </span>
    ))}
  </div>
);

const HandlerRow = ({ handler }: { handler: ViewHandler }) => {
  const component = useLoadedComponent();
  const nodeId = getHandlerNodeId(component, handler.id);
  const transitions = getTransitions(component, handler.id);
  return (
    <TableRow>
      <Cell className="grid gap-2 py-3">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <Chip nodeIds={nodeId ? [nodeId] : []}>{handler.label}</Chip>
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
        <div className="grid gap-1.5 rounded-md bg-muted px-3 py-2 font-mono">
          {handler.updates.map((update) => (
            <Update key={`${update.guard}:${update.assignments.join(",")}`} update={update} />
          ))}
        </div>
      </Cell>
    </TableRow>
  );
};

export const Legend = () => {
  const component = useLoadedComponent();
  return (
    <div className="grid content-start gap-6 overflow-auto px-5 py-4">
      <h1 className="font-medium text-text-2">{component.name}</h1>
      <Section title="State variables" count={component.bindings.length}>
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
          count={region.states.length}
        >
          {region.states.map((stateIndex) => {
            const state = component.states[stateIndex];
            return state ? <StateRow key={stateIndex} state={state} /> : null;
          })}
        </Section>
      ))}
      <Section title="Actions" count={component.handlers.length}>
        {component.handlers.map((handler) => (
          <HandlerRow key={handler.id} handler={handler} />
        ))}
      </Section>
    </div>
  );
};
