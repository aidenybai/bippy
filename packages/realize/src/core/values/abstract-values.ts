import type { AbstractValue } from "../types";
import { formatAbstractValue } from "./format";
import { isNullish } from "./is-nullish";

export const dedupeAbstractValues = (values: AbstractValue[]): AbstractValue[] => [
  ...new Map(values.map((value) => [formatAbstractValue(value), value])).values(),
];

export const isNullishCase = (value: AbstractValue): boolean =>
  value.kind === "Literal"
    ? isNullish(value.value)
    : value.kind === "Type" && (value.text === "undefined" || value.text === "null");
