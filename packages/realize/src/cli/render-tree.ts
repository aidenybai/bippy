import { relative } from "node:path";
import { GeneratedSource } from "../react-compiler/HIR/HIR";
import type {
  AnalyzedComponent,
  ConditionalValue,
  Handler,
  JsxExpressionValue,
  StateUpdate,
  SymbolicValue,
} from "../core/types";
import { formatPlace, formatSymbolicValue } from "../core/format";
import { getTestExpression } from "../core/utils/get-test-expression";
import { isRenderingNothing } from "../core/utils/is-rendering-nothing";
import { isRenderingNothingWhenFalse } from "../core/utils/is-rendering-nothing-when-false";
import { isUnchangedField } from "../core/utils/is-unchanged-field";
import { isEffectHandler } from "../core/handler-predicates";
import { describeUnknown, type StateDescriber } from "./describe-state";
import { createSourceReader } from "./source-text";
import { getEffectTriggerLabel } from "./trigger-labels";
import { truncate, unescapeQuotedLiterals } from "./text";

export const DEFAULT_RENDER_DEPTH = 12;

export interface RenderTreeOptions {
  rootDirectory: string;
  maxDepth: number;
}

type NodeShape = "element" | "branch" | "list" | "event";

interface Flowchart {
  lines: string[];
  nodeCount: number;
  maxDepth: number;
  effectsByHandler: Map<string, string>;
  describer: StateDescriber;
}

const INDENT = "  ";
const MAX_NODES = 400;
const MAX_LABEL_WIDTH = 80;
const MAX_EFFECT_WIDTH = 70;
const EFFECT_SEPARATOR = " · ";
const SHAPES: Record<NodeShape, [string, string]> = {
  element: ["[", "]"],
  branch: ["{", "}"],
  list: ["[[", "]]"],
  event: ["([", "])"],
};

const escapeLabel = (text: string): string =>
  unescapeQuotedLiterals(text)
    .replaceAll(";", ",")
    .replaceAll('"', "#quot;")
    .replaceAll("<", "#lt;")
    .replaceAll(">", "#gt;");

const addNode = (chart: Flowchart, label: string, shape: NodeShape): string => {
  const id = `n${++chart.nodeCount}`;
  const [open, close] = SHAPES[shape];
  const suffix = shape === "event" ? ":::event" : "";
  chart.lines.push(
    `${id}${open}"${escapeLabel(truncate(label, MAX_LABEL_WIDTH))}"${close}${suffix}`,
  );
  return id;
};

const addEdge = (chart: Flowchart, from: string, to: string, label?: string): void => {
  chart.lines.push(label ? `${from} -->|${label}| ${to}` : `${from} --> ${to}`);
};

const addEventNode = (chart: Flowchart, from: string, label: string): void => {
  chart.lines.push(`${from} -.-> ${addNode(chart, label, "event")}`);
};

const formatUpdate = (update: StateUpdate): string => {
  const { binding, value } = update;
  const assignments =
    value.kind === "ObjectExpression"
      ? value.properties
          .filter((property) => !isUnchangedField(property.value, binding, [property.key]))
          .map(
            (property) =>
              `${formatPlace(binding, [property.key])} = ${formatSymbolicValue(property.value)}`,
          )
      : [`${binding.name} = ${formatSymbolicValue(value)}`];
  const guardPrefix =
    update.guards.length > 0 ? `if ${update.guards.map(formatSymbolicValue).join(" && ")}: ` : "";
  return `${guardPrefix}${assignments.join(", ")}${update.isAsync ? " (async)" : ""}`;
};

const formatHandlerEffects = (handler: Handler): string =>
  truncate(
    [
      ...handler.updates.map(formatUpdate),
      ...handler.delegates.map((delegate) => `calls ${delegate}`),
      ...handler.claims.map((claim) => `checks ${claim.description}`),
    ].join(EFFECT_SEPARATOR) || "nothing",
    MAX_EFFECT_WIDTH,
  );

const formatLeaf = (value: SymbolicValue, chart: Flowchart): string | null => {
  switch (value.kind) {
    case "JsxExpression":
    case "JsxFragment":
    case "Conditional":
    case "ArrayMap":
      return null;
    case "JSXText":
      return JSON.stringify(value.value);
    case "Unknown":
      return describeUnknown(value, chart.describer);
    default:
      return isRenderingNothing(value) ? "∅" : `{${formatSymbolicValue(value)}}`;
  }
};

const buildElement = (
  element: JsxExpressionValue,
  chart: Flowchart,
  parentId: string,
  depth: number,
  edgeLabel?: string,
): void => {
  const [onlyChild] = element.children;
  const onlyLeaf =
    element.children.length === 1 && onlyChild && !isRenderingNothing(onlyChild)
      ? formatLeaf(onlyChild, chart)
      : null;
  const id = addNode(chart, `<${element.tag.name}>${onlyLeaf ? ` ${onlyLeaf}` : ""}`, "element");
  addEdge(chart, parentId, id, edgeLabel);
  for (const prop of element.props) {
    if (!prop.handlerId) continue;
    const propName = prop.kind === "JsxAttribute" ? prop.name : "{...}";
    addEventNode(chart, id, `${propName} ⇒ ${chart.effectsByHandler.get(prop.handlerId) ?? "?"}`);
  }
  if (onlyLeaf === null)
    for (const child of element.children) buildNode(child, chart, id, depth + 1);
};

const buildBranch = (
  conditional: ConditionalValue,
  chart: Flowchart,
  parentId: string,
  depth: number,
  edgeLabel?: string,
): void => {
  const id = addNode(chart, formatSymbolicValue(getTestExpression(conditional)), "branch");
  addEdge(chart, parentId, id, edgeLabel);
  buildNode(conditional.consequent, chart, id, depth + 1, "✓");
  if (!isRenderingNothingWhenFalse(conditional))
    buildNode(conditional.alternate, chart, id, depth + 1, "✗");
};

const buildNode = (
  value: SymbolicValue,
  chart: Flowchart,
  parentId: string,
  depth: number,
  edgeLabel?: string,
): void => {
  const leaf = formatLeaf(value, chart);
  if (leaf !== null) return addEdge(chart, parentId, addNode(chart, leaf, "element"), edgeLabel);
  if (depth >= chart.maxDepth || chart.nodeCount >= MAX_NODES)
    return addEdge(chart, parentId, addNode(chart, "…", "element"), edgeLabel);
  switch (value.kind) {
    case "JsxExpression":
      return buildElement(value, chart, parentId, depth, edgeLabel);
    case "JsxFragment":
      for (const child of value.children) buildNode(child, chart, parentId, depth + 1, edgeLabel);
      return;
    case "ArrayMap": {
      const id = addNode(chart, `↻ each of ${formatSymbolicValue(value.array)}`, "list");
      addEdge(chart, parentId, id, edgeLabel);
      return buildNode(value.item, chart, id, depth + 1);
    }
    case "Conditional":
      return buildBranch(value, chart, parentId, depth, edgeLabel);
  }
};

const createFlowchart = (component: AnalyzedComponent, options: RenderTreeOptions): Flowchart => ({
  lines: [],
  nodeCount: 0,
  maxDepth: options.maxDepth,
  effectsByHandler: new Map(
    component.analysis.handlers.map((handler) => [handler.id, formatHandlerEffects(handler)]),
  ),
  describer: { file: component.analysis.file, sourceReader: createSourceReader() },
});

export const formatRenderTree = (
  component: AnalyzedComponent,
  options: RenderTreeOptions,
): string => {
  const { analysis } = component;
  const chart = createFlowchart(component, options);
  const rootId = addNode(chart, analysis.name, "element");
  buildNode(analysis.render, chart, rootId, 0);
  for (const handler of analysis.handlers.filter(isEffectHandler))
    addEventNode(
      chart,
      rootId,
      `${getEffectTriggerLabel(handler)} ⇒ ${formatHandlerEffects(handler)}`,
    );
  const lineSuffix = analysis.loc === GeneratedSource ? "" : `:${analysis.loc.start.line}`;
  const location = `${relative(options.rootDirectory, analysis.file)}${lineSuffix}`;
  return [
    "---",
    `title: ${analysis.name} ${location}`,
    "---",
    "flowchart TD",
    `${INDENT}classDef event stroke-dasharray: 4 2`,
    ...chart.lines.map((line) => `${INDENT}${line}`),
  ].join("\n");
};
