import { relative } from "node:path";
import { getValueLabels } from "../core/model/domains";
import { GeneratedSource } from "../react-compiler/HIR/HIR";
import type { AnalyzedComponent } from "../core/types";
import { formatLine } from "../core/values/format";
import type { ViewTransition } from "../core/model/types";
import { unescapeQuotedLiterals } from "../core/labels/text";

interface MermaidOptions {
  rootDirectory: string;
}

const INDENT = "  ";

const escapeText = (text: string): string =>
  unescapeQuotedLiterals(text)
    .replaceAll(/\s*\n\s*/g, " ")
    .replaceAll(";", "#59;")
    .replaceAll(":", "#58;")
    .replaceAll("<", "#lt;")
    .replaceAll(">", "#gt;");

const indent = (line: string): string => `${INDENT}${line}`;

const groupEdges = (
  edges: ViewTransition[],
): Map<string, { from: string; to: string; labels: string[] }> => {
  const groups = new Map<string, { from: string; to: string; labels: string[] }>();
  for (const edge of edges) {
    const key = `${edge.from}\0${edge.to}`;
    const group = groups.get(key) ?? { from: edge.from, to: edge.to, labels: [] };
    if (!group.labels.includes(edge.action)) group.labels.push(edge.action);
    groups.set(key, group);
  }
  return groups;
};

export const formatMermaid = (component: AnalyzedComponent, options: MermaidOptions): string => {
  const { analysis, model } = component;
  const { stateSpace } = model;
  const lineSuffix = analysis.loc === GeneratedSource ? "" : `:${analysis.loc.start.line}`;
  const location = `${relative(options.rootDirectory, analysis.file)}${lineSuffix}`;
  const viewIds = new Map(
    stateSpace.reachableViews.map((label, index) => [label, `S${index + 1}`]),
  );
  const getId = (label: string): string => viewIds.get(label) ?? "S0";
  const stateLines = stateSpace.reachableViews.map(
    (label) => `${getId(label)}: ${escapeText(label)}`,
  );
  const initialLines = stateSpace.initialViews.map((label) => `[*] --> ${getId(label)}`);
  const edgeLines = [...groupEdges(stateSpace.edges).values()].map(
    ({ from, to, labels }) => `${getId(from)} --> ${getId(to)}: ${escapeText(labels.join(", "))}`,
  );
  const variableLines = model.variables.map(
    (variable) =>
      `%% ${variable.name} = ${variable.label} (${variable.source}): ${getValueLabels(variable.domain).join(" | ")}`,
  );
  const findingLines = model.findings.map(
    (finding) =>
      `%% ⚠ ${finding.message}${finding.loc && finding.loc !== GeneratedSource ? ` (${formatLine(finding.loc)})` : ""}`,
  );
  const summary = `%% ${stateSpace.stateCount} states${stateSpace.isTruncated ? ", truncated" : ""}`;
  return [
    "---",
    `title: ${analysis.name} ${location}`,
    "---",
    "stateDiagram-v2",
    indent("direction LR"),
    ...[
      summary,
      ...variableLines,
      ...stateLines,
      ...initialLines,
      ...edgeLines,
      ...findingLines,
    ].map(indent),
  ].join("\n");
};
