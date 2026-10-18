import type {
  AnalyzedComponent,
  Handler,
  JsxExpressionValue,
  JsxProp,
  JsxSpreadProp,
  SourceLocation,
  SymbolicValue,
} from "../core/types";
import { forEachJsxElement } from "../core/utils/for-each-jsx-element";
import { formatSymbolicValue } from "../core/format";
import { isEffectHandler } from "../core/collect-handlers";
import type { SourceReader } from "./source-text";
import { truncate } from "./text";

const MAX_TEXT_WIDTH = 24;
const MAX_HANDLER_WIDTH = 40;
const ARROW_FUNCTION_HEAD = /^(\(\s*\)|\(?\w+\)?)\s*=>\s*/;
const DECLARED_NAME = /(?:const|let|var|function)\s+(\w+)\s*=?\s*$/;

const getLiteralText = (value: SymbolicValue): string => {
  switch (value.kind) {
    case "JSXText":
      return value.value.trim() && JSON.stringify(value.value.trim());
    case "JsxExpression":
    case "JsxFragment":
      return value.children.map(getLiteralText).filter(Boolean).join(" ");
    case "Primitive":
      return typeof value.value === "string" ? JSON.stringify(value.value) : "";
    default:
      return "";
  }
};

const formatFunctionValue = (
  prop: JsxProp,
  loc: SourceLocation,
  sourceReader: SourceReader,
): string | null => {
  const declaredName = sourceReader.readLineBefore(prop.file, loc)?.match(DECLARED_NAME)?.[1];
  if (declaredName) return declaredName;
  const body = sourceReader.read(prop.file, loc)?.replace(ARROW_FUNCTION_HEAD, "");
  return body && !body.startsWith("{") ? body : null;
};

const formatHandlerValue = (prop: JsxProp, sourceReader: SourceReader): string | null => {
  if (prop.value.kind === "Function")
    return formatFunctionValue(prop, prop.value.loc, sourceReader);
  return formatSymbolicValue(prop.value);
};

const getEventTriggerLabel = (
  element: JsxExpressionValue,
  prop: JsxProp | JsxSpreadProp,
  sourceReader: SourceReader,
): string => {
  const text = getLiteralText(element);
  if (text) return truncate(text, MAX_TEXT_WIDTH);
  const handlerText = prop.kind === "JsxAttribute" ? formatHandlerValue(prop, sourceReader) : null;
  if (handlerText) return truncate(handlerText, MAX_HANDLER_WIDTH);
  return `<${element.tag.name}> ${prop.kind === "JsxAttribute" ? prop.name : "{...}"}`;
};

const getEffectTriggerLabel = (handler: Handler): string => {
  const { trigger } = handler;
  if (trigger.kind === "Event") return `<${trigger.tag}> ${trigger.event}`;
  return trigger.dependencies === "[]"
    ? "on mount"
    : `${trigger.hookKind}(${trigger.dependencies ?? "every render"})`;
};

export const collectTriggerLabels = (
  component: AnalyzedComponent,
  sourceReader: SourceReader,
): Map<string, string> => {
  const { analysis } = component;
  const triggerLabelsByHandler = new Map<string, string>();
  forEachJsxElement(analysis.render, (element) => {
    for (const prop of element.props) {
      if (!prop.handlerId || triggerLabelsByHandler.has(prop.handlerId)) continue;
      triggerLabelsByHandler.set(prop.handlerId, getEventTriggerLabel(element, prop, sourceReader));
    }
  });
  for (const handler of analysis.handlers.filter(isEffectHandler))
    triggerLabelsByHandler.set(handler.id, getEffectTriggerLabel(handler));
  return triggerLabelsByHandler;
};
