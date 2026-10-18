import type { GraphNode, ViewComponent, ViewFile } from "../model";

export const PALETTE = [
  "rgba(25, 133, 255, 0.3)",
  "rgba(174, 97, 174, 0.3)",
  "rgba(255, 97, 106, 0.3)",
  "rgba(250, 192, 61, 0.3)",
  "rgba(115, 192, 88, 0.3)",
];

export const getSolidColor = (color: string): string => color.replace(" 0.3)", " 1)");

interface ComponentColors {
  byBinding: Map<number, string>;
  byBranch: Map<number, string>;
  byHandler: Map<string, string>;
}

const getComponentColors = (component: ViewComponent): ComponentColors => {
  const byBinding = new Map<number, string>();
  component.bindings.forEach((binding, index) =>
    byBinding.set(binding.id, PALETTE[index % PALETTE.length]!),
  );
  const byBranch = new Map<number, string>();
  for (const branch of component.branches) {
    const color = branch.readsBindingIds.map((id) => byBinding.get(id)).find(Boolean);
    if (color) byBranch.set(branch.id, color);
  }
  const byHandler = new Map<string, string>();
  for (const handler of component.handlers) {
    const color = handler.updates.map((update) => byBinding.get(update.bindingId)).find(Boolean);
    if (color) byHandler.set(handler.id, color);
  }
  return { byBinding, byBranch, byHandler };
};

const getNodeColor = (node: GraphNode, colors: ComponentColors): string | undefined => {
  if (node.bindingId !== undefined) return colors.byBinding.get(node.bindingId);
  if (node.branchId !== undefined) return colors.byBranch.get(node.branchId);
  if (node.handlerId !== undefined) return colors.byHandler.get(node.handlerId);
  return undefined;
};

export const getColorByNodeId = (view: ViewFile): Map<string, string> => {
  const colorByNodeId = new Map<string, string>();
  for (const component of view.components) {
    const colors = getComponentColors(component);
    for (const node of component.graph.nodes) {
      const color = getNodeColor(node, colors);
      if (color) colorByNodeId.set(node.id, color);
    }
  }
  return colorByNodeId;
};
