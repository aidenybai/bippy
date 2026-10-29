import type { FirstRenderOutcomes } from "./first-render-outcomes";
import type { ReachabilityContext } from "../solver/reachable-constraints";
import type { StateUpdate } from "../types";
import type { BranchOutcomes } from "./unreachable-branches";

export interface EnumerationContext extends ReachabilityContext {
  branchOutcomes: BranchOutcomes;
  effectIds: Set<string>;
  renderUpdates: StateUpdate[];
  firstRender: FirstRenderOutcomes;
}
