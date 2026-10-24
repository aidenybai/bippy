import type { SymbolicValue, Binding } from "../types";

export const isWholeBinding = (value: SymbolicValue, binding: Binding): boolean =>
  value.kind === "Binding" && value.binding.id === binding.id && value.path.length === 0;
