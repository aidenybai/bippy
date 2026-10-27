import type { SymbolicValue } from "../types";
import { forEachSymbolicValue } from "./for-each-symbolic-value";

const collectCallBindingIds = (values: SymbolicValue[]): Set<number> => {
  const bindingIds = new Set<number>();
  for (const value of values)
    forEachSymbolicValue(value, (part) => {
      if (part.kind === "Binding" && part.binding.kind === "call") bindingIds.add(part.binding.id);
    });
  return bindingIds;
};

export const addsCallResult = (value: SymbolicValue, argumentValues: SymbolicValue[]): boolean => {
  const argumentCallIds = collectCallBindingIds(argumentValues);
  return [...collectCallBindingIds([value])].some((bindingId) => !argumentCallIds.has(bindingId));
};
