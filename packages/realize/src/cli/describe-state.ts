import type { State, SymbolicValue } from "../core/types";
import {
  CONDITION_SEPARATOR,
  UNCONDITIONAL_LABEL,
  formatSymbolicValue,
} from "../core/values/format";
import { getTestExpression } from "../core/values/get-test-expression";
import { isRenderingNothing } from "../core/states/is-rendering-nothing";
import { simplifyConditions } from "./simplify-conditions";
import type { SourceReader } from "./source-text";
import { truncate } from "./text";

export interface StateDescriber {
  file: string;
  sourceReader: SourceReader;
}

type UnknownValue = Extract<SymbolicValue, { kind: "Unknown" }>;

const DESCRIPTION_SEPARATOR = " · ";
const MAX_RENDER_WIDTH = 100;
const MAX_UNKNOWN_WIDTH = 40;

export const describeUnknown = (node: UnknownValue, describer: StateDescriber): string => {
  const source = describer.sourceReader.read(describer.file, node.loc);
  return `⚠ ${source ? truncate(source, MAX_UNKNOWN_WIDTH) : `Unknown(${node.reason})`}`;
};

const getCompactLabel = (node: SymbolicValue, describer: StateDescriber): string | null => {
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
      return describeUnknown(node, describer);
    default:
      return `{${formatSymbolicValue(node)}}`;
  }
};

const formatCompactRender = (value: SymbolicValue, describer: StateDescriber): string => {
  const parts: string[] = [];
  let printedLength = 0;
  const visit = (node: SymbolicValue): void => {
    if (printedLength > MAX_RENDER_WIDTH || isRenderingNothing(node)) return;
    const label = getCompactLabel(node, describer);
    if (label) {
      parts.push(label);
      printedLength += label.length + 1;
    }
    if (node.kind === "JsxExpression" || node.kind === "JsxFragment") node.children.forEach(visit);
  };
  visit(value);
  return truncate(parts.join(" "), MAX_RENDER_WIDTH);
};

export const describeState = (
  state: State,
  hasRegions: boolean,
  describer: StateDescriber,
): string => {
  const conditions = simplifyConditions(state.conditions);
  const conditionText =
    conditions.length > 0 ? conditions.join(CONDITION_SEPARATOR) : UNCONDITIONAL_LABEL;
  const rendered = hasRegions
    ? state.fragments
        .map((fragment) => formatCompactRender(fragment, describer))
        .filter(Boolean)
        .join(" ")
    : formatCompactRender(state.render, describer);
  return `${conditionText}${DESCRIPTION_SEPARATOR}${rendered || "∅"}`;
};
