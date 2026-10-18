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
} from "./mapping";
import type { ViewComponent } from "./model";

interface AnalysisPaneProps {
  component: ViewComponent;
  colorByNodeId: Map<string, string>;
  hoveredNodeId: string | null;
  onHover: (nodeId: string | null) => void;
}

interface ChipProps extends AnalysisPaneProps {
  nodeIds: string[];
  children: ReactNode;
}

const Chip = ({ nodeIds, children, colorByNodeId, hoveredNodeId, onHover }: ChipProps) => {
  const [first] = nodeIds;
  const color = first ? colorByNodeId.get(first) : undefined;
  if (!first || !color) return <span>{children}</span>;
  const hoveredColor = hoveredNodeId ? colorByNodeId.get(hoveredNodeId) : undefined;
  const isHovered = hoveredNodeId !== null && nodeIds.includes(hoveredNodeId);
  return (
    <span
      data-seg={nodeIds.join(" ")}
      className="rounded-sm px-1 font-mono"
      style={{
        background: color,
        outline: isHovered ? `2px solid ${getSolidColor(color)}` : undefined,
        opacity: hoveredColor && hoveredColor !== color ? 0.35 : 1,
      }}
      onMouseEnter={() => onHover(first)}
      onMouseLeave={() => onHover(null)}
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

export const AnalysisPane = (props: AnalysisPaneProps) => {
  const { component } = props;
  return (
    <div className="grid gap-5 p-3 text-[13px]">
      <Section title="Data">
        {component.bindings.map((binding) => {
          const nodeId = getBindingNodeId(component, binding.id);
          return (
            <TableRow key={binding.id}>
              <TableCell className="py-1 whitespace-normal">
                <Chip {...props} nodeIds={nodeId ? [nodeId] : []}>
                  {binding.name}
                </Chip>
              </TableCell>
              <TableCell className="py-1 font-mono whitespace-normal text-muted-foreground">
                {binding.domain}
                {binding.initial !== null ? ` = ${binding.initial}` : ""}
                {binding.reachable ? ` · only ${binding.reachable}` : ""}
              </TableCell>
            </TableRow>
          );
        })}
      </Section>
      {component.regions.map((region, regionIndex) => (
        <Section
          key={regionIndex}
          title={component.regions.length > 1 ? `States of ${region.placeNames.join(", ")}` : "States"}
        >
          {region.states.map((stateIndex) => {
            const state = component.states[stateIndex];
            if (!state) return null;
            const armNodeIds = getStateArmNodeIds(component, state);
            return (
              <TableRow key={stateIndex}>
                <TableCell className="w-10 py-1 align-top whitespace-normal">
                  <Badge variant="outline">S{stateIndex + 1}</Badge>
                </TableCell>
                <TableCell className="py-1 whitespace-normal">
                  <div className="flex flex-wrap items-center gap-x-1 gap-y-1">
                    {state.label === "always"
                      ? "always"
                      : state.label.split(" ∧ ").map((condition, index) => {
                          const nodeId = getConditionNodeId(component, condition);
                          return (
                            <span key={index} className="flex items-center gap-1">
                              {index > 0 && <span className="text-muted-foreground">∧</span>}
                              <Chip {...props} nodeIds={nodeId ? [nodeId] : []}>
                                {condition}
                              </Chip>
                            </span>
                          );
                        })}
                  </div>
                  <div className="mt-1 font-mono text-muted-foreground">
                    <Chip {...props} nodeIds={armNodeIds}>
                      {state.render || "∅"}
                    </Chip>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </Section>
      ))}
      <Section title="What can happen">
        {component.handlers.map((handler) => {
          const nodeId = getHandlerNodeId(component, handler.id);
          const transitions = getTransitions(component, handler.id);
          return (
            <TableRow key={handler.id}>
              <TableCell className="py-1 align-top whitespace-normal">
                <Chip {...props} nodeIds={nodeId ? [nodeId] : []}>
                  {handler.label}
                </Chip>
              </TableCell>
              <TableCell className="py-1 whitespace-normal">
                <div className="grid gap-1 font-mono text-muted-foreground">
                  {handler.updates.map((update, index) => (
                    <span key={index}>
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
              </TableCell>
            </TableRow>
          );
        })}
      </Section>
    </div>
  );
};
