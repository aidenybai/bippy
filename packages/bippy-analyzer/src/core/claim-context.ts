import type { Constraints } from "./constraints";
import type { ComponentAnalysis, Region, State } from "./types";
import { collectHandlerIds } from "./utils/collect-handler-ids";

export interface ClaimContext {
  analysis: ComponentAnalysis;
  states: State[];
  regions: Region[];
  constraintsByState: Constraints[];
  reachable: Constraints;
  renderedHandlerIds: Set<string>[];
}

export const createClaimContext = (
  analysis: ComponentAnalysis,
  states: State[],
  regions: Region[],
  constraintsByState: Constraints[],
  reachable: Constraints,
): ClaimContext => ({
  analysis,
  states,
  regions,
  constraintsByState,
  reachable,
  renderedHandlerIds: states.map((state, index) =>
    collectHandlerIds(state.render, constraintsByState[index] ?? reachable),
  ),
});
