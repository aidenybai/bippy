import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  formatAbstractValue,
  formatNegated,
  formatPlace,
  formatSymbolicValue,
} from "../../../src/core/format";
import { getTestExpression } from "../../../src/core/utils/get-test-expression";
import { forEachRenderNode } from "../../../src/core/utils/for-each-render-node";
import { forEachJsxElement } from "../../../src/core/utils/for-each-jsx-element";
import { isRenderingNothing } from "../../../src/core/utils/is-rendering-nothing";
import { collectTriggerLabels } from "../../../src/cli/trigger-labels";
import { simplifyConditions } from "../../../src/cli/simplify-conditions";
import { describeState } from "../../../src/cli/describe-state";
import { createSourceReader } from "../../../src/cli/source-text";
import type {
  Binding,
  ConditionalValue,
  Domain,
  Handler,
  SourceLocation,
  StateUpdate,
  SymbolicValue,
} from "../../../src/core/types";
import type {
  CodeGraph,
  ViewBinding,
  ViewBranch,
  ViewComponent,
  ViewFile,
  ViewHandler,
  ViewLocation,
  ViewUpdate,
} from "@/model";
import { loadAnalyzerOutput, loadAnalyzerText, type AnalyzerJsonComponent } from "./analyzer-json";
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

const getUpdateKey = (update: ViewUpdate): string =>
  `${update.bindingId}:${update.guard ?? ""}:${update.assignments.join(",")}:${update.isAsync}`;

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

const getViewStates = (component: AnalyzerJsonComponent): ViewComponent["states"] => {
  const { analysis, report } = component;
  const describer = { file: analysis.file, sourceReader: createSourceReader() };
  return report.states.map((state, index) => {
    const label = simplifyConditions(state.conditions).join(" ∧ ") || "always";
    const described = describeState(state, report.regions.length > 1, describer);
    return {
      index,
      conditions: state.conditions,
      label,
      render: described.slice(label.length + 3),
      transitions: state.transitions,
    };
  });
};

const toViewComponent = (component: AnalyzerJsonComponent, source: string): ViewComponent => {
  const { analysis, report } = component;
  return {
    name: analysis.name,
    loc: toViewLocation(analysis.loc),
    bindings: getViewBindings(component),
    branches: collectBranches(component),
    handlers: getViewHandlers(component),
    graph: buildComponentGraph(component, source),
    states: getViewStates(component),
    regions: report.regions.map((region) => ({
      placeNames: region.placeNames,
      states: region.states,
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

export const getAnalyzerJson = (file: string): string =>
  loadAnalyzerText({ tsconfig: findTsconfig(file), fileFilter: file });

export const getViewFile = (file: string): ViewFile => {
  const tsconfig = findTsconfig(file);
  const components = loadAnalyzerOutput({ tsconfig, fileFilter: file }).filter(
    (component) => component.analysis.file === file,
  );
  const source = readFileSync(file, "utf8");
  return {
    file,
    tsconfig,
    source,
    components: components.map((component) => toViewComponent(component, source)),
  };
};
