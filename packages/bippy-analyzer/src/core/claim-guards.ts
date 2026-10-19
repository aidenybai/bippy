import { assumeCondition, type Constraints } from "./constraints";
import type { SymbolicValue } from "./types";

export const assumeGuards = (
  guards: SymbolicValue[],
  constraints: Constraints,
): Constraints | null =>
  guards.reduce<Constraints | null>(
    (current, guard) => current && assumeCondition(guard, true, current),
    constraints,
  );
