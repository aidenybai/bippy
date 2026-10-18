import { readFileSync } from "node:fs";
import { analyzeProject } from "../../bippy-analyzer/src/core/analyze-project";
import {
  formatAbstractValue,
  formatNegated,
  formatPlace,
  formatSymbolicValue,
} from "../../bippy-analyzer/src/core/format";
import { getTestExpression } from "../../bippy-analyzer/src/core/utils/get-test-expression";
import { forEachRenderNode } from "../../bippy-analyzer/src/core/utils/for-each-render-node";
import { isRenderingNothing } from "../../bippy-analyzer/src/core/utils/is-rendering-nothing";
import { collectTriggerLabels } from "../../bippy-analyzer/src/cli/trigger-labels";
import { simplifyConditions } from "../../bippy-analyzer/src/cli/simplify-conditions";
import { createSourceReader } from "../../bippy-analyzer/src/cli/source-text";
import { forEachJsxElement } from "../../bippy-analyzer/src/core/utils/for-each-jsx-element";
import { buildCodeGraph, buildStructureGraph } from "./graph";
import { getBindingPlace } from "../../bippy-analyzer/src/core/utils/get-binding-place";
import { GeneratedSource } from "../../bippy-analyzer/src/react-compiler/HIR/HIR";
import type {
  AnalyzedComponent,
  Binding,
  ConditionalValue,
  Domain,
  Handler,
  ProjectAnalysis,
  SourceLocation,
  StateUpdate,
  SymbolicValue,
} from "../../bippy-analyzer/src/core/types";
import type {
  CodeGraph,
  ComponentSummary,
  ViewBinding,
  ViewBranch,
  ViewComponent,
  ViewHandler,
  ViewLocation,
} from "../src/model";

const analysesByProject = new Map<string, ProjectAnalysis>();

const toViewLocation = (loc: SourceLocation): ViewLocation | null =>
  loc === GeneratedSource
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
    case "Opaque":
      return domain.typeText;
    case "Unknown":
      return `Unknown(${domain.reason})`;
  }
};

const getReachableLabel = (component: AnalyzedComponent, binding: Binding): string | null => {
  const reachable = component.report.places.get(getBindingPlace(binding));
  if (!reachable || binding.domain.kind !== "Cases") return null;
  if (reachable.length >= binding.domain.cases.length) return null;
  return reachable.map(formatAbstractValue).join(" | ");
};

const toViewBinding = (component: AnalyzedComponent, binding: Binding): ViewBinding => ({
  id: binding.id,
  name: binding.name,
  kind: binding.hookKind ? `${binding.kind}:${binding.hookKind}` : binding.kind,
  domain: formatDomain(binding.domain),
  initial: binding.initial ? formatSymbolicValue(binding.initial) : null,
  reachable: getReachableLabel(component, binding),
  loc: toViewLocation(binding.loc),
});

const getRestOfLine = (loc: ViewLocation | null): ViewLocation | null =>
  loc && {
    start: loc.end,
    end: { line: loc.end.line, column: Number.MAX_SAFE_INTEGER, index: loc.end.index },
  };

const getArmLocation = (arm: SymbolicValue, testLoc: ViewLocation | null): ViewLocation | null =>
  getValueLocation(arm) ?? (isRenderingNothing(arm) ? null : getRestOfLine(testLoc));

const getNeverArm = (
  component: AnalyzedComponent,
  conditional: ConditionalValue,
): "consequent" | "alternate" | null => {
  const unreachable = component.report.unreachableBranches.find(
    (candidate) => candidate.branch.loc === conditional.branch.loc,
  );
  if (!unreachable) return null;
  return unreachable.isTrueSide ? "consequent" : "alternate";
};

const toViewBranch = (
  component: AnalyzedComponent,
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
    never: getNeverArm(component, conditional),
  };
};

const collectBranches = (component: AnalyzedComponent): ViewBranch[] => {
  const branches: ViewBranch[] = [];
  forEachRenderNode(component.analysis.render, (node) => {
    if (node.kind === "Conditional") branches.push(toViewBranch(component, node, branches.length));
  });
  return branches;
};

const formatUpdate = (update: StateUpdate): string => {
  const { binding, value } = update;
  const assignments =
    value.kind === "ObjectExpression"
      ? value.properties.map(
          (property) =>
            `${formatPlace(binding, [property.key])} = ${formatSymbolicValue(property.value)}`,
        )
      : [`${binding.name} = ${formatSymbolicValue(value)}`];
  const guardPrefix =
    update.guards.length > 0 ? `if ${update.guards.map(formatSymbolicValue).join(" && ")}: ` : "";
  return `${guardPrefix}${assignments.join(", ")}`;
};

const toViewHandler = (handler: Handler, label: string): ViewHandler => ({
  id: handler.id,
  label,
  kind: handler.trigger.kind === "Event" ? "event" : "effect",
  loc: toViewLocation(handler.loc),
  updates: handler.updates.map((update) => ({
    bindingId: update.binding.id,
    text: formatUpdate(update),
    isAsync: update.isAsync,
  })),
});

const collectTriggerSites = (
  component: AnalyzedComponent,
): Array<{ handlerId: string; loc: ViewLocation; name: string }> => {
  const sites: Array<{ handlerId: string; loc: ViewLocation; name: string }> = [];
  forEachJsxElement(component.analysis.render, (element) => {
    for (const prop of element.props) {
      const loc = prop.handlerId && prop.file === component.analysis.file && toViewLocation(prop.loc);
      if (loc && prop.handlerId)
        sites.push({ handlerId: prop.handlerId, loc, name: prop.kind === "JsxAttribute" ? prop.name : "{...}" });
    }
  });
  return sites;
};

const buildComponentGraph = (component: AnalyzedComponent, source: string): CodeGraph => {
  const { analysis } = component;
  const triggerLabels = collectTriggerLabels(component, createSourceReader());
  return buildCodeGraph({
    idPrefix: `${analysis.name}/`,
    source,
    componentLoc: toViewLocation(analysis.loc),
    bindings: analysis.bindings
      .filter((binding) => binding.kind !== "item")
      .map((binding) => toViewBinding(component, binding)),
    branches: collectBranches(component),
    handlers: analysis.handlers.map((handler) =>
      toViewHandler(handler, triggerLabels.get(handler.id) ?? handler.id),
    ),
    triggers: collectTriggerSites(component),
  });
};

const buildFileGraph = (component: AnalyzedComponent, siblings: AnalyzedComponent[]): CodeGraph => {
  const source = readFileSync(component.analysis.file, "utf8");
  const members = [component, ...siblings];
  const graphs = [
    ...members.map((member) => buildComponentGraph(member, source)),
    buildStructureGraph(
      source,
      members.map((member) => ({
        name: member.analysis.name,
        startIndex: member.analysis.loc === GeneratedSource ? 0 : member.analysis.loc.start.index,
      })),
    ),
  ];
  return {
    nodes: graphs.flatMap((graph) => graph.nodes),
    edges: graphs.flatMap((graph) => graph.edges),
  };
};

const toComponentSummary = (component: AnalyzedComponent): ComponentSummary => ({
  name: component.analysis.name,
  file: component.analysis.file,
  line: component.analysis.loc === GeneratedSource ? null : component.analysis.loc.start.line,
  stateCount: component.report.states.length,
  handlerCount: component.analysis.handlers.length,
});

const toViewComponent = (
  component: AnalyzedComponent,
  siblings: AnalyzedComponent[],
  all: AnalyzedComponent[],
): ViewComponent => {
  const { analysis, report } = component;
  const triggerLabels = collectTriggerLabels(component, createSourceReader());
  const source = readFileSync(analysis.file, "utf8");
  const bindings = analysis.bindings
      .filter((binding) => binding.kind !== "item")
      .map((binding) => toViewBinding(component, binding));
  const branches = collectBranches(component);
  const handlers = analysis.handlers.map((handler) =>
    toViewHandler(handler, triggerLabels.get(handler.id) ?? handler.id),
  );
  const componentLoc = toViewLocation(analysis.loc);
  return {
    components: all.map(toComponentSummary),
    name: analysis.name,
    file: analysis.file,
    loc: componentLoc,
    source,
    bindings,
    branches,
    handlers,
    graph: buildFileGraph(component, siblings),
    states: report.states.map((state, index) => ({
      index,
      regionIndex: state.regionIndex,
      conditions: state.conditions,
      label: simplifyConditions(state.conditions).join(" ∧ ") || "always",
      transitions: state.transitions,
    })),
    regions: report.regions.map((region) => ({
      placeNames: region.placeNames,
      states: region.states,
      firstRenderState: region.firstRenderState,
      isTruncated: region.isTruncated,
    })),
    isTruncated: report.isTruncated,
  };
};

export const getViewModel = (
  tsconfig: string,
  componentName: string,
  fileFilter: string | null,
): ViewComponent | null => {
  const key = `${tsconfig}\n${fileFilter ?? ""}`;
  const analysis = analysesByProject.get(key) ?? analyzeProject(tsconfig, fileFilter);
  analysesByProject.set(key, analysis);
  const component = analysis.components.find(({ analysis }) => analysis.name === componentName);
  if (!component) return null;
  const siblings = analysis.components.filter(
    (candidate) => candidate !== component && candidate.analysis.file === component.analysis.file,
  );
  return toViewComponent(component, siblings, analysis.components);
};
