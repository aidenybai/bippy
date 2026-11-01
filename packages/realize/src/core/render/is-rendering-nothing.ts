import type { SymbolicValue } from "../types";
import { isNullish } from "../values/is-nullish";

export const isRenderingNothing = (value: SymbolicValue): boolean =>
  value.kind === "Primitive" && (isNullish(value.value) || typeof value.value === "boolean");
