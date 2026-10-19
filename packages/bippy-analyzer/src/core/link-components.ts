import { enumerateInstance } from "./instance-states";
import type {
  ComponentAnalysis,
  ComponentInstance,
  ComponentLink,
  JsxExpressionValue,
  PropLink,
  StateReport,
} from "./types";
import { appendToGroup } from "./utils/append-to-group";
import { forEachJsxElement } from "./utils/for-each-jsx-element";
import { getValueDomain, type Places } from "./value-domains";

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
  forEachJsxElement(parent.render, (element) => {
    if (element.tag.kind !== "Component" || element.tag.declaration === null) return;
    const { declaration } = element.tag;
    if (declaration !== parent.declaration && declarations.has(declaration))
      elements.push([declaration, element]);
  });
  return elements;
};

const collectLinks = (analyses: ComponentAnalysis[], loadReport: ReportLoader): ComponentLink[] => {
  const declarations = new Set(analyses.map((analysis) => analysis.declaration));
  return analyses.flatMap((parent) => {
    const elements = collectChildElements(parent, declarations);
    if (elements.length === 0) return [];
    const { places } = loadReport(parent);
    return elements.map(([child, element]) => createLink(parent, child, element, places));
  });
};

export const linkComponents = (
  analyses: ComponentAnalysis[],
  loadReport: ReportLoader,
): Map<string, Linked> => {
  const linked = new Map<string, Linked>(
    analyses.map((analysis) => [analysis.declaration, { links: [], instances: [] }]),
  );
  const analysesByDeclaration = new Map(
    analyses.map((analysis) => [analysis.declaration, analysis]),
  );
  const instancesByChild = new Map<string, ComponentInstance[]>();
  for (const link of collectLinks(analyses, loadReport)) {
    linked.get(link.parent)?.links.push(link);
    const child = analysesByDeclaration.get(link.child);
    const report = child ? enumerateInstance(child, link) : null;
    if (report) appendToGroup(instancesByChild, link.child, { link, report });
  }
  for (const [child, instances] of instancesByChild) {
    const entry = linked.get(child);
    if (entry) entry.instances = instances;
  }
  return linked;
};
