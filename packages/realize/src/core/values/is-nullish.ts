import type { PrimitiveValue } from "../types";

export const isNullish = (value: PrimitiveValue): value is null | undefined =>
  value === null || value === undefined;
