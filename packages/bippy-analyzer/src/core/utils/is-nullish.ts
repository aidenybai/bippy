import type { PrimitiveValue } from "../types";

export const isNullish = (value: PrimitiveValue): boolean => value === null || value === undefined;
