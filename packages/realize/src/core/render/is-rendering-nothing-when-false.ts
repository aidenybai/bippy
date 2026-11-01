import type { ConditionalValue } from "../types";
import { getValueKey } from "../values/get-value-key";
import { isRenderingNothing } from "./is-rendering-nothing";

const isLogicalAnd = (conditional: ConditionalValue): boolean =>
  getValueKey(conditional.alternate) === getValueKey(conditional.test);

export const isRenderingNothingWhenFalse = (conditional: ConditionalValue): boolean =>
  isRenderingNothing(conditional.alternate) || isLogicalAnd(conditional);
