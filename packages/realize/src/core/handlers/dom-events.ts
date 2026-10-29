import { GeneratedSource } from "../../react-compiler/HIR/HIR";
import type { JsxExpressionValue, JsxProp, JsxSpreadProp, JsxTag, SymbolicValue } from "../types";
import {
  createUnknown,
  foldUnary,
  getPassedCallbacks,
  isCallableValue,
} from "../values/symbolic-values";
import { isStateBinding } from "../values/is-state-binding";
import { EVENT_ARGUMENT } from "./handler-predicates";

export const EVENT_HANDLER_PATTERN = /^on[A-Z]/;
export const CAPTURE_SUFFIX = "Capture";

export const getBaseEvent = (propName: string): string =>
  propName.endsWith(CAPTURE_SUFFIX) ? propName.slice(0, -CAPTURE_SUFFIX.length) : propName;

export const NON_BUBBLING_EVENTS = new Set([
  "onScroll",
  "onScrollEnd",
  "onMouseEnter",
  "onMouseLeave",
  "onPointerEnter",
  "onPointerLeave",
]);
export const MAYBE_BUBBLING_EVENTS = new Set(["onToggle", "onBeforeToggle"]);
const FORM_ACTION_PROPS = new Map([
  ["form", "action"],
  ["button", "formAction"],
  ["input", "formAction"],
]);
const FORM_ACTION_EVENTS = new Map([
  ["action", "submit"],
  ["formAction", "click"],
]);

export const ANY_EVENT = "*";

const isFormActionProp = (tag: JsxTag, prop: JsxProp): boolean =>
  tag.kind === "BuiltinTag" && FORM_ACTION_PROPS.get(tag.name) === prop.name;

export const getHeldValue = (value: SymbolicValue): SymbolicValue =>
  value.kind === "Binding" && value.path.length === 0 && isStateBinding(value.binding)
    ? (value.binding.initial ?? value)
    : value;

export const isHandlerProp = (tag: JsxTag, prop: JsxProp): boolean =>
  EVENT_HANDLER_PATTERN.test(prop.name) ||
  isFormActionProp(tag, prop) ||
  (tag.kind !== "BuiltinTag" && getPassedCallbacks([getHeldValue(prop.value)]).length > 0);

export const getTriggerEvent = (prop: JsxProp): string =>
  FORM_ACTION_EVENTS.get(prop.name) ?? prop.name;

export const isRefCallback = (prop: JsxProp): boolean =>
  prop.name === "ref" && isCallableValue(prop.value);

export const getBubblingEvent = (prop: JsxProp | JsxSpreadProp): string[] => {
  if (prop.kind !== "JsxAttribute" || !EVENT_HANDLER_PATTERN.test(prop.name)) return [];
  const event = getBaseEvent(prop.name);
  return NON_BUBBLING_EVENTS.has(event) ? [] : [event];
};

export const ENTER_EVENTS = new Set(["onMouseEnter", "onPointerEnter"]);

export const LEAVE_EVENTS = new Set(["onMouseLeave", "onPointerLeave"]);

const TEXT_INPUT_TYPES = new Set([
  "color",
  "date",
  "datetime",
  "datetime-local",
  "email",
  "month",
  "number",
  "password",
  "range",
  "search",
  "tel",
  "text",
  "time",
  "url",
  "week",
]);

const INPUT_EVENTS = new Set(["onInput", "onChange"]);

export const isTextInput = (element: JsxExpressionValue): boolean => {
  if (element.tag.kind !== "BuiltinTag") return false;
  if (element.tag.name === "textarea") return true;
  if (element.tag.name !== "input") return false;
  const type = getAttribute(element, "type")?.value;
  if (type === undefined) return true;
  return (
    type.kind !== "Primitive" ||
    (typeof type.value === "string" && TEXT_INPUT_TYPES.has(type.value))
  );
};

export const getDispatchedEvents = (element: JsxExpressionValue, prop: JsxProp): string[] => {
  if (getCheckableType(element) !== null && CHECK_EVENTS.has(prop.name))
    return ["onClick", "onChange", "onInput"];
  if (INPUT_EVENTS.has(prop.name) && isTextInput(element)) return ["onInput", "onChange"];
  return [prop.name];
};

export const REF_METHOD_EVENTS = new Map([
  ["focus", "onFocus"],
  ["blur", "onBlur"],
  ["click", "onClick"],
  ["requestSubmit", "onSubmit"],
  ["reset", "onReset"],
]);

export const ACTIVATABLE_TAGS = new Set([
  "a",
  "button",
  "input",
  "label",
  "select",
  "summary",
  "textarea",
]);

export const INTERACTIVE_TAGS = new Set([...ACTIVATABLE_TAGS, "details"]);

const LABELABLE_TAGS = new Set([
  "button",
  "input",
  "meter",
  "output",
  "progress",
  "select",
  "textarea",
]);

export const isLabelable = (element: JsxExpressionValue): boolean => {
  if (element.tag.kind !== "BuiltinTag" || !LABELABLE_TAGS.has(element.tag.name)) return false;
  const type = getAttribute(element, "type")?.value;
  return !(type?.kind === "Primitive" && type.value === "hidden");
};

const ENABLEABLE_TAGS = new Set(["button", "input", "select", "textarea"]);

export const getEnabledGuards = (element: JsxExpressionValue): SymbolicValue[] => {
  if (element.tag.kind !== "BuiltinTag" || !ENABLEABLE_TAGS.has(element.tag.name)) return [];
  const disabled = element.props.find(
    (prop): prop is JsxProp => prop.kind === "JsxAttribute" && prop.name === "disabled",
  );
  return disabled ? [foldUnary("!", disabled.value)] : [];
};

export const getAttribute = (element: JsxExpressionValue, name: string): JsxProp | undefined =>
  element.props.find((prop): prop is JsxProp => prop.kind === "JsxAttribute" && prop.name === name);

const CHECKABLE_TYPES = new Set(["checkbox", "radio"]);

export const CHECK_EVENTS = new Set(["onChange", "onClick", "onInput"]);

export interface ControlEvent {
  argument: SymbolicValue;
  guards: SymbolicValue[];
}

export const getCheckableType = (element: JsxExpressionValue): string | null => {
  if (element.tag.kind !== "BuiltinTag" || element.tag.name !== "input") return null;
  const type = getAttribute(element, "type")?.value;
  return type?.kind === "Primitive" &&
    typeof type.value === "string" &&
    CHECKABLE_TYPES.has(type.value)
    ? type.value
    : null;
};

export const getControlEvent = (
  element: JsxExpressionValue,
  prop: JsxProp,
): ControlEvent | null => {
  const type = getCheckableType(element);
  if (type === null || !CHECK_EVENTS.has(prop.name)) return null;
  const isRadio = type === "radio";
  const checked = getAttribute(element, "checked")?.value;
  const value = getAttribute(element, "value")?.value ?? { kind: "Primitive", value: "on" };
  const nextChecked: SymbolicValue | null = checked
    ? isRadio
      ? { kind: "Primitive", value: true }
      : foldUnary("!", checked)
    : null;
  const target: SymbolicValue = {
    kind: "ObjectExpression",
    properties: [
      { key: "value", value },
      ...(nextChecked ? [{ key: "checked", value: nextChecked }] : []),
    ],
    spreads: [createUnknown("event", GeneratedSource)],
  };
  return {
    argument: createTargetEvent(target),
    guards: isRadio && checked && prop.name !== "onClick" ? [foldUnary("!", checked)] : [],
  };
};

const isBlankText = (child: SymbolicValue): boolean =>
  child.kind === "Primitive" && (typeof child.value !== "string" || child.value.trim() === "");

const getOptionValue = (child: SymbolicValue): string | null => {
  if (child.kind !== "JsxExpression" || child.tag.kind !== "BuiltinTag") return null;
  if (child.tag.name !== "option") return null;
  const value = getAttribute(child, "value")?.value;
  const [text] = child.children;
  const shown = value ?? (child.children.length === 1 ? text : undefined);
  return shown?.kind === "Primitive" && shown.value !== null && shown.value !== undefined
    ? String(shown.value)
    : null;
};

export const getOptionValues = (select: JsxExpressionValue): string[] | null => {
  const values = select.children.filter((child) => !isBlankText(child)).map(getOptionValue);
  return values.length > 0 && values.every((value) => value !== null) ? values : null;
};

export const createTargetEvent = (target: SymbolicValue): SymbolicValue => ({
  kind: "ObjectExpression",
  properties: [
    { key: "target", value: target },
    { key: "currentTarget", value: target },
  ],
  spreads: [EVENT_ARGUMENT],
});

const SUBMIT_TYPES = new Set(["submit", "image"]);

const NON_SUBMIT_BUTTON_TYPES = new Set(["button", "reset"]);

export const getResetControl = (element: JsxExpressionValue): "always" | "maybe" | null => {
  if (element.tag.kind !== "BuiltinTag") return null;
  if (element.tag.name !== "button" && element.tag.name !== "input") return null;
  const typeValue = getAttribute(element, "type")?.value;
  if (typeValue && typeValue.kind !== "Primitive") return "maybe";
  return typeValue?.value === "reset" ? "always" : null;
};

export const getSubmitControl = (element: JsxExpressionValue): "always" | "maybe" | null => {
  if (element.tag.kind !== "BuiltinTag") return null;
  const isButton = element.tag.name === "button";
  if (!isButton && element.tag.name !== "input") return null;
  const typeValue = getAttribute(element, "type")?.value;
  if (typeValue && typeValue.kind !== "Primitive") return "maybe";
  const type = typeof typeValue?.value === "string" ? typeValue.value : "";
  const isSubmit = isButton ? !NON_SUBMIT_BUTTON_TYPES.has(type) : SUBMIT_TYPES.has(type);
  return isSubmit ? "always" : null;
};
