import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Code } from "@/components/ui/code";
import { getArmStates, type DiagramRow } from "../lib/diagram";
import {
  getBindingNodeId,
  getConditionNodeId,
  getHandlerNodeId,
  getTransitions,
} from "../lib/lookup";
import type { ViewBinding, ViewBranch, ViewComponent, ViewHandler, ViewState } from "../model";
import { Chip } from "./chip";
import { Domain } from "./domain";

const Row = ({ children }: { children: ReactNode }) => (
  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">{children}</div>
);

const Arrow = () => <ArrowRight className="size-3.5 shrink-0 text-faint" aria-hidden="true" />;

const StateBadges = ({ states }: { states: ViewState[] }) =>
  states.length === 0 ? (
    <span className="text-faint">never</span>
  ) : (
    states.map((state) => (
      <Badge key={state.index} variant="outline">
        S{state.index + 1}
      </Badge>
    ))
  );

const ValuePill = ({ value, isInitial }: { value: string; isInitial: boolean }) => (
  <span
    className={
      isInitial
        ? "rounded-sm bg-foreground/90 px-1.5 py-px text-background"
        : "rounded-sm bg-muted px-1.5 py-px"
    }
  >
    <Code className={isInitial ? "[&>span]:text-background!" : undefined}>{value}</Code>
  </span>
);

const BindingRow = ({ binding, component }: { binding: ViewBinding; component: ViewComponent }) => {
  const nodeId = getBindingNodeId(component, binding.id);
  return (
    <Row>
      <Chip nodeIds={nodeId ? [nodeId] : []}>{binding.name}</Chip>
      <span className="text-faint">∈</span>
      <Domain
        binding={binding}
        renderValue={(value) => <ValuePill value={value} isInitial={value === binding.initial} />}
      />
      {binding.reachable && (
        <span className="text-muted-foreground">· only {binding.reachable}</span>
      )}
    </Row>
  );
};

const HandlerRow = ({ handler, component }: { handler: ViewHandler; component: ViewComponent }) => {
  const nodeId = getHandlerNodeId(component, handler.id);
  const transitions = getTransitions(component, handler.id);
  return (
    <Row>
      <Chip nodeIds={nodeId ? [nodeId] : []}>
        <Code>{handler.label}</Code>
      </Chip>
      <Arrow />
      {handler.updates.map((update) => (
        <span
          key={`${update.guard}:${update.assignments.join(",")}`}
          className="rounded-sm bg-muted px-1.5 py-px wrap-anywhere"
        >
          {update.guard !== null && (
            <span className="text-muted-foreground">if {update.guard}: </span>
          )}
          <Code>{update.assignments.join(", ")}</Code>
          {update.isAsync && <span className="text-muted-foreground"> async</span>}
        </span>
      ))}
      {transitions.length > 0 && <Arrow />}
      {transitions.map((transition) => (
        <Badge key={transition} variant="secondary">
          {transition}
        </Badge>
      ))}
    </Row>
  );
};

const BranchRow = ({ branch, component }: { branch: ViewBranch; component: ViewComponent }) => {
  const nodeId = getConditionNodeId(component, branch.test);
  return (
    <Row>
      <Chip nodeIds={nodeId ? [nodeId] : []}>
        <Code>{branch.test}</Code>
      </Chip>
      <span className="inline-flex items-center gap-1.5">
        <span className="text-muted-foreground">✓</span>
        <StateBadges states={getArmStates(component, branch, "consequent")} />
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="text-muted-foreground">✗</span>
        <StateBadges states={getArmStates(component, branch, "alternate")} />
      </span>
    </Row>
  );
};

export const DiagramRowView = ({
  row,
  component,
}: {
  row: DiagramRow;
  component: ViewComponent;
}) => {
  switch (row.kind) {
    case "binding":
      return <BindingRow binding={row.binding} component={component} />;
    case "handler":
      return <HandlerRow handler={row.handler} component={component} />;
    case "branch":
      return <BranchRow branch={row.branch} component={component} />;
  }
};
