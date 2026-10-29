import type { Binding, SymbolicValue } from "../types";
import { getBindingPlace } from "./get-binding-place";
import { getValuePlace } from "./get-value-place";
import { isSamePlace } from "./is-same-place";

export const isUnchangedField = (value: SymbolicValue, binding: Binding, path: string[]): boolean =>
  value.kind === "Binding" && isSamePlace(getValuePlace(value), getBindingPlace(binding, path));
