import { evaluateClaims } from "./claims";
import { isEffectHandler, isRenderHandler } from "./collect-handlers";
import { cloneConstraints, evaluateCondition, joinConstraints } from "./constraints";
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
import { forEachJsxElement } from "./utils/for-each-jsx-element";
import type { ReachabilityContext } from "./reachable-constraints";
import {
  createFirstRenderConstraints,
  createInitialConstraints,
  getDependentsByBinding,
  getReachablePlacesByBinding,
} from "./reachable-constraints";
import type { Alternative, FirstRenderOutcomes } from "./state-enumerator";
import { StateEnumerator } from "./state-enumerator";
import { createTransitionContext, getTransition, settleRenderUpdates } from "./transitions";

export interface EnumerationContext extends ReachabilityContext {
  branchOutcomes: BranchOutcomes;
  effectIds: Set<string>;
  renderUpdates: StateUpdate[];
  firstRender: FirstRenderOutcomes;
}

interface EnumeratedRegion {
  states: State[];
  constraints: Constraints[];
  renderedHandlerIds: Set<string>[];
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
      !update.isMemoized &&
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

const getCommittedRefIds = (analysis: ComponentAnalysis): Set<number> | null => {
  const refIds = new Set<number>();
  let hasCallbackRef = false;
  forEachJsxElement(analysis.render, (element) => {
    for (const prop of element.props) {
      if (prop.kind === "JsxAttribute" && prop.name === "ref" && prop.value.kind === "Function")
        hasCallbackRef = true;
      forEachSymbolicValue(prop.value, (part) => {
        if (part.kind === "Binding" && part.binding.kind === "ref") refIds.add(part.binding.id);
      });
    }
  });
  for (const handler of analysis.handlers)
    for (const update of handler.updates)
      if (update.binding.kind === "ref") refIds.add(update.binding.id);
  return hasCallbackRef ? null : refIds;
};

const getMountEffectConstraints = (
  analysis: ComponentAnalysis,
  firstRenderConstraints: Constraints,
): Constraints => {
  const refIds = getCommittedRefIds(analysis);
  const committedPlaces = firstRenderConstraints.possibleValues.places().filter((place) => {
    const binding = analysis.bindings[place.bindingId];
    return binding?.kind === "ref" && (refIds === null || refIds.has(place.bindingId));
  });
  if (committedPlaces.length === 0) return firstRenderConstraints;
  const constraints = cloneConstraints(firstRenderConstraints);
  for (const place of committedPlaces) constraints.possibleValues.delete(place);
  return constraints;
};

const isPossibleFirstRender = (
  alternative: Alternative,
  firstRender: FirstRenderOutcomes,
): boolean =>
  [...alternative.branches].every((branch) => {
    const separator = branch.lastIndexOf(":");
    const outcome = firstRender.outcomesByBranchKey.get(branch.slice(0, separator));
    return (
      outcome === undefined || outcome === null || String(outcome) === branch.slice(separator + 1)
    );
  });

const createRegion = (
  regionBranches: RegionBranches,
  firstStateIndex: number,
  alternatives: Alternative[],
  isTruncated: boolean,
  firstRender: FirstRenderOutcomes,
): Region => {
  const firstRenderIndex = alternatives.findIndex(isFirstRender);
  const firstRenderIndices =
    firstRenderIndex === -1
      ? alternatives.flatMap((alternative, index) =>
          isPossibleFirstRender(alternative, firstRender) ? [index] : [],
        )
      : [firstRenderIndex];
  return {
    placeNames: regionBranches.placeNames,
    bindingIds: [...regionBranches.bindingIds],
    states: alternatives.map(
      (_alternative, regionStateIndex) => firstStateIndex + regionStateIndex,
    ),
    firstRenderState: firstRenderIndex === -1 ? null : firstStateIndex + firstRenderIndex,
    possibleFirstRenderStates: firstRenderIndices.map((index) => firstStateIndex + index),
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
  const renderedHandlerIds = alternatives.map((alternative) =>
    collectHandlerIds(alternative.render, alternative.constraints),
  );
  const mountEffectConstraints = getMountEffectConstraints(
    analysis,
    context.firstRender.constraints,
  );
  const getTransitions = (alternative: Alternative, index: number): Transition[] => {
    const runnableEffectIds = analysis.handlers
      .filter(
        (handler) =>
          effectIds.has(handler.id) && (!isMountOnlyEffect(handler) || isFirstRender(alternative)),
      )
      .map((handler) => handler.id);
    const runnableHandlerIds = new Set([
      ...runnableEffectIds,
      ...(renderedHandlerIds[index] ?? []),
    ]);
    return regionHandlers
      .filter((handler) => runnableHandlerIds.has(handler.id))
      .map((handler) =>
        getTransition(
          handler,
          isMountOnlyEffect(handler)
            ? { ...alternative, constraints: mountEffectConstraints }
            : alternative,
          transitionContext,
        ),
      );
  };
  const states = alternatives.map((alternative, index) => ({
    regionIndex,
    conditions: alternative.conditions,
    render: alternative.render,
    fragments: alternative.fragments,
    transitions: getTransitions(alternative, index),
  }));
  const constraints = alternatives.map((alternative) => alternative.constraints);
  const { isTruncated } = enumerator;
  return {
    states,
    constraints,
    renderedHandlerIds,
    region: createRegion(
      regionBranches,
      firstStateIndex,
      alternatives,
      isTruncated,
      context.firstRender,
    ),
  };
};

export const enumerateStates = (analysis: ComponentAnalysis): StateReport => {
  const reachableConstraints = createInitialConstraints(analysis);
  const reachability: ReachabilityContext = {
    analysis,
    reachableConstraints,
    reachablePlacesByBinding: getReachablePlacesByBinding(reachableConstraints),
    dependentsByBinding: getDependentsByBinding(analysis.bindings),
  };
  const renderUpdates = analysis.handlers
    .filter(isRenderHandler)
    .flatMap((handler) => handler.updates);
  const [firstSettled, ...otherSettled] = settleRenderUpdates(
    createFirstRenderConstraints(analysis, reachableConstraints),
    renderUpdates,
    reachability,
  );
  const context: EnumerationContext = {
    ...reachability,
    branchOutcomes: new Map(),
    effectIds: new Set(analysis.handlers.filter(isEffectHandler).map((handler) => handler.id)),
    renderUpdates,
    firstRender: {
      constraints: otherSettled.reduce(
        joinConstraints,
        firstSettled ?? createFirstRenderConstraints(analysis, reachableConstraints),
      ),
      outcomesByBranchKey: new Map(),
    },
  };
  const states: State[] = [];
  const regions: Region[] = [];
  const constraintsByState: Constraints[] = [];
  const renderedHandlerIds: Set<string>[] = [];
  let isTruncated = false;
  findRegions(analysis.render, analysis.bindings).forEach((regionBranches, regionIndex) => {
    const enumerated = enumerateRegion(regionBranches, regionIndex, states.length, context);
    states.push(...enumerated.states);
    constraintsByState.push(...enumerated.constraints);
    renderedHandlerIds.push(...enumerated.renderedHandlerIds);
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
      renderedHandlerIds,
    ),
    isTruncated,
  };
};
