import type { AbstractValue } from "../types";
import { isNullish } from "./is-nullish";

export const isNullishCase = (value: AbstractValue): boolean =>
  value.kind === "Literal"
    ? isNullish(value.value)
    : value.kind === "Type" && (value.text === "undefined" || value.text === "null");
