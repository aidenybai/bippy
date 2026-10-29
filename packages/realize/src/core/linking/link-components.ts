import { enumerateInstance, getInstanceKey } from "./instance-states";
import { formatPlace } from "../values/format";
import type {
  BindingValue,
  ComponentAnalysis,
  ComponentInstance,
  ComponentLink,
  JsxExpressionValue,
  PropLink,
  StateReport,
  SymbolicValue,
  Warning,
} from "../types";
import { appendToGroup } from "../shared/append-to-group";
import { forEachJsxElement } from "../states/for-each-jsx-element";
import { isSameLocation } from "../shared/is-same-location";
import { getValueDomain, type Places } from "../type-checker/value-domains";

export interface Linked {
  links: ComponentLink[];
  instances: ComponentInstance[];
}

export type ReportLoader = (analysis: ComponentAnalysis) => StateReport;

const getPropLinks = (element: JsxExpressionValue, places: Places): PropLink[] => {
  const props = element.props.flatMap((prop): PropLink[] =>
    prop.kind === "JsxAttribute"
      ? [{ name: prop.name, value: prop.value, domain: getValueDomain(prop.value, places) }]
      : [],
  );
  if (element.children.length === 0) return props;
  const children: PropLink["value"] = { kind: "JsxFragment", children: element.children };
  return [
    ...props,
    { name: "children", value: children, domain: getValueDomain(children, places) },
  ];
};

const createLink = (
  parent: ComponentAnalysis,
  child: string,
  element: JsxExpressionValue,
  places: Places,
): ComponentLink => ({
  parent: parent.declaration,
  child,
  loc: element.loc,
  file: parent.file,
  props: getPropLinks(element, places),
  isComplete: element.props.every((prop) => prop.kind === "JsxAttribute"),
});

const collectChildElements = (
  parent: ComponentAnalysis,
  declarations: Set<string>,
): Array<[string, JsxExpressionValue]> => {
  const elements: Array<[string, JsxExpressionValue]> = [];
  for (const rendered of [parent.render, ...parent.localRenders])
    forEachJsxElement(rendered, (element) => {
      if (element.tag.kind !== "Component" || element.tag.declaration === null) return;
      const { declaration } = element.tag;
      if (declaration !== parent.declaration && declarations.has(declaration))
        elements.push([declaration, element]);
    });
  return elements;
};

const collectLinks = (
  analyses: ComponentAnalysis[],
  loadReport: ReportLoader,
  isSelected: (analysis: ComponentAnalysis) => boolean,
): ComponentLink[] => {
  const declarations = new Set(analyses.map((analysis) => analysis.declaration));
  return analyses.filter(isSelected).flatMap((parent) => {
    const elements = collectChildElements(parent, declarations);
    if (elements.length === 0) return [];
    const { places } = loadReport(parent);
    return elements.map(([child, element]) => createLink(parent, child, element, places));
  });
};

const forEachPassedBinding = (value: SymbolicValue, visit: (value: BindingValue) => void): void => {
  if (value.kind === "Binding") visit(value);
  if (value.kind === "Conditional") {
    forEachPassedBinding(value.consequent, visit);
    forEachPassedBinding(value.alternate, visit);
  }
};

const addWarning = (analysis: ComponentAnalysis, warning: Warning): boolean => {
  const isDuplicate = analysis.warnings.some(
    (existing) =>
      existing.kind === warning.kind &&
      existing.message === warning.message &&
      existing.file === warning.file &&
      isSameLocation(existing.loc, warning.loc),
  );
  if (!isDuplicate) analysis.warnings.push(warning);
  return !isDuplicate;
};

const propagatePropMutation = (
  parent: ComponentAnalysis,
  child: ComponentAnalysis,
  propLink: PropLink,
  warning: Warning,
): boolean => {
  let isAdded = false;
  forEachPassedBinding(propLink.value, ({ binding, path }) => {
    if (binding.kind !== "state" && binding.kind !== "prop") return;
    const isProp = binding.kind === "prop";
    const place = formatPlace(binding, path);
    isAdded =
      addWarning(parent, {
        kind: isProp ? "prop-mutation" : "state-mutation",
        message: `mutates ${isProp ? "prop " : ""}${place} through ${child.name}`,
        loc: warning.loc,
        file: warning.file,
        prop: isProp ? binding.propName : null,
      }) || isAdded;
  });
  return isAdded;
};

const propagatePropMutations = (
  analysesByDeclaration: Map<string, ComponentAnalysis>,
  links: ComponentLink[],
): void => {
  let isChanged = true;
  while (isChanged) {
    isChanged = false;
    for (const link of links) {
      const parent = analysesByDeclaration.get(link.parent);
      const child = analysesByDeclaration.get(link.child);
      if (!parent || !child) continue;
      for (const warning of child.warnings) {
        if (warning.kind !== "prop-mutation" || warning.prop === null) continue;
        const propLink = link.props.find((prop) => prop.name === warning.prop);
        if (propLink && propagatePropMutation(parent, child, propLink, warning)) isChanged = true;
      }
    }
  }
};

const isSameShape = (instance: StateReport, own: StateReport): boolean =>
  instance.states.length === own.states.length &&
  instance.unreachableBranches.length === own.unreachableBranches.length &&
  instance.claimOutcomes.every(
    (outcome, index) => outcome.verdict === own.claimOutcomes[index]?.verdict,
  );

const createInstanceLoader = (
  loadReport: ReportLoader,
): ((child: ComponentAnalysis, link: ComponentLink) => StateReport | null) => {
  const reportsByKey = new Map<string, StateReport | null>();
  return (child, link) => {
    const own = loadReport(child);
    const key = getInstanceKey(child, link, own);
    if (key === null) return null;
    const cached = reportsByKey.get(key);
    if (cached !== undefined) return cached;
    const report = enumerateInstance(child, link, own);
    const shared = report && isSameShape(report, own) ? own : report;
    reportsByKey.set(key, shared);
    return shared;
  };
};

export const linkComponents = (
  analyses: ComponentAnalysis[],
  loadReport: ReportLoader,
  isSelected: (analysis: ComponentAnalysis) => boolean = () => true,
): Map<string, Linked> => {
  const linked = new Map<string, Linked>(
    analyses.map((analysis) => [analysis.declaration, { links: [], instances: [] }]),
  );
  const analysesByDeclaration = new Map(
    analyses.map((analysis) => [analysis.declaration, analysis]),
  );
  const instancesByChild = new Map<string, ComponentInstance[]>();
  const loadInstance = createInstanceLoader(loadReport);
  const links = collectLinks(analyses, loadReport, isSelected);
  propagatePropMutations(analysesByDeclaration, links);
  for (const link of links) {
    linked.get(link.parent)?.links.push(link);
    const child = analysesByDeclaration.get(link.child);
    const report = child && isSelected(child) ? loadInstance(child, link) : null;
    if (report) appendToGroup(instancesByChild, link.child, { link, report });
  }
  for (const [child, instances] of instancesByChild) {
    const entry = linked.get(child);
    if (entry) entry.instances = instances;
  }
  return linked;
};
