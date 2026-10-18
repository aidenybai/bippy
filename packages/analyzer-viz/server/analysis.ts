import { readFileSync } from "node:fs";
import {
  formatAbstractValue,
  formatNegated,
  formatPlace,
  formatSymbolicValue,
} from "../../bippy-analyzer/src/core/format";
import { getTestExpression } from "../../bippy-analyzer/src/core/utils/get-test-expression";
import { forEachRenderNode } from "../../bippy-analyzer/src/core/utils/for-each-render-node";
import { forEachJsxElement } from "../../bippy-analyzer/src/core/utils/for-each-jsx-element";
import { isRenderingNothing } from "../../bippy-analyzer/src/core/utils/is-rendering-nothing";
import { collectTriggerLabels } from "../../bippy-analyzer/src/cli/trigger-labels";
import { simplifyConditions } from "../../bippy-analyzer/src/cli/simplify-conditions";
import { describeState } from "../../bippy-analyzer/src/cli/describe-state";
import { createSourceReader } from "../../bippy-analyzer/src/cli/source-text";
import type {
  Binding,
  ConditionalValue,
  Domain,
  Handler,
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
import {
  loadAnalyzerOutput,
  type AnalyzerJsonComponent,
  type AnalyzerSource,
} from "./analyzer-json";
import { buildCodeGraph, buildStructureGraph } from "./graph";

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
    case "Opaque":
      return domain.typeText;
    case "Unknown":
      return `Unknown(${domain.reason})`;
  }
};

const getReachableLabel = (component: AnalyzerJsonComponent, binding: Binding): string | null => {
  const reachable = component.report.places[String(binding.id)];
  if (!reachable || binding.domain.kind !== "Cases") return null;
  if (reachable.length >= binding.domain.cases.length) return null;
  return reachable.map(formatAbstractValue).join(" | ");
};

const toViewBinding = (component: AnalyzerJsonComponent, binding: Binding): ViewBinding => ({
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

const isSameLocation = (left: SourceLocation, right: SourceLocation): boolean =>
  typeof left === "object" &&
  typeof right === "object" &&
  left.start.index === right.start.index &&
  left.end.index === right.end.index;

const getNeverArm = (
  component: AnalyzerJsonComponent,
  conditional: ConditionalValue,
): "consequent" | "alternate" | null => {
  const unreachable = component.report.unreachableBranches.find((candidate) =>
    isSameLocation(candidate.branch.loc, conditional.branch.loc),
  );
  if (!unreachable) return null;
  return unreachable.isTrueSide ? "consequent" : "alternate";
};

const toViewBranch = (
  component: AnalyzerJsonComponent,
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

const collectBranches = (component: AnalyzerJsonComponent): ViewBranch[] => {
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

interface TriggerSite {
  handlerId: string;
  loc: ViewLocation;
  name: string;
}

const collectTriggerSites = (component: AnalyzerJsonComponent): TriggerSite[] => {
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

const getViewHandlers = (component: AnalyzerJsonComponent): ViewHandler[] => {
  const triggerLabels = collectTriggerLabels(component, createSourceReader());
  return component.analysis.handlers.map((handler) =>
    toViewHandler(handler, triggerLabels.get(handler.id) ?? handler.id),
  );
};

const getViewBindings = (component: AnalyzerJsonComponent): ViewBinding[] =>
  component.analysis.bindings
    .filter((binding) => binding.kind !== "item")
    .map((binding) => toViewBinding(component, binding));

const buildComponentGraph = (component: AnalyzerJsonComponent, source: string): CodeGraph =>
  buildCodeGraph({
    idPrefix: `${component.analysis.name}/`,
    source,
    componentLoc: toViewLocation(component.analysis.loc),
    bindings: getViewBindings(component),
    branches: collectBranches(component),
    handlers: getViewHandlers(component),
    triggers: collectTriggerSites(component),
  });

const buildFileGraph = (
  component: AnalyzerJsonComponent,
  siblings: AnalyzerJsonComponent[],
  source: string,
): CodeGraph => {
  const members = [component, ...siblings];
  const graphs = [
    ...members.map((member) => buildComponentGraph(member, source)),
    buildStructureGraph(
      source,
      members.map((member) => ({
        name: member.analysis.name,
        startIndex: toViewLocation(member.analysis.loc)?.start.index ?? 0,
      })),
    ),
  ];
  return {
    nodes: graphs.flatMap((graph) => graph.nodes),
    edges: graphs.flatMap((graph) => graph.edges),
  };
};

const toComponentSummary = (component: AnalyzerJsonComponent): ComponentSummary => ({
  name: component.analysis.name,
  file: component.analysis.file,
  line: toViewLocation(component.analysis.loc)?.start.line ?? null,
  stateCount: component.report.states.length,
  handlerCount: component.analysis.handlers.length,
});

const getViewStates = (component: AnalyzerJsonComponent): ViewComponent["states"] => {
  const { analysis, report } = component;
  const describer = { file: analysis.file, sourceReader: createSourceReader() };
  return report.states.map((state, index) => {
    const label = simplifyConditions(state.conditions).join(" ∧ ") || "always";
    const described = describeState(state, report.regions.length > 1, describer);
    return {
      index,
      regionIndex: state.regionIndex,
      conditions: state.conditions,
      label,
      render: described.slice(label.length + 3),
      transitions: state.transitions,
    };
  });
};

const toViewComponent = (
  component: AnalyzerJsonComponent,
  siblings: AnalyzerJsonComponent[],
  all: AnalyzerJsonComponent[],
): ViewComponent => {
  const { analysis, report } = component;
  const source = readFileSync(analysis.file, "utf8");
  return {
    components: all.map(toComponentSummary),
    name: analysis.name,
    file: analysis.file,
    loc: toViewLocation(analysis.loc),
    source,
    bindings: getViewBindings(component),
    branches: collectBranches(component),
    handlers: getViewHandlers(component),
    graph: buildFileGraph(component, siblings, source),
    states: getViewStates(component),
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
  source: AnalyzerSource,
  componentName: string,
): ViewComponent | null => {
  const components = loadAnalyzerOutput(source);
  const component = components.find(({ analysis }) => analysis.name === componentName);
  if (!component) return null;
  const siblings = components.filter(
    (candidate) => candidate !== component && candidate.analysis.file === component.analysis.file,
  );
  return toViewComponent(component, siblings, components);
};
