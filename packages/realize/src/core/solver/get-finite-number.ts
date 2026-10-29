import type { SymbolicValue } from "../types";

export const getFiniteNumber = (value: SymbolicValue): number | null =>
  value.kind === "Primitive" && typeof value.value === "number" && Number.isFinite(value.value)
    ? value.value
    : null;
