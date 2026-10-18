import type { ViewBranch, ViewComponent, ViewState } from "../model";

export type Arm = "consequent" | "alternate";

export type ArmStatus = "live" | "dead" | "added" | "removed" | "unchanged";

export interface ArmMark {
  branch: ViewBranch;
  arm: Arm;
  status: ArmStatus;
}

export const getArmOutcome = (branch: ViewBranch, state: ViewState): Arm | null => {
  if (state.conditions.includes(branch.test)) return "consequent";
  if (state.conditions.includes(branch.negated)) return "alternate";
  return null;
};

const getOppositeArm = (arm: Arm): Arm => (arm === "consequent" ? "alternate" : "consequent");

export const getBaselineState = (component: ViewComponent, state: ViewState): ViewState | null => {
  const region = component.regions[state.regionIndex];
  if (region?.firstRenderState === null || region?.firstRenderState === undefined) return null;
  return component.states[region.firstRenderState] ?? null;
};

export const getArmMarks = (component: ViewComponent, state: ViewState): ArmMark[] => {
  const baseline = getBaselineState(component, state);
  const marks: ArmMark[] = [];
  for (const branch of component.branches) {
    const arm = getArmOutcome(branch, state);
    if (!arm) continue;
    const baselineArm = baseline && getArmOutcome(branch, baseline);
    if (!baseline || baseline === state) {
      marks.push({ branch, arm, status: "live" });
      marks.push({ branch, arm: getOppositeArm(arm), status: "dead" });
    } else if (baselineArm === arm) {
      marks.push({ branch, arm, status: "unchanged" });
    } else {
      marks.push({ branch, arm, status: "added" });
      marks.push({ branch, arm: getOppositeArm(arm), status: "removed" });
    }
  }
  return marks;
};

export interface ArmChange {
  branch: ViewBranch;
  arm: Arm;
  change: "appears" | "disappears";
}

export const getArmChanges = (
  component: ViewComponent,
  from: ViewState,
  to: ViewState,
): ArmChange[] =>
  component.branches.flatMap((branch) => {
    const before = getArmOutcome(branch, from);
    const after = getArmOutcome(branch, to);
    if (!before || !after || before === after) return [];
    return [
      { branch, arm: after, change: "appears" as const },
      { branch, arm: before, change: "disappears" as const },
    ];
  });

export const getStatesByOutcome = (
  component: ViewComponent,
  branch: ViewBranch,
): { trueIn: ViewState[]; falseIn: ViewState[] } => ({
  trueIn: component.states.filter((state) => getArmOutcome(branch, state) === "consequent"),
  falseIn: component.states.filter((state) => getArmOutcome(branch, state) === "alternate"),
});

export const formatStates = (states: ViewState[]): string =>
  states.map((state) => `S${state.index + 1}`).join(", ");
