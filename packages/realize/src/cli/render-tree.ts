import type {
  AnalyzedComponent,
  Binding,
  ConditionalValue,
  Handler,
  JsxExpressionValue,
  StateUpdate,
  SymbolicValue,
} from "../core/types";
import { formatPlace, formatSymbolicValue } from "../core/values/format";
import { getTestExpression } from "../core/values/get-test-expression";
import { isRenderingNothing } from "../core/render/is-rendering-nothing";
import { createSourceReader } from "../core/labels/source-text";
import type { SourceReader } from "../core/labels/source-text";
import { getTriggerLabel } from "../core/labels/trigger-labels";
import { truncate, unescapeQuotedLiterals } from "../core/labels/text";
import { getValueKey } from "../core/values/get-value-key";
import { formatTitle } from "./mermaid";

const isUnchangedField = (value: SymbolicValue, binding: Binding, key: string): boolean =>
  value.kind === "Binding" &&
  value.binding.id === binding.id &&
  value.path.length === 1 &&
  value.path[0] === key;

export const DEFAULT_RENDER_DEPTH = 12;

interface RenderTreeOptions {
  rootDirectory: string;
  maxDepth: number;
}

type NodeShape = "element" | "branch" | "list" | "event";

interface Flowchart {
  lines: string[];
  nodeCount: number;
  maxDepth: number;
  effectsByHandler: Map<string, string>;
  file: string;
  sourceReader: SourceReader;
}

const INDENT = "  ";
const MAX_NODES = 400;
const MAX_LABEL_WIDTH = 80;
const MAX_EFFECT_WIDTH = 70;
const MAX_UNKNOWN_WIDTH = 40;
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
  const assignments =
    update.value.kind === "ObjectExpression"
      ? update.value.properties
          .filter((property) => !isUnchangedField(property.value, update.binding, property.key))
          .map(
            (property) =>
              `${formatPlace(update.binding, [property.key])} = ${formatSymbolicValue(property.value)}`,
          )
      : [`${update.binding.name} = ${formatSymbolicValue(update.value)}`];
  const guardPrefix =
    update.guards.length > 0 ? `if ${update.guards.map(formatSymbolicValue).join(" && ")}: ` : "";
  return `${guardPrefix}${assignments.join(", ")}${update.isAsync ? " (async)" : ""}`;
};

const formatHandlerEffects = (handler: Handler): string =>
  truncate(
    [
      ...handler.updates.map(formatUpdate),
      ...handler.delegates.map((delegate) => `calls ${delegate}`),
      ...handler.assertions.map((assertion) => `checks ${assertion.description}`),
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
    case "Unknown": {
      const source = chart.sourceReader.read(chart.file, value.loc);
      return `⚠ ${source ? truncate(source, MAX_UNKNOWN_WIDTH) : `Unknown(${value.reason})`}`;
    }
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
  const isRenderingNothingWhenFalse =
    isRenderingNothing(conditional.alternate) ||
    getValueKey(conditional.alternate) === getValueKey(conditional.test);
  if (!isRenderingNothingWhenFalse) buildNode(conditional.alternate, chart, id, depth + 1, "✗");
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
  file: component.analysis.file,
  sourceReader: createSourceReader(),
});

export const formatRenderTree = (
  component: AnalyzedComponent,
  options: RenderTreeOptions,
): string => {
  const analysis = component.analysis;
  const chart = createFlowchart(component, options);
  const rootId = addNode(chart, analysis.name, "element");
  buildNode(analysis.render, chart, rootId, 0);
  for (const handler of analysis.handlers.filter((handler) => handler.trigger.kind === "Effect"))
    addEventNode(chart, rootId, `${getTriggerLabel(handler)} ⇒ ${formatHandlerEffects(handler)}`);
  return [
    ...formatTitle(component, options.rootDirectory),
    "flowchart TD",
    `${INDENT}classDef event stroke-dasharray: 4 2`,
    ...chart.lines.map((line) => `${INDENT}${line}`),
  ].join("\n");
};
