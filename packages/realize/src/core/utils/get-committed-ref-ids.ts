import type { ComponentAnalysis } from "../types";
import { forEachJsxElement } from "./for-each-jsx-element";
import { forEachSymbolicValue } from "./for-each-symbolic-value";

export const getCommittedRefIds = (analysis: ComponentAnalysis): Set<number> | null => {
  const refIds = new Set<number>();
  let hasCallbackRef = false;
  forEachJsxElement(analysis.render, (element) => {
    for (const prop of element.props) {
      if (prop.kind === "JsxAttribute" && prop.name === "ref" && prop.value.kind === "Function")
        hasCallbackRef = true;
      forEachSymbolicValue(prop.value, (part) => {
        if (part.kind === "Binding" && part.binding.kind === "ref") refIds.add(part.binding.id);
      });
    }
  });
  for (const handler of analysis.handlers)
    for (const update of handler.updates)
      if (update.binding.kind === "ref") refIds.add(update.binding.id);
  return hasCallbackRef ? null : refIds;
};
