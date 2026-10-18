import type { GraphNode, ViewComponent, ViewState } from "./model";
import { getArmOutcome } from "./state-model";

export const PALETTE = [
  "rgba(25, 133, 255, 0.3)",
  "rgba(174, 97, 174, 0.3)",
  "rgba(255, 97, 106, 0.3)",
  "rgba(250, 192, 61, 0.3)",
  "rgba(115, 192, 88, 0.3)",
];

export const getSolidColor = (color: string): string => color.replace(" 0.3)", " 1)");

export interface Segment {
  text: string;
  nodeId?: string;
}

export interface AnalysisLine {
  indent: number;
  segments: Segment[];
  armNodeIds?: string[];
}

const getNode = (component: ViewComponent, suffix: string): GraphNode | undefined =>
  component.graph.nodes.find((node) => node.id === `${component.name}/${suffix}`);

const getBranchNode = (component: ViewComponent, condition: string): GraphNode | undefined => {
  const branch = component.branches.find(
    (candidate) => candidate.test === condition || candidate.negated === condition,
  );
  return branch ? getNode(component, `branch:${branch.id}`) : undefined;
};

const getLiveArmNodes = (component: ViewComponent, state: ViewState): GraphNode[] =>
  component.branches.flatMap((branch) => {
    const arm = getArmOutcome(branch, state);
    const node = arm && getNode(component, `arm:${branch.id}:${arm}`);
    return node ? [node] : [];
  });

const getHandlerNode = (component: ViewComponent, handlerId: string): GraphNode | undefined =>
  component.graph.nodes.find(
    (node) =>
      node.handlerId === handlerId &&
      node.id.startsWith(`${component.name}/`) &&
      (node.kind === "trigger" || node.kind === "handler"),
  );

const formatTransitions = (component: ViewComponent, handlerId: string): string => {
  const moves = component.states.flatMap((state) =>
    state.transitions
      .filter((transition) => transition.handlerId === handlerId)
      .flatMap((transition) => transition.targets)
      .filter((target) => target !== state.index)
      .map((target) => `S${state.index + 1} → S${target + 1}`),
  );
  return moves.join("  ");
};

const getDataLines = (component: ViewComponent): AnalysisLine[] => [
  { indent: 0, segments: [{ text: "data" }] },
  ...component.bindings.map((binding) => ({
    indent: 1,
    segments: [
      { text: binding.name, nodeId: getNode(component, `binding:${binding.id}`)?.id },
      { text: `  ${binding.domain}${binding.initial !== null ? ` = ${binding.initial}` : ""}` },
      ...(binding.reachable ? [{ text: `  only ${binding.reachable}` }] : []),
    ],
  })),
];

const getConditionSegments = (component: ViewComponent, state: ViewState): Segment[] =>
  state.label === "always"
    ? [{ text: "always" }]
    : state.label.split(" ∧ ").flatMap((condition, index) => [
        ...(index > 0 ? [{ text: " ∧ " }] : []),
        { text: condition, nodeId: getBranchNode(component, condition)?.id },
      ]);

const getStateLines = (component: ViewComponent): AnalysisLine[] =>
  component.regions.flatMap((region, regionIndex) => [
    {
      indent: 0,
      segments: [
        { text: component.regions.length > 1 ? `states of ${region.placeNames.join(", ")}` : "states" },
      ],
    },
    ...region.states.flatMap((stateIndex) => {
      const state = component.states[stateIndex];
      if (!state) return [];
      const arms = getLiveArmNodes(component, state);
      return [
        {
          indent: 1,
          segments: [{ text: `S${stateIndex + 1}  ` }, ...getConditionSegments(component, state)],
        },
        {
          indent: 2,
          segments: [{ text: state.render || "∅", nodeId: arms[0]?.id }],
          armNodeIds: arms.map((arm) => arm.id),
        },
      ];
    }),
    ...(regionIndex < component.regions.length - 1 ? [{ indent: 0, segments: [{ text: "" }] }] : []),
  ]);

const getHandlerLines = (component: ViewComponent): AnalysisLine[] => [
  { indent: 0, segments: [{ text: "what can happen" }] },
  ...component.handlers.map((handler) => ({
    indent: 1,
    segments: [
      { text: handler.label, nodeId: getHandlerNode(component, handler.id)?.id },
      {
        text: `  ${handler.updates.map((update) => `sets ${update.text}${update.isAsync ? " (async)" : ""}`).join(", ")}`,
      },
      { text: `  ${formatTransitions(component, handler.id)}` },
    ],
  })),
];

export const getAnalysisLines = (component: ViewComponent): AnalysisLine[] => [
  ...getDataLines(component),
  { indent: 0, segments: [{ text: "" }] },
  ...getStateLines(component),
  { indent: 0, segments: [{ text: "" }] },
  ...getHandlerLines(component),
];

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
    const color = handler.updates.map((update) => colorByBinding.get(update.bindingId)).find(Boolean);
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
