import type { SymbolicValue } from "../types";
import { isNullish } from "./is-nullish";

export const isNullishValue = (value: SymbolicValue): boolean =>
  value.kind === "Primitive" && isNullish(value.value);
