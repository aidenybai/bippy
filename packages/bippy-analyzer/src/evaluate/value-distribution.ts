import type { StaticValue } from "../types.js";

export const MAX_DISTRIBUTED_ALTERNATIVES = 8;

export const isPrimitiveBranch = (value: StaticValue): boolean =>
  value.kind === "branch" &&
  value.alternatives.length <= MAX_DISTRIBUTED_ALTERNATIVES &&
  value.alternatives.every(
    (alternative) => alternative.kind === "primitive" || alternative.kind === "regexp",
  );
