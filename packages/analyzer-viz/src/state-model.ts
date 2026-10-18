import type { ViewBranch, ViewComponent, ViewState } from "./model";

export type ArmStatus = "live" | "dead" | "added" | "removed" | "unchanged";

export interface ArmMark {
  branch: ViewBranch;
  arm: "consequent" | "alternate";
  status: ArmStatus;
}

const getLiveArms = (
  branches: ViewBranch[],
  state: ViewState,
): Map<number, "consequent" | "alternate"> => {
  const arms = new Map<number, "consequent" | "alternate">();
  for (const branch of branches) {
    if (state.conditions.includes(branch.test)) arms.set(branch.id, "consequent");
    else if (state.conditions.includes(branch.negated)) arms.set(branch.id, "alternate");
  }
  return arms;
};

const getOppositeArm = (arm: "consequent" | "alternate"): "consequent" | "alternate" =>
  arm === "consequent" ? "alternate" : "consequent";

export const getArmMarks = (component: ViewComponent, state: ViewState): ArmMark[] => {
  const region = component.regions[state.regionIndex];
  const baseline =
    region?.firstRenderState !== null && region?.firstRenderState !== undefined
      ? component.states[region.firstRenderState]
      : null;
  const selectedArms = getLiveArms(component.branches, state);
  const baselineArms = baseline ? getLiveArms(component.branches, baseline) : null;
  const marks: ArmMark[] = [];
  for (const branch of component.branches) {
    const arm = selectedArms.get(branch.id);
    if (!arm) continue;
    const baselineArm = baselineArms?.get(branch.id);
    if (!baselineArms || baseline === state) {
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

export const getHandlersFromState = (component: ViewComponent, state: ViewState): Set<string> =>
  new Set(
    state.transitions
      .filter((transition) => transition.targets.some((target) => target !== state.index))
      .map((transition) => transition.handlerId),
  );
