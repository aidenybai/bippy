import { evaluateCondition } from "../constraints";
import type { Constraints } from "../constraints";
import type { JsxExpressionValue, SymbolicValue } from "../types";
import { forEachJsxElement } from "./for-each-jsx-element";

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
    if (isDisabled(element, constraints)) return;
    for (const prop of element.props) if (prop.handlerId) handlerIds.add(prop.handlerId);
  });
  return handlerIds;
};
