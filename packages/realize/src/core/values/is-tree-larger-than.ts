import type { SymbolicValue, UnknownOrigin } from "../types";
import { getChildValues } from "./for-each-symbolic-value";

const getOriginValues = (origin: UnknownOrigin | undefined): SymbolicValue[] => {
  switch (origin?.kind) {
    case "Member":
      return [origin.object];
    case "Call":
      return [origin.callee, ...origin.argumentValues];
    case "Settled":
      return [origin.promise];
    case "Value":
      return [origin.value];
    default:
      return [];
  }
};

export const isTreeLargerThan = (root: SymbolicValue, limit: number): boolean => {
  const pending = [root];
  let count = 0;
  for (let value = pending.pop(); value !== undefined; value = pending.pop()) {
    count++;
    if (count > limit) return true;
    pending.push(...getChildValues(value));
    if (value.kind === "Unknown") pending.push(...getOriginValues(value.origin));
  }
  return false;
};
