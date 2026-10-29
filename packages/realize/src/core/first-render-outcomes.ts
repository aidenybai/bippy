import type { Constraints } from "./constraints";

export interface FirstRenderOutcomes {
  constraints: Constraints;
  outcomesByBranchKey: Map<string, boolean | null>;
}
