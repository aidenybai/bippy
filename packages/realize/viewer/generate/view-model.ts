import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  formatAbstractValue,
  formatNegated,
  formatPlace,
  formatSymbolicValue,
} from "../../src/core/values/format";
import { getTestExpression } from "../../src/core/values/get-test-expression";
import { forEachRenderNode } from "../../src/core/render/for-each-render-node";
import { forEachJsxElement } from "../../src/core/render/for-each-jsx-element";
import { isRenderingNothing } from "../../src/core/render/is-rendering-nothing";
import { collectTriggerLabels } from "../../src/core/labels/trigger-labels";
import { createSourceReader } from "../../src/core/labels/source-text";
import { exploreModel, type StateGraph } from "../../src/core/model/explore";
import type { ComponentModel } from "../../src/core/model/types";
import { analyzeProject, serializeProjectAnalysis } from "../../src/index";
import type {
  AnalyzedComponent,
  Binding,
  ConditionalValue,
  Domain,
  Handler,
  SourceLocation,
  StateUpdate,
  SymbolicValue,
} from "../../src/core/types";
import type {
  ViewBinding,
  ViewBranch,
  ViewComponent,
  ViewFile,
  ViewHandler,
  ViewLocation,
  ViewState,
  ViewUpdate,
} from "@/model";
import { getUpdateKey } from "@/lib/lookup";
import { buildCodeGraph } from "./code-graph";

const toViewLocation = (loc: SourceLocation): ViewLocation | null =>
  typeof loc !== "object"
    ? null
    : {
        start: { line: loc.start.line, column: loc.start.column, index: loc.start.index },
        end: { line: loc.end.line, column: loc.end.column, index: loc.end.index },
      };

const getValueLocation = (value: SymbolicValue): ViewLocation | null => {
  switch (value.kind) {
    case "JsxExpression":
    case "ArrayMap":
    case "Function":
    case "Unknown":
      return toViewLocation(value.loc);
    case "Conditional":
      return toViewLocation(value.branch.loc);
    case "JsxFragment": {
      const [first] = value.children;
      return first ? getValueLocation(first) : null;
    }
    default:
      return null;
  }
};

const collectBindingIds = (value: SymbolicValue, ids: Set<number> = new Set()): number[] => {
  switch (value.kind) {
    case "Binding":
      ids.add(value.binding.id);
      break;
    case "UnaryExpression":
      collectBindingIds(value.value, ids);
      break;
    case "BinaryExpression":
      collectBindingIds(value.left, ids);
      collectBindingIds(value.right, ids);
      break;
    case "Conditional":
      for (const part of [value.test, value.consequent, value.alternate])
        collectBindingIds(part, ids);
      break;
    case "ObjectExpression":
      for (const property of value.properties) collectBindingIds(property.value, ids);
      break;
    case "ArrayExpression":
      for (const element of value.elements) collectBindingIds(element, ids);
      break;
    default:
      break;
  }
  return [...ids];
};

const formatDomain = (domain: Domain): string => {
  switch (domain.kind) {
    case "Cases":
      return domain.cases.map(formatAbstractValue).join(" | ");
    case "Unknown":
      return `Unknown(${domain.reason})`;
  }
};

const getReachableLabel = (
  model: ComponentModel,
  stateGraph: StateGraph,
  binding: Binding,
): string | null => {
  const variable = model.variables.find(
    (candidate) => candidate.bindingId === binding.id && candidate.path.length === 0,
  );
  if (!variable || model.stateSpace.isTruncated) return null;
  const labels = variable.domain.map((value) => value.label);
  const reachable = labels.filter(
    (label) =>
      stateGraph.findTrace({
        kind: "In",
        variable: variable.name,
        values: [label],
        domain: labels,
      }) !== null,
  );
  return reachable.length < labels.length ? reachable.join(" | ") : null;
};

const getRestOfLine = (loc: ViewLocation | null): ViewLocation | null =>
  loc && {
    start: loc.end,
    end: { line: loc.end.line, column: Number.MAX_SAFE_INTEGER, index: loc.end.index },
  };

const getArmLocation = (arm: SymbolicValue, testLoc: ViewLocation | null): ViewLocation | null =>
  getValueLocation(arm) ?? (isRenderingNothing(arm) ? null : getRestOfLine(testLoc));

const isSameLocation = (left: SourceLocation, right: SourceLocation): boolean =>
  typeof left === "object" &&
  typeof right === "object" &&
  left.start.index === right.start.index &&
  left.end.index === right.end.index;

const getNeverArm = (
  model: ComponentModel,
  conditional: ConditionalValue,
): "consequent" | "alternate" | null => {
  const branch = model.branches.find((candidate) =>
    isSameLocation(candidate.loc, conditional.branch.loc),
  );
  if (branch?.consequent.isReachable === false) return "consequent";
  return branch?.alternate.isReachable === false ? "alternate" : null;
};

const toViewBranch = (
  model: ComponentModel,
  conditional: ConditionalValue,
  id: number,
): ViewBranch => {
  const test = getTestExpression(conditional);
  const loc = toViewLocation(conditional.branch.loc);
  return {
    id,
    test: formatSymbolicValue(test),
    negated: formatNegated(test),
    loc,
    consequent: getArmLocation(conditional.consequent, loc),
    alternate: getArmLocation(conditional.alternate, loc),
    readsBindingIds: collectBindingIds(test),
    never: getNeverArm(model, conditional),
  };
};

const collectBranches = (component: AnalyzedComponent): ViewBranch[] => {
  const branches: ViewBranch[] = [];
  forEachRenderNode(component.analysis.render, (node) => {
    if (node.kind === "Conditional")
      branches.push(toViewBranch(component.model, node, branches.length));
  });
  return branches;
};

const formatAssignments = ({ binding, value }: StateUpdate): string[] =>
  value.kind === "ObjectExpression"
    ? value.properties.map(
        (property) =>
          `${formatPlace(binding, [property.key])} = ${formatSymbolicValue(property.value)}`,
      )
    : [`${binding.name} = ${formatSymbolicValue(value)}`];

const toViewUpdate = (update: StateUpdate): ViewUpdate => ({
  bindingId: update.binding.id,
  guard: update.guards.length > 0 ? update.guards.map(formatSymbolicValue).join(" && ") : null,
  assignments: formatAssignments(update),
  isAsync: update.isAsync,
});

const dedupeUpdates = (updates: ViewUpdate[]): ViewUpdate[] => {
  const seen = new Set<string>();
  return updates.filter((update) => {
    const key = getUpdateKey(update);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const toViewHandler = (handler: Handler, label: string): ViewHandler => ({
  id: handler.id,
  label,
  loc: toViewLocation(handler.loc),
  updates: dedupeUpdates(handler.updates.map(toViewUpdate)),
});

interface TriggerSite {
  handlerId: string;
  loc: ViewLocation;
  name: string;
}

const collectTriggerSites = (component: AnalyzedComponent): TriggerSite[] => {
  const sites: TriggerSite[] = [];
  forEachJsxElement(component.analysis.render, (element) => {
    for (const prop of element.props) {
      const loc = prop.file === component.analysis.file ? toViewLocation(prop.loc) : null;
      if (loc && prop.handlerId)
        sites.push({
          handlerId: prop.handlerId,
          loc,
          name: prop.kind === "JsxAttribute" ? prop.name : "{...}",
        });
    }
  });
  return sites;
};

const getViewHandlers = (component: AnalyzedComponent): ViewHandler[] => {
  const triggerLabels = collectTriggerLabels(component.analysis, createSourceReader());
  return component.analysis.handlers.map((handler) =>
    toViewHandler(handler, triggerLabels.get(handler.id) ?? handler.id),
  );
};

const getViewBindings = (component: AnalyzedComponent): ViewBinding[] => {
  const stateGraph = exploreModel(
    component.model.variables,
    component.model.actions,
    component.model.views,
  );
  return component.analysis.bindings
    .filter((binding) => binding.kind !== "item")
    .map((binding) => ({
      id: binding.id,
      name: binding.name,
      domain: formatDomain(binding.domain),
      initial: binding.initial ? formatSymbolicValue(binding.initial) : null,
      reachable: getReachableLabel(component.model, stateGraph, binding),
      loc: toViewLocation(binding.loc),
    }));
};

const getViewSteps = (model: ComponentModel, label: string): ViewState["steps"] => {
  const steps: ViewState["steps"] = [];
  for (const edge of model.stateSpace.edges) {
    const target = model.views.findIndex((view) => view.label === edge.to);
    if (edge.from !== label || edge.handlerId === null || target === -1) continue;
    const existing = steps.find(
      (step) => step.handlerId === edge.handlerId && step.isAsync === edge.isAsync,
    );
    if (!existing)
      steps.push({ handlerId: edge.handlerId, targets: [target], isAsync: edge.isAsync });
    else if (!existing.targets.includes(target)) existing.targets.push(target);
  }
  return steps;
};

const toViewComponent = (component: AnalyzedComponent, source: string): ViewComponent => {
  const bindings = getViewBindings(component);
  const branches = collectBranches(component);
  const handlers = getViewHandlers(component);
  const model = component.model;
  return {
    name: component.analysis.name,
    loc: toViewLocation(component.analysis.loc),
    bindings,
    branches,
    handlers,
    graph: buildCodeGraph({
      idPrefix: `${component.analysis.name}/`,
      source,
      componentLoc: toViewLocation(component.analysis.loc),
      bindings,
      branches,
      handlers,
      triggers: collectTriggerSites(component),
    }),
    states: model.views.map((view, index) => ({
      index,
      conditions: view.conditions,
      label: view.conditions.join(" ∧ ") || "always",
      render: view.label,
      steps: getViewSteps(model, view.label),
    })),
  };
};

const findTsconfig = (file: string): string => {
  let directory = dirname(file);
  while (true) {
    const candidate = join(directory, "tsconfig.json");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(directory);
    if (parent === directory) throw new Error(`No tsconfig.json above ${file}`);
    directory = parent;
  }
};

export const analyzeFile = (file: string): { view: ViewFile; json: string } => {
  const analysis = analyzeProject(findTsconfig(file), file);
  const source = readFileSync(file, "utf8");
  return {
    view: {
      file,
      source,
      components: analysis.components
        .filter((component) => component.analysis.file === file)
        .map((component) => toViewComponent(component, source)),
    },
    json: JSON.stringify(JSON.parse(serializeProjectAnalysis(analysis)), null, 2),
  };
};
