import type { SymbolicValue } from "../types";
import { isObjectValue } from "./is-object-value";

export const getKnownTruthiness = (value: SymbolicValue): boolean | null => {
  if (value.kind === "Primitive") return Boolean(value.value);
  return isObjectValue(value) ? true : null;
};
