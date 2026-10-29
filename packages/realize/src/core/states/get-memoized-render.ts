import type { BindingValue, SymbolicValue } from "../types";

export const getMemoizedRender = (value: BindingValue): SymbolicValue | null =>
  value.path.length === 0 && value.binding.hookKind === "useMemo" ? value.binding.initial : null;
