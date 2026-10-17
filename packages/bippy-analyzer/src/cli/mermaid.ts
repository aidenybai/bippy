import { relative } from "node:path";
import { GeneratedSource } from "../react-compiler/HIR/HIR";
import type {
  AnalyzedComponent,
  Handler,
  JsxProp,
  JsxSpreadProp,
  Region,
  State,
  StateReport,
  SymbolicValue,
} from "../core/types";
import { forEachJsxElement } from "../core/utils/for-each-jsx-element";
import {
  CONDITION_SEPARATOR,
  UNCONDITIONAL_LABEL,
  formatLine,
  formatStateLabel,
  formatSymbolicValue,
} from "../core/format";
import { getTestExpression } from "../core/utils/get-test-expression";
import { isRenderingNothing } from "../core/utils/is-rendering-nothing";
import { isEffectHandler } from "../core/collect-handlers";

export const DEFAULT_MAX_STATES = 32;

export interface MermaidOptions {
  rootDirectory: string;
  maxStates: number;
}

interface DiagramContext {
  report: StateReport;
  triggerLabelsByHandler: Map<string, string>;
  listedStates: Set<number>;
}

const INDENT = "  ";
const REGION_SEPARATOR = "--";
const DESCRIPTION_SEPARATOR = " · ";
const MAX_RENDER_WIDTH = 100;
const MAX_TRIGGER_TEXT_WIDTH = 24;

const escapeText = (text: string): string =>
  text.replaceAll(";", ",").replaceAll("::", "∷").replaceAll("<", "#lt;").replaceAll(">", "#gt;");

const truncate = (text: string, width: number): string =>
  text.length > width ? `${text.slice(0, width - 1)}…` : text;

const indent = (line: string): string => `${INDENT}${line}`;

const getMoreId = (regionIndex: number): string => `more${regionIndex + 1}`;

const getPropLabel = (prop: JsxProp | JsxSpreadProp): string =>
  prop.kind === "JsxAttribute" ? prop.name : "{...}";

const getTextContent = (value: SymbolicValue): string => {
  switch (value.kind) {
    case "JSXText":
      return value.value.trim() && JSON.stringify(value.value.trim());
    case "JsxExpression":
    case "JsxFragment":
      return value.children.map(getTextContent).filter(Boolean).join(" ");
    case "Conditional":
    case "ArrayMap":
      return "";
    default:
      if (value.kind === "Primitive" && typeof value.value === "string")
        return JSON.stringify(value.value);
      return isRenderingNothing(value) ? "" : `{${formatSymbolicValue(value)}}`;
  }
};

const getEffectTriggerLabel = (handler: Handler): string => {
  const { trigger } = handler;
  if (trigger.kind === "Event") return `<${trigger.tag}> ${trigger.event}`;
  return trigger.dependencies === "[]"
    ? "on mount"
    : `${trigger.hookKind}(${trigger.dependencies ?? "every render"})`;
};

const collectTriggerLabels = (component: AnalyzedComponent): Map<string, string> => {
  const { analysis } = component;
  const triggerLabelsByHandler = new Map<string, string>();
  forEachJsxElement(analysis.render, (element) => {
    for (const prop of element.props) {
      if (!prop.handlerId || triggerLabelsByHandler.has(prop.handlerId)) continue;
      const textContent = getTextContent(element);
      triggerLabelsByHandler.set(
        prop.handlerId,
        textContent
          ? truncate(textContent, MAX_TRIGGER_TEXT_WIDTH)
          : `<${element.tag.name}> ${getPropLabel(prop)}`,
      );
    }
  });
  for (const handler of analysis.handlers.filter(isEffectHandler))
    triggerLabelsByHandler.set(handler.id, getEffectTriggerLabel(handler));
  return triggerLabelsByHandler;
};

const getCompactLabel = (node: SymbolicValue): string | null => {
  switch (node.kind) {
    case "JsxExpression":
      return `<${node.tag.name}>`;
    case "JsxFragment":
      return null;
    case "JSXText":
      return JSON.stringify(node.value);
    case "ArrayMap":
      return `↻ ${formatSymbolicValue(node.array)}`;
    case "Conditional":
      return `◆ ${formatSymbolicValue(getTestExpression(node))}`;
    case "Unknown":
      return `⚠ Unknown(${node.reason})`;
    default:
      return `{${formatSymbolicValue(node)}}`;
  }
};

const formatCompactRender = (value: SymbolicValue): string => {
  const parts: string[] = [];
  let printedLength = 0;
  const visit = (node: SymbolicValue): void => {
    if (printedLength > MAX_RENDER_WIDTH || isRenderingNothing(node)) return;
    const label = getCompactLabel(node);
    if (label) {
      parts.push(label);
      printedLength += label.length + 1;
    }
    if (node.kind === "JsxExpression" || node.kind === "JsxFragment") node.children.forEach(visit);
  };
  visit(value);
  return truncate(parts.join(" "), MAX_RENDER_WIDTH);
};

const describeState = (state: State, hasRegions: boolean): string => {
  const conditions =
    state.conditions.length > 0 ? state.conditions.join(CONDITION_SEPARATOR) : UNCONDITIONAL_LABEL;
  const rendered = hasRegions
    ? state.fragments.map(formatCompactRender).filter(Boolean).join(" ")
    : formatCompactRender(state.render);
  return escapeText(`${conditions}${DESCRIPTION_SEPARATOR}${rendered || "∅"}`);
};

const getMoreLabel = (region: Region, listedCount: number): string | null => {
  const hiddenCount = region.states.length - listedCount;
  if (hiddenCount > 0)
    return `… ${hiddenCount} more states${region.isTruncated ? ", and more not listed" : ""}`;
  return region.isTruncated ? "… more states not listed" : null;
};

const formatTransitionLines = (
  stateIndex: number,
  regionIndex: number,
  context: DiagramContext,
): string[] => {
  const state = context.report.states[stateIndex];
  if (!state) return [];
  const lines = new Set<string>();
  for (const transition of state.transitions) {
    const triggerLabel =
      context.triggerLabelsByHandler.get(transition.handlerId) ?? transition.handlerId;
    const label = escapeText(`${triggerLabel}${transition.isAsync ? " (async)" : ""}`);
    const targets = transition.targets.filter((target) => target !== stateIndex);
    for (const target of targets) {
      const targetId = context.listedStates.has(target)
        ? formatStateLabel(target)
        : getMoreId(regionIndex);
      lines.add(`${formatStateLabel(stateIndex)} --> ${targetId}: ${label}`);
    }
  }
  return [...lines];
};

const formatRegionLines = (
  region: Region,
  regionIndex: number,
  hasRegions: boolean,
  context: DiagramContext,
): string[] => {
  const listed = region.states.filter((stateIndex) => context.listedStates.has(stateIndex));
  const lines = hasRegions ? [`%% ${region.placeNames.join(", ")}`] : [];
  for (const stateIndex of listed) {
    const state = context.report.states[stateIndex];
    if (state) lines.push(`${formatStateLabel(stateIndex)}: ${describeState(state, hasRegions)}`);
  }
  const moreLabel = getMoreLabel(region, listed.length);
  if (moreLabel) lines.push(`${getMoreId(regionIndex)}: ${moreLabel}`);
  if (region.firstRenderState !== null && context.listedStates.has(region.firstRenderState))
    lines.push(`[*] --> ${formatStateLabel(region.firstRenderState)}`);
  for (const stateIndex of listed)
    lines.push(...formatTransitionLines(stateIndex, regionIndex, context));
  return lines;
};

const formatGroupLines = (title: string, id: string, entries: string[]): string[] =>
  entries.length === 0
    ? []
    : [
        `state "${title}" as ${id} {`,
        ...entries.map((entry, index) => indent(`${id}${index + 1}: ${escapeText(entry)}`)),
        "}",
      ];

const formatClaimLines = (component: AnalyzedComponent): string[] => {
  const { analysis, report } = component;
  return [
    ...formatGroupLines(
      "unreachable branches",
      "unreachable",
      report.unreachableBranches.map((unreachableBranch) =>
        `${unreachableBranch.description} ${formatLine(unreachableBranch.branch.loc)}`.trim(),
      ),
    ),
    ...formatGroupLines(
      "warnings",
      "warnings",
      analysis.warnings.map(
        (warning) => `${warning.kind} ${formatLine(warning.loc)} ${warning.message}`,
      ),
    ),
    ...formatGroupLines(
      "bailouts",
      "bailouts",
      analysis.bailouts.map(
        (bailout) => `${bailout.reason} ${formatLine(bailout.loc)} ${bailout.message}`,
      ),
    ),
  ];
};

const formatStateLines = (component: AnalyzedComponent, context: DiagramContext): string[] => {
  const { analysis, report } = component;
  if (report.regions.length <= 1)
    return report.regions.flatMap((region, regionIndex) =>
      formatRegionLines(region, regionIndex, false, context),
    );
  const regionLines = report.regions.map((region, regionIndex) =>
    formatRegionLines(region, regionIndex, true, context),
  );
  return [
    `state "${analysis.name}" as regions {`,
    ...regionLines.flatMap((lines, regionIndex) =>
      [...(regionIndex > 0 ? [REGION_SEPARATOR] : []), ...lines].map(indent),
    ),
    "}",
  ];
};

const createDiagramContext = (
  component: AnalyzedComponent,
  options: MermaidOptions,
): DiagramContext => ({
  report: component.report,
  triggerLabelsByHandler: collectTriggerLabels(component),
  listedStates: new Set(
    component.report.regions.flatMap((region) => region.states.slice(0, options.maxStates)),
  ),
});

export const formatMermaid = (component: AnalyzedComponent, options: MermaidOptions): string => {
  const { analysis } = component;
  const context = createDiagramContext(component, options);
  const lineSuffix = analysis.loc === GeneratedSource ? "" : `:${analysis.loc.start.line}`;
  const location = `${relative(options.rootDirectory, analysis.file)}${lineSuffix}`;
  return [
    "---",
    `title: ${analysis.name} ${location}`,
    "---",
    "stateDiagram-v2",
    indent("direction LR"),
    ...formatStateLines(component, context).map(indent),
    ...formatClaimLines(component).map(indent),
  ].join("\n");
};
