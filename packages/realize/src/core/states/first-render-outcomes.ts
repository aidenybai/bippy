import type { Constraints } from "../solver/constraints";

export interface FirstRenderOutcomes {
  constraints: Constraints;
  outcomesByBranchKey: Map<string, boolean | null>;
}
