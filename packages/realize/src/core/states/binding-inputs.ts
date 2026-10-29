import type { Binding, SymbolicValue } from "../types";
import { forEachSymbolicValue } from "../values/for-each-symbolic-value";

export const addReadBindings = (bindingIds: Set<number>, value: SymbolicValue | null): void => {
  if (value)
    forEachSymbolicValue(value, (part) => {
      if (part.kind === "Binding") bindingIds.add(part.binding.id);
    });
};

export const createBindingInputsAdder = (
  bindings: Binding[],
): ((bindingIds: Set<number>) => void) => {
  const bindingsById = new Map(bindings.map((binding) => [binding.id, binding]));
  return (bindingIds) => {
    for (const bindingId of bindingIds) {
      const binding = bindingsById.get(bindingId);
      if (!binding) continue;
      for (const place of binding.inputPlaces) bindingIds.add(place.bindingId);
      if (binding.lengthLimit) bindingIds.add(binding.lengthLimit.arrayLength.bindingId);
      addReadBindings(bindingIds, binding.alias);
      addReadBindings(bindingIds, binding.range?.inner ?? null);
      if (binding.derived && binding.derived.kind === "Call")
        binding.derived.operands.forEach((operand) => addReadBindings(bindingIds, operand));
      if (binding.derived && binding.derived.kind === "String")
        addReadBindings(bindingIds, binding.derived.receiver);
    }
  };
};
