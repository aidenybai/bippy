import { evaluateClaims } from "./claims";
import { isEffectHandler, isRenderHandler } from "./collect-handlers";
import { evaluateCondition } from "./constraints";
import type { Constraints } from "./constraints";
import { findRegions } from "./regions";
import type { RegionBranches } from "./regions";
import type {
  ComponentAnalysis,
  Handler,
  Region,
  State,
  StateReport,
  StateUpdate,
  Transition,
} from "./types";
import { collectUnreachableBranches } from "./unreachable-branches";
import type { BranchOutcomes } from "./unreachable-branches";
import { collectHandlerIds } from "./utils/collect-handler-ids";
import { forEachSymbolicValue } from "./utils/for-each-symbolic-value";
import type { ReachabilityContext } from "./reachable-constraints";
import {
  createFirstRenderConstraints,
  createInitialConstraints,
  getDependentsByBinding,
  getReachablePlacesByBinding,
} from "./reachable-constraints";
import type { Alternative, FirstRenderOutcomes } from "./state-enumerator";
import { StateEnumerator } from "./state-enumerator";
import { createTransitionContext, getTransition } from "./transitions";

export interface EnumerationContext extends ReachabilityContext {
  branchOutcomes: BranchOutcomes;
  effectIds: Set<string>;
  renderUpdates: StateUpdate[];
  firstRender: FirstRenderOutcomes;
}

interface EnumeratedRegion {
  states: State[];
  constraints: Constraints[];
  region: Region;
}

const getRenderInputIds = (
  bindingIds: ReadonlySet<number>,
  renderUpdates: StateUpdate[],
): Set<number> => {
  const inputIds = new Set(bindingIds);
  for (const bindingId of inputIds)
    for (const update of renderUpdates)
      if (update.binding.id === bindingId)
        for (const read of [update.value, ...update.guards])
          forEachSymbolicValue(read, (part) => {
            if (part.kind !== "Binding") return;
            inputIds.add(part.binding.id);
            for (const place of part.binding.inputPlaces) inputIds.add(place.bindingId);
          });
  return inputIds;
};

const getRegionHandlers = (
  analysis: ComponentAnalysis,
  region: RegionBranches,
  renderUpdates: StateUpdate[],
): Handler[] => {
  const inputIds = getRenderInputIds(region.bindingIds, renderUpdates);
  return analysis.handlers.filter(
    (handler) =>
      !isRenderHandler(handler) &&
      (region.hasUnknownTest || handler.updates.some((update) => inputIds.has(update.binding.id))),
  );
};

const isSettled = (alternative: Alternative, renderUpdates: StateUpdate[]): boolean =>
  !renderUpdates.some(
    (update) =>
      update.guards.length > 0 &&
      update.guards.every((guard) => evaluateCondition(guard, alternative.constraints) === true),
  );

const isFirstRender = (alternative: Alternative): boolean =>
  alternative.distanceFromFirstRender === 0 && !alternative.hasUndecidedBranch;

const isMountOnlyEffect = (handler: Handler): boolean =>
  handler.trigger.kind === "Effect" &&
  handler.trigger.dependencyPlaces !== null &&
  handler.trigger.dependencyPlaces.length === 0 &&
  !handler.updates.some((update) => update.isAsync);

const createRegion = (
  regionBranches: RegionBranches,
  firstStateIndex: number,
  alternatives: Alternative[],
  isTruncated: boolean,
): Region => {
  const firstRenderIndex = alternatives.findIndex(isFirstRender);
  return {
    placeNames: regionBranches.placeNames,
    bindingIds: [...regionBranches.bindingIds],
    states: alternatives.map(
      (_alternative, regionStateIndex) => firstStateIndex + regionStateIndex,
    ),
    firstRenderState: firstRenderIndex === -1 ? null : firstStateIndex + firstRenderIndex,
    isTruncated,
  };
};

const withDecidedOutcomes = (
  branchOutcomes: BranchOutcomes,
  decidedBranchOutcomes: Map<string, boolean[]>,
): BranchOutcomes =>
  new Map(
    [...branchOutcomes].map(([branchKey, outcomes]) => [
      branchKey,
      new Set([...outcomes, ...(decidedBranchOutcomes.get(branchKey) ?? [])]),
    ]),
  );

const createRegionEnumerator = (
  regionBranches: RegionBranches,
  context: EnumerationContext,
): StateEnumerator =>
  new StateEnumerator(context.branchOutcomes, regionBranches, context.firstRender, true);

const enumerateRegion = (
  regionBranches: RegionBranches,
  regionIndex: number,
  firstStateIndex: number,
  context: EnumerationContext,
): EnumeratedRegion => {
  const { analysis, effectIds } = context;
  const enumerator = createRegionEnumerator(regionBranches, context);
  const alternatives = enumerator
    .enumerate(analysis.render, context.reachableConstraints)
    .filter((alternative) => isSettled(alternative, context.renderUpdates));
  const transitionContext = createTransitionContext(
    regionBranches,
    alternatives,
    firstStateIndex,
    context,
  );
  const regionHandlers = getRegionHandlers(analysis, regionBranches, context.renderUpdates);
  const getTransitions = (alternative: Alternative): Transition[] => {
    const runnableEffectIds = analysis.handlers
      .filter(
        (handler) =>
          effectIds.has(handler.id) && (!isMountOnlyEffect(handler) || isFirstRender(alternative)),
      )
      .map((handler) => handler.id);
    const renderedHandlerIds = new Set([
      ...runnableEffectIds,
      ...collectHandlerIds(alternative.render, alternative.constraints),
    ]);
    return regionHandlers
      .filter((handler) => renderedHandlerIds.has(handler.id))
      .map((handler) =>
        getTransition(
          handler,
          isMountOnlyEffect(handler)
            ? { ...alternative, constraints: context.firstRender.constraints }
            : alternative,
          transitionContext,
        ),
      );
  };
  const states = alternatives.map((alternative) => ({
    regionIndex,
    conditions: alternative.conditions,
    render: alternative.render,
    fragments: alternative.fragments,
    transitions: getTransitions(alternative),
  }));
  const constraints = alternatives.map((alternative) => alternative.constraints);
  const isTruncated = enumerator.isTruncated || transitionContext.budget.isExhausted;
  return {
    states,
    constraints,
    region: createRegion(regionBranches, firstStateIndex, alternatives, isTruncated),
  };
};

export const enumerateStates = (analysis: ComponentAnalysis): StateReport => {
  const reachableConstraints = createInitialConstraints(analysis);
  const context: EnumerationContext = {
    analysis,
    reachableConstraints,
    reachablePlacesByBinding: getReachablePlacesByBinding(reachableConstraints),
    dependentsByBinding: getDependentsByBinding(analysis.bindings),
    branchOutcomes: new Map(),
    effectIds: new Set(analysis.handlers.filter(isEffectHandler).map((handler) => handler.id)),
    renderUpdates: analysis.handlers.filter(isRenderHandler).flatMap((handler) => handler.updates),
    firstRender: {
      constraints: createFirstRenderConstraints(analysis, reachableConstraints),
      outcomesByBranchKey: new Map(),
    },
  };
  const states: State[] = [];
  const regions: Region[] = [];
  const constraintsByState: Constraints[] = [];
  let isTruncated = false;
  findRegions(analysis.render, analysis.bindings).forEach((regionBranches, regionIndex) => {
    const enumerated = enumerateRegion(regionBranches, regionIndex, states.length, context);
    states.push(...enumerated.states);
    constraintsByState.push(...enumerated.constraints);
    regions.push(enumerated.region);
    isTruncated ||= enumerated.region.isTruncated;
  });
  return {
    places: reachableConstraints.possibleValues.clone(),
    states,
    regions,
    unreachableBranches: isTruncated
      ? []
      : collectUnreachableBranches(
          analysis.render,
          withDecidedOutcomes(context.branchOutcomes, analysis.decidedBranchOutcomes),
        ),
    claimOutcomes: evaluateClaims(
      analysis,
      states,
      regions,
      constraintsByState,
      reachableConstraints,
    ),
    isTruncated,
  };
};
