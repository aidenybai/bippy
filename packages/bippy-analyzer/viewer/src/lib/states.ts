import type { ViewBranch, ViewState } from "../model";

export type Arm = "consequent" | "alternate";

export const getArmOutcome = (branch: ViewBranch, state: ViewState): Arm | null => {
  if (state.conditions.includes(branch.test)) return "consequent";
  if (state.conditions.includes(branch.negated)) return "alternate";
  return null;
};
