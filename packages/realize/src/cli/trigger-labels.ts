import type {
  AnalyzedComponent,
  Handler,
  JsxContainerValue,
  JsxExpressionValue,
  JsxProp,
  JsxSpreadProp,
  SourceLocation,
  SymbolicValue,
} from "../core/types";
import { forEachJsxElement } from "../core/states/for-each-jsx-element";
import { formatSymbolicValue } from "../core/values/format";
import { isEffectHandler } from "../core/handlers/handler-predicates";
import type { SourceReader } from "./source-text";
import { truncate } from "./text";

const MAX_TEXT_WIDTH = 24;
const MAX_HANDLER_WIDTH = 40;
const UNLABELED_CHILDREN_TAGS = new Set(["select", "textarea"]);
const ARROW_FUNCTION_HEAD = /^(\(\s*\)|\(?\w+\)?)\s*=>\s*/;
const DECLARED_NAME = /(?:const|let|var|function)\s+(\w+)\s*=?\s*$/;

const getChildrenText = (value: JsxContainerValue): string =>
  value.children.map(getLiteralText).filter(Boolean).join(" ");

const getLiteralText = (value: SymbolicValue): string => {
  switch (value.kind) {
    case "JSXText":
      return value.value.trim() && JSON.stringify(value.value.trim());
    case "JsxExpression":
      return value.props.some((prop) => prop.handlerId) ? "" : getChildrenText(value);
    case "JsxFragment":
      return getChildrenText(value);
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
  const text = UNLABELED_CHILDREN_TAGS.has(element.tag.name) ? "" : getChildrenText(element);
  if (text) return truncate(text, MAX_TEXT_WIDTH);
  const handlerText = prop.kind === "JsxAttribute" ? formatHandlerValue(prop, sourceReader) : null;
  if (handlerText) return truncate(handlerText, MAX_HANDLER_WIDTH);
  return `<${element.tag.name}> ${prop.kind === "JsxAttribute" ? prop.name : "{...}"}`;
};

const MAX_NAMED_DEPENDENCIES = 2;

const BEFORE_PAINT_HOOKS = new Set(["useLayoutEffect", "useInsertionEffect"]);

const splitTopLevel = (text: string): string[] => {
  const parts = [""];
  let depth = 0;
  for (const character of text) {
    if ("([{".includes(character)) depth++;
    if (")]}".includes(character)) depth--;
    if (character === "," && depth === 0) parts.push("");
    else parts[parts.length - 1] += character;
  }
  return parts.map((part) => part.trim().replace(/\s+/g, " ")).filter(Boolean);
};

const describeDependencies = (dependencies: string): string => {
  const names = splitTopLevel(dependencies.trim().replace(/^\[|\]$/g, ""));
  if (names.length <= MAX_NAMED_DEPENDENCIES) return `${names.join(" or ")} changes`;
  const shown = names.slice(0, MAX_NAMED_DEPENDENCIES).join(", ");
  return `${shown} or ${names.length - MAX_NAMED_DEPENDENCIES} more change`;
};

export const getEffectTriggerLabel = (handler: Handler): string => {
  const { trigger } = handler;
  if (trigger.kind === "Event") return `<${trigger.tag}> ${trigger.event}`;
  if (trigger.kind === "Render") return "during render";
  if (trigger.hookKind === "Custom") return "hook callback";
  const isBeforePaint = BEFORE_PAINT_HOOKS.has(trigger.hookKind);
  if (trigger.dependencies === "[]")
    return isBeforePaint ? "before first paint" : "after first render";
  if (trigger.dependencies === null)
    return isBeforePaint ? "before every paint" : "after every render";
  const changes = describeDependencies(trigger.dependencies);
  return isBeforePaint ? `before paint, after ${changes}` : `after ${changes}`;
};

const MAX_SHARED_LABELS = 3;

const joinTriggerLabels = (labels: string[]): string =>
  labels.length <= MAX_SHARED_LABELS
    ? labels.join(", ")
    : `${labels.slice(0, MAX_SHARED_LABELS).join(", ")} +${labels.length - MAX_SHARED_LABELS} more`;

export const collectTriggerLabels = (
  component: Pick<AnalyzedComponent, "analysis">,
  sourceReader: SourceReader,
): Map<string, string> => {
  const { analysis } = component;
  const eventLabelsByHandler = new Map<string, Set<string>>();
  forEachJsxElement(analysis.render, (element) => {
    for (const prop of element.props) {
      if (!prop.handlerId) continue;
      const labels = eventLabelsByHandler.get(prop.handlerId) ?? new Set();
      eventLabelsByHandler.set(
        prop.handlerId,
        labels.add(getEventTriggerLabel(element, prop, sourceReader)),
      );
    }
  });
  const triggerLabelsByHandler = new Map(
    [...eventLabelsByHandler].map(([handlerId, labels]) => [
      handlerId,
      joinTriggerLabels([...labels]),
    ]),
  );
  for (const handler of analysis.handlers.filter(isEffectHandler))
    triggerLabelsByHandler.set(handler.id, getEffectTriggerLabel(handler));
  return triggerLabelsByHandler;
};
