import { getArmOutcome } from "./lookup";
import type {
  ViewBinding,
  ViewBranch,
  ViewComponent,
  ViewFile,
  ViewHandler,
  ViewState,
} from "../model";

export type DiagramRow =
  | { kind: "binding"; key: string; line: number; binding: ViewBinding }
  | { kind: "handler"; key: string; line: number; handler: ViewHandler }
  | { kind: "branch"; key: string; line: number; branch: ViewBranch };

export const getDiagramRows = (component: ViewComponent): DiagramRow[] => {
  const rows: DiagramRow[] = [];
  for (const binding of component.bindings)
    if (binding.loc)
      rows.push({
        kind: "binding",
        key: `binding:${binding.id}`,
        line: binding.loc.start.line,
        binding,
      });
  for (const handler of component.handlers)
    if (handler.loc)
      rows.push({
        kind: "handler",
        key: `handler:${handler.id}`,
        line: handler.loc.start.line,
        handler,
      });
  for (const branch of component.branches)
    if (branch.loc)
      rows.push({
        kind: "branch",
        key: `branch:${branch.id}`,
        line: branch.loc.start.line,
        branch,
      });
  return rows.sort((a, b) => a.line - b.line);
};

export const getSourceLine = (view: ViewFile, line: number): string =>
  view.source.split("\n")[line - 1]?.trim() ?? "";

export const getDomainValues = (binding: ViewBinding): string[] =>
  binding.domain.split(" | ").map((value) => value.trim());

export const getArmStates = (
  component: ViewComponent,
  branch: ViewBranch,
  arm: "consequent" | "alternate",
): ViewState[] => component.states.filter((state) => getArmOutcome(branch, state) === arm);

export interface StateTransition {
  handlerId: string;
  from: number;
  to: number;
  isAsync: boolean;
}

export const getStateTransitions = (component: ViewComponent): StateTransition[] =>
  component.states.flatMap((state) =>
    state.transitions.flatMap((transition) =>
      transition.targets
        .filter((target) => target !== state.index)
        .map((target) => ({
          handlerId: transition.handlerId,
          from: state.index,
          to: target,
          isAsync: transition.isAsync,
        })),
    ),
  );
