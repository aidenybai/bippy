import { evaluateCondition } from "../solver/constraints";
import type { Constraints } from "../solver/constraints";
import type { JsxExpressionValue, SymbolicValue } from "../types";
import { forEachJsxElement } from "../states/for-each-jsx-element";
import { isDisabledEvent } from "./is-disabled-event";

const DISABLEABLE_TAGS = new Set(["button", "input", "select", "textarea"]);

const isDisabled = (element: JsxExpressionValue, constraints: Constraints): boolean =>
  element.tag.kind === "BuiltinTag" &&
  DISABLEABLE_TAGS.has(element.tag.name) &&
  element.props.some(
    (prop) =>
      prop.kind === "JsxAttribute" &&
      prop.name === "disabled" &&
      evaluateCondition(prop.value, constraints) === true,
  );

export const collectHandlerIds = (render: SymbolicValue, constraints: Constraints): Set<string> => {
  const handlerIds = new Set<string>();
  forEachJsxElement(render, (element) => {
    const isElementDisabled = isDisabled(element, constraints);
    for (const prop of element.props)
      if (
        prop.handlerId &&
        !(isElementDisabled && prop.kind === "JsxAttribute" && isDisabledEvent(prop.name))
      )
        handlerIds.add(prop.handlerId);
  });
  return handlerIds;
};
