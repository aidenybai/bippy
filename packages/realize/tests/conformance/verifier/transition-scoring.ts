import type { Handler, Transition } from "../../../src/core/types";
import type { Observation } from "./driver";
import type { Action, Capture } from "./types";
import { getPathKey } from "./branch-probes";
import {
  getMatchedStates,
  getRegionsMatchedOnBothSides,
  getStatesInRegion,
  isExternalRegion,
  isRegionUnchanged,
} from "./region-matching";
import type { ScoringContext } from "./score";
import type { TransitionCounterexample } from "./verdicts";

const DEPENDENCY_NAME_PATTERN = /(?<![.\w$])[A-Za-z_$][\w$]*/g;

const SPONTANEOUS_EVENTS = new Set([
  "onLoad",
  "onError",
  "onLoadStart",
  "onLoadedData",
  "onLoadedMetadata",
  "onCanPlay",
  "onCanPlayThrough",
  "onPlay",
  "onPlaying",
  "onPause",
  "onEnded",
  "onTimeUpdate",
  "onDurationChange",
  "onProgress",
  "onAnimationStart",
  "onAnimationIteration",
  "onAnimationEnd",
  "onTransitionStart",
  "onTransitionEnd",
]);

export const isSpontaneousHandler = ({ trigger }: Handler): boolean =>
  trigger.kind === "Event"
    ? SPONTANEOUS_EVENTS.has(trigger.event)
    : trigger.kind === "Effect" && trigger.hookKind === "Custom";

export const getTransitions = (
  context: ScoringContext,
  fromStates: number[],
  handlerIds: Set<string>,
): Transition[] =>
  fromStates.flatMap(
    (stateIndex) =>
      context.report.states[stateIndex]?.transitions.filter((transition) =>
        handlerIds.has(transition.handlerId),
      ) ?? [],
  );

export const getTargetStates = (
  context: ScoringContext,
  fromStates: number[],
  handlerIds: Set<string>,
): number[] => [
  ...new Set(
    getTransitions(context, fromStates, handlerIds).flatMap((transition) => transition.targets),
  ),
];

interface EdgeHandlerIds extends Pick<ObservedEdge, "triggeredIds" | "maybeTriggeredIds"> {}

interface ObservedEdge {
  action: Action;
  path: string[];
  beforeMatches: number[];
  afterMatches: number[];
  triggeredIds: Set<string>;
  maybeTriggeredIds: Set<string>;
  earlierTriggeredIds: Set<string>;
}

const getEdgeTargets = (
  context: ScoringContext,
  fromStates: number[],
  edge: EdgeHandlerIds,
): Set<number> => {
  const reached = new Set(getTargetStates(context, fromStates, edge.triggeredIds));
  for (let frontier = [...reached]; frontier.length > 0;) {
    frontier = getTargetStates(context, frontier, edge.maybeTriggeredIds).filter(
      (stateIndex) => !reached.has(stateIndex),
    );
    for (const stateIndex of frontier) reached.add(stateIndex);
  }
  return reached;
};

const getDependencyNames = (dependencies: string): Set<string> =>
  new Set(dependencies.match(DEPENDENCY_NAME_PATTERN) ?? []);

const isRerunBy = (effect: Handler, updatedNames: Set<string>): boolean =>
  effect.trigger.kind === "Effect" &&
  (effect.trigger.dependencies === null ||
    [...getDependencyNames(effect.trigger.dependencies)].some((name) => updatedNames.has(name)));

const addFollowingEffects = (context: ScoringContext, edgeIds: EdgeHandlerIds): void => {
  const updatedNames = new Set<string>();
  for (let isGrowing = true; isGrowing;) {
    isGrowing = false;
    for (const handler of context.analysis.handlers) {
      if (!edgeIds.triggeredIds.has(handler.id)) continue;
      for (const update of handler.updates) updatedNames.add(update.binding.name);
    }
    for (const handler of context.analysis.handlers) {
      if (edgeIds.triggeredIds.has(handler.id) || !isRerunBy(handler, updatedNames)) continue;
      edgeIds.triggeredIds.add(handler.id);
      edgeIds.maybeTriggeredIds.add(handler.id);
      isGrowing = true;
    }
  }
};

const getTriggeredHandlerIds = (context: ScoringContext, after: Capture): EdgeHandlerIds => {
  const handlerIdsByHit = after.handlerHits.map(
    (probeId) => context.handlerIdsByProbeId.get(probeId) ?? [],
  );
  const edgeIds: EdgeHandlerIds = {
    triggeredIds: new Set(handlerIdsByHit.flat()),
    maybeTriggeredIds: new Set(
      handlerIdsByHit.filter((handlerIds) => handlerIds.length > 1).flat(),
    ),
  };
  if (edgeIds.triggeredIds.size > 0) addFollowingEffects(context, edgeIds);
  return edgeIds;
};

const canChildActionChange = (
  context: ScoringContext,
  edge: ObservedEdge,
  regionIndex: number,
): boolean => edge.action.isInChild && isExternalRegion(context, regionIndex);

const getEarlierTriggeredIds = (context: ScoringContext, path: string[]): Set<string> =>
  new Set(
    path.slice(0, -1).flatMap((_actionKey, actionIndex) => {
      const earlierCapture = context.capturesByPathKey.get(
        getPathKey(path.slice(0, actionIndex + 1)),
      );
      return earlierCapture
        ? [...getTriggeredHandlerIds(context, earlierCapture).triggeredIds]
        : [];
    }),
  );

const canReachInBackground = (
  context: ScoringContext,
  fromStates: number[],
  handlerIds: Set<string>,
  afterMatches: number[],
): boolean =>
  getTransitions(context, fromStates, handlerIds).some(
    (transition) =>
      (transition.isAsync || context.spontaneousIds.has(transition.handlerId)) &&
      transition.targets.some((target) => afterMatches.includes(target)),
  );

const canBackgroundChange = (
  context: ScoringContext,
  edge: ObservedEdge,
  regionIndex: number,
): boolean =>
  canReachInBackground(
    context,
    getStatesInRegion(context, edge.beforeMatches, regionIndex),
    new Set([...context.backgroundHandlerIds, ...edge.earlierTriggeredIds]),
    edge.afterMatches,
  );

const isRegionEdgePredicted = (
  context: ScoringContext,
  edge: ObservedEdge,
  regionIndex: number,
): boolean => {
  if (canChildActionChange(context, edge, regionIndex)) return true;
  if (canBackgroundChange(context, edge, regionIndex)) return true;
  const isUnchanged = isRegionUnchanged(
    context,
    edge.beforeMatches,
    edge.afterMatches,
    regionIndex,
  );
  const fromStates = getStatesInRegion(context, edge.beforeMatches, regionIndex);
  const transitions = getTransitions(context, fromStates, edge.triggeredIds);
  if (transitions.length === 0) return isUnchanged;
  const targets = getEdgeTargets(context, fromStates, edge);
  if (edge.afterMatches.some((stateIndex) => targets.has(stateIndex))) return true;
  return transitions.some(
    (transition) =>
      canReachInBackground(
        context,
        transition.targets,
        context.backgroundHandlerIds,
        edge.afterMatches,
      ) ||
      (isUnchanged && (transition.isAsync || edge.maybeTriggeredIds.has(transition.handlerId))),
  );
};

const recordWrongEdge = (
  context: ScoringContext,
  edge: ObservedEdge,
  reason: TransitionCounterexample["reason"],
): void => {
  context.verdict.transitionCounterexamples.push({
    path: edge.path,
    action: edge.action.key,
    fromStates: edge.beforeMatches,
    toStates: edge.afterMatches,
    predictedStates: [...getEdgeTargets(context, edge.beforeMatches, edge)],
    reason,
  });
};

export const scoreTransition = (
  context: ScoringContext,
  observation: Observation,
  afterMatches: number[],
): void => {
  const { action, before } = observation;
  if (!action || !before || before.error) return;
  const beforeMatches = getMatchedStates(context, before.shapes);
  const regions = getRegionsMatchedOnBothSides(context, beforeMatches, afterMatches);
  if (regions.length === 0) return;
  const edge: ObservedEdge = {
    action,
    path: observation.path,
    beforeMatches,
    afterMatches,
    ...getTriggeredHandlerIds(context, observation.after),
    earlierTriggeredIds: getEarlierTriggeredIds(context, observation.path),
  };
  if (edge.triggeredIds.size === 0) {
    const isExplained = regions.every(
      (regionIndex) =>
        isRegionUnchanged(context, beforeMatches, afterMatches, regionIndex) ||
        canChildActionChange(context, edge, regionIndex) ||
        canBackgroundChange(context, edge, regionIndex),
    );
    if (!isExplained) recordWrongEdge(context, edge, "unmodeled-handler");
    return;
  }
  if (regions.every((regionIndex) => isRegionEdgePredicted(context, edge, regionIndex)))
    context.verdict.coveredTransitionCount++;
  else if (!context.report.isTruncated) recordWrongEdge(context, edge, "unpredicted-target");
};
