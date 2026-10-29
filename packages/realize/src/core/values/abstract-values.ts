import type { AbstractValue } from "../types";
import { formatAbstractValue } from "./format";

export const dedupeAbstractValues = (values: AbstractValue[]): AbstractValue[] => [
  ...new Map(values.map((value) => [formatAbstractValue(value), value])).values(),
];
