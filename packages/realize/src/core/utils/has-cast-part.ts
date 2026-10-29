import type { SymbolicValue } from "../types";
import { forEachSymbolicValue } from "./for-each-symbolic-value";

export const hasCastPart = (value: SymbolicValue): boolean => {
  let isCast = false;
  forEachSymbolicValue(value, (part) => {
    if (part.kind === "Unknown" && part.reason === "cast") isCast = true;
  });
  return isCast;
};
