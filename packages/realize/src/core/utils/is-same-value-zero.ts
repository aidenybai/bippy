import type { PrimitiveValue } from "../types";

export const isSameValueZero = (left: PrimitiveValue, right: PrimitiveValue): boolean =>
  left === right || (Number.isNaN(left) && Number.isNaN(right));
