import type { GraphNode, ViewComponent, ViewState } from "../model";
import { getArmOutcome } from "./states";

export const PALETTE = [
  "rgba(25, 133, 255, 0.3)",
  "rgba(174, 97, 174, 0.3)",
  "rgba(255, 97, 106, 0.3)",
  "rgba(250, 192, 61, 0.3)",
  "rgba(115, 192, 88, 0.3)",
];

export const getSolidColor = (color: string): string => color.replace(" 0.3)", " 1)");

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
    (node) =>
      node.handlerId === handlerId &&
      node.id.startsWith(`${component.name}/`) &&
      (node.kind === "trigger" || node.kind === "handler"),
  )?.id;

export const getTransitions = (component: ViewComponent, handlerId: string): string[] =>
  component.states.flatMap((state) =>
    state.transitions
      .filter((transition) => transition.handlerId === handlerId)
      .flatMap((transition) => transition.targets)
      .filter((target) => target !== state.index)
      .map((target) => `S${state.index + 1} → S${target + 1}`),
  );

export const getColorByNodeId = (component: ViewComponent): Map<string, string> => {
  const colorByBinding = new Map<number, string>();
  component.bindings.forEach((binding, index) =>
    colorByBinding.set(binding.id, PALETTE[index % PALETTE.length]!),
  );
  const colorByBranch = new Map<number, string>();
  for (const branch of component.branches) {
    const color = branch.readsBindingIds.map((id) => colorByBinding.get(id)).find(Boolean);
    if (color) colorByBranch.set(branch.id, color);
  }
  const colorByHandler = new Map<string, string>();
  for (const handler of component.handlers) {
    const color = handler.updates
      .map((update) => colorByBinding.get(update.bindingId))
      .find(Boolean);
    if (color) colorByHandler.set(handler.id, color);
  }
  const colors = new Map<string, string>();
  for (const node of component.graph.nodes) {
    if (!node.id.startsWith(`${component.name}/`)) continue;
    const color =
      node.bindingId !== undefined
        ? colorByBinding.get(node.bindingId)
        : node.branchId !== undefined
          ? colorByBranch.get(node.branchId)
          : node.handlerId !== undefined
            ? colorByHandler.get(node.handlerId)
            : undefined;
    if (color) colors.set(node.id, color);
  }
  return colors;
};
