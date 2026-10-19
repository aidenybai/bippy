import type { SymbolicValue } from "../types";
import { forEachJsxElement } from "./for-each-jsx-element";

export const collectHandlerIds = (render: SymbolicValue): Set<string> => {
  const handlerIds = new Set<string>();
  forEachJsxElement(render, (element) => {
    for (const prop of element.props) if (prop.handlerId) handlerIds.add(prop.handlerId);
  });
  return handlerIds;
};
