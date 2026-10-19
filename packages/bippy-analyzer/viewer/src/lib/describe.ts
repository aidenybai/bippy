import type {
  GraphNode,
  ViewBinding,
  ViewBranch,
  ViewComponent,
  ViewFile,
  ViewLocation,
  ViewState,
  ViewUpdate,
} from "@/model";
import { getComponentName } from "./graph";
import { getTransitions, getArmOutcome } from "./lookup";

const formatStateList = (states: ViewState[]): string =>
  states.map((state) => `S${state.index + 1}`).join(", ");

const getSourceText = (view: ViewFile, loc: ViewLocation): string =>
  view.source.slice(loc.start.index, loc.end.index).replace(/\s+/g, " ");

const formatUpdate = (update: ViewUpdate): string =>
  `${update.guard !== null ? `if ${update.guard}: ` : ""}${update.assignments.join(", ")}${
    update.isAsync ? " async" : ""
  }`;

const DOMAIN_PREVIEW = 8;

const summarizeDomain = (domain: string): string => {
  const values = domain.split(" | ");
  if (values.length <= DOMAIN_PREVIEW + 1) return domain;
  return `${values.slice(0, DOMAIN_PREVIEW).join(" | ")} … +${values.length - DOMAIN_PREVIEW}`;
};

const describeBinding = (component: ViewComponent, binding: ViewBinding): string => {
  const setters = component.handlers.filter((handler) =>
    handler.updates.some((update) => update.bindingId === binding.id),
  ).length;
  const parts = [`${binding.name}: ${summarizeDomain(binding.domain)}`];
  if (binding.reachable) parts.push(`only ${binding.reachable}`);
  parts.push(setters === 0 ? "never set" : `set by ${setters} action${setters === 1 ? "" : "s"}`);
  return parts.join(" · ");
};

const describeWrite = (component: ViewComponent, node: GraphNode): string => {
  const handler = component.handlers.find((candidate) => candidate.id === node.handlerId);
  const updates = handler?.updates.filter((update) => update.bindingId === node.bindingId) ?? [];
  return updates.length === 0 ? node.label : updates.map(formatUpdate).join(" · ");
};

const describeHandler = (component: ViewComponent, node: GraphNode): string => {
  const transitions = node.handlerId === undefined ? [] : getTransitions(component, node.handlerId);
  return `${node.label} · ${transitions.length === 0 ? "no state change" : transitions.join(", ")}`;
};

const describeBranch = (view: ViewFile, component: ViewComponent, branch: ViewBranch): string => {
  const test = branch.loc ? getSourceText(view, branch.loc) : branch.test;
  const trueIn = component.states.filter((state) => getArmOutcome(branch, state) === "consequent");
  const falseIn = component.states.filter((state) => getArmOutcome(branch, state) === "alternate");
  const parts = [test];
  if (trueIn.length > 0) parts.push(`true in ${formatStateList(trueIn)}`);
  if (falseIn.length > 0) parts.push(`false in ${formatStateList(falseIn)}`);
  return parts.join(" · ");
};

const describeArm = (
  view: ViewFile,
  component: ViewComponent,
  branch: ViewBranch,
  node: GraphNode,
): string => {
  if (branch.never === node.arm) return "never rendered";
  const test = branch.loc ? getSourceText(view, branch.loc) : branch.test;
  const when = node.arm === "consequent" ? test : `not ${test}`;
  const states = component.states.filter((state) => getArmOutcome(branch, state) === node.arm);
  return states.length === 0
    ? `when ${when}`
    : `rendered in ${formatStateList(states)} · when ${when}`;
};

export const describeNode = (view: ViewFile, node: GraphNode): string => {
  const component = view.components.find(
    (candidate) => candidate.name === getComponentName(node.id),
  );
  if (!component) return node.label;
  const binding = component.bindings.find((candidate) => candidate.id === node.bindingId);
  const branch = component.branches.find((candidate) => candidate.id === node.branchId);
  switch (node.kind) {
    case "binding":
      return binding ? describeBinding(component, binding) : node.label;
    case "write":
      return describeWrite(component, node);
    case "handler":
    case "trigger":
      return describeHandler(component, node);
    case "branch":
      return branch ? describeBranch(view, component, branch) : node.label;
    case "arm":
      return branch ? describeArm(view, component, branch, node) : node.label;
    case "read":
      return node.label;
  }
};
