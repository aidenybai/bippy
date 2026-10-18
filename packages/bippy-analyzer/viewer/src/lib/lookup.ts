import type { GraphNode, ViewComponent, ViewState } from "../model";
import { getArmOutcome } from "./states";

const getNode = (component: ViewComponent, suffix: string): GraphNode | undefined =>
  component.graph.nodes.find((node) => node.id === `${component.name}/${suffix}`);

export const getBindingNodeId = (component: ViewComponent, bindingId: number): string | undefined =>
  getNode(component, `binding:${bindingId}`)?.id;

export const getConditionNodeId = (
  component: ViewComponent,
  condition: string,
): string | undefined => {
  const branch = component.branches.find(
    (candidate) => candidate.test === condition || candidate.negated === condition,
  );
  return branch ? getNode(component, `branch:${branch.id}`)?.id : undefined;
};

export const getStateArmNodeIds = (component: ViewComponent, state: ViewState): string[] =>
  component.branches.flatMap((branch) => {
    const arm = getArmOutcome(branch, state);
    const node = arm && getNode(component, `arm:${branch.id}:${arm}`);
    return node ? [node.id] : [];
  });

export const getHandlerNodeId = (component: ViewComponent, handlerId: string): string | undefined =>
  component.graph.nodes.find(
    (node) => node.handlerId === handlerId && (node.kind === "trigger" || node.kind === "handler"),
  )?.id;

export const getTransitions = (component: ViewComponent, handlerId: string): string[] =>
  component.states.flatMap((state) =>
    state.transitions
      .filter((transition) => transition.handlerId === handlerId)
      .flatMap((transition) => transition.targets)
      .filter((target) => target !== state.index)
      .map((target) => `S${state.index + 1} → S${target + 1}`),
  );
