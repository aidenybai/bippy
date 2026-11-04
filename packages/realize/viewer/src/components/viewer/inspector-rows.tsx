import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Code } from "@/components/ui/code";
import { TableCell, TableRow } from "@/components/ui/table";
import { getTransitionLabels } from "@/lib/describe";
import { cn } from "@/lib/utils";
import {
  getUpdateKey,
  type ViewBinding,
  type ViewHandler,
  type ViewState,
  type ViewUpdate,
} from "@/model";
import { useIsDimmed } from "@/store/viewer";
import { Chip } from "./chip";
import { Domain } from "./domain";
import { useInspectorComponent } from "./inspector";

const Cell = ({ children, className }: { children: ReactNode; className?: string }) => (
  <TableCell className={cn("wrap-anywhere whitespace-normal", className)}>{children}</TableCell>
);

const Row = ({ nodeIds, children }: { nodeIds: string[]; children: ReactNode }) => {
  const isDimmed = useIsDimmed(nodeIds);
  return (
    <TableRow className="transition-opacity duration-150" style={{ opacity: isDimmed ? 0.35 : 1 }}>
      {children}
    </TableRow>
  );
};

const KEY_CELL = "w-0 wrap-normal whitespace-nowrap";

export const BindingRow = ({ binding }: { binding: ViewBinding }) => (
  <Row nodeIds={binding.nodeIds}>
    <Cell className="grid gap-1">
      <span className="w-fit">
        <Chip nodeIds={binding.nodeIds}>{binding.name}</Chip>
      </span>
      <span className="wrap-anywhere pl-1">
        <Domain binding={binding} />
        {binding.initial !== null && (
          <span>
            <span className="text-faint"> = </span>
            <Code>{binding.initial}</Code>
          </span>
        )}
        {binding.reachable && (
          <span className="text-muted-foreground"> · only {binding.reachable}</span>
        )}
      </span>
    </Cell>
  </Row>
);

const Conditions = ({ state }: { state: ViewState }) => {
  if (state.conditions.length === 0) return <span className="text-foreground">always</span>;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {state.conditions.map((condition, index) => (
        <span key={condition.text} className="flex items-center gap-1">
          {index > 0 && <span className="text-faint">∧</span>}
          <Chip nodeIds={condition.nodeIds}>
            <Code>{condition.text}</Code>
          </Chip>
        </span>
      ))}
    </div>
  );
};

export const StateRow = ({ state }: { state: ViewState }) => (
  <Row
    nodeIds={[...state.conditions.flatMap((condition) => condition.nodeIds), ...state.armNodeIds]}
  >
    <Cell className={KEY_CELL}>
      <Badge variant="outline">{state.name}</Badge>
    </Cell>
    <Cell>
      <Conditions state={state} />
      <div className="mt-1 font-mono">
        <Chip nodeIds={state.armNodeIds}>
          <Code>{state.render || "∅"}</Code>
        </Chip>
      </div>
    </Cell>
  </Row>
);

const Update = ({ update }: { update: ViewUpdate }) => (
  <div className="grid">
    {update.guard !== null && (
      <span className="text-muted-foreground">
        if <Code>{update.guard}</Code>
      </span>
    )}
    {update.assignments.map((assignment) => (
      <span key={assignment}>
        <Code>{assignment}</Code>
        {update.isAsync && <span className="text-muted-foreground"> async</span>}
      </span>
    ))}
  </div>
);

const Transitions = ({ transitions }: { transitions: string[] }) => (
  <div className="flex flex-wrap gap-1">
    {transitions.map((transition) => (
      <Badge key={transition} variant="secondary">
        {transition}
      </Badge>
    ))}
  </div>
);

export const HandlerRow = ({ handler }: { handler: ViewHandler }) => {
  const component = useInspectorComponent();
  const transitions = getTransitionLabels(component, handler.id);
  return (
    <Row nodeIds={handler.nodeIds}>
      <Cell className="grid gap-2 py-3">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <Chip nodeIds={handler.nodeIds}>
            <Code>{handler.label}</Code>
          </Chip>
          {transitions.length > 0 && <Transitions transitions={transitions} />}
        </div>
        {handler.updates.length > 0 && (
          <div className="grid gap-1.5 rounded-md bg-muted px-3 py-2 font-mono wrap-anywhere">
            {handler.updates.map((update) => (
              <Update key={getUpdateKey(update)} update={update} />
            ))}
          </div>
        )}
      </Cell>
    </Row>
  );
};
