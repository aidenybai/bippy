import { isEffectHandler } from "../../../src/core/collect-handlers";
import { formatAbstractValue, formatLine, formatPlace } from "../../../src/core/format";
import type { Binding, ComponentAnalysis, Sample, StateReport } from "../../../src/core/types";
import { GeneratedSource } from "../../../src/react-compiler/HIR/HIR";
import type { Observation } from "./driver";
import { explainMismatch, findClosest, formatShapes, normalizeShapes, toExpected } from "./match";
import type { ExpectedShape } from "./match";
import { scoreWarnings } from "./mutation";
import { TRUNCATED_VALUE } from "./types";
import type { Capture, Shape } from "./types";
import {
  collectProbes,
  getHandlerIdsByProbeId,
  getPathKey,
  getProbeId,
  getSideKey,
} from "./branch-probes";
import {
  EXTERNAL_DATA_BINDING_KINDS,
  MISSING_PLACE,
  formatRuntimeValue,
  getMatchedStates,
  getRegionsMatchedOnBothSides,
  getStateBindings,
  getStatesInRegion,
  isEveryRegionMatched,
  isPredictedValue,
  isRegionUnchanged,
  readPath,
} from "./region-matching";
import {
  getTargetStates,
  getTransitions,
  isSpontaneousHandler,
  scoreTransition,
} from "./transition-scoring";
import { MAX_RENDERED_LENGTH } from "./verdict-report";
import type { ComponentVerdict } from "./verdicts";
import { createEmptyVerdict, getMountFailedVerdict } from "./verdicts";

const FIRST_COMMIT = "first commit";

export interface ScoringContext {
  analysis: ComponentAnalysis;
  report: StateReport;
  verdict: ComponentVerdict;
  expectedStates: ExpectedShape[][];
  handlerIdsByProbeId: Map<string, string[]>;
  stateBindings: Binding[] | null;
  externalBindingIds: Set<number>;
  effectIds: Set<string>;
  backgroundHandlerIds: Set<string>;
  spontaneousIds: Set<string>;
  capturesByPathKey: Map<string, Capture>;
  beforeCapturesByPathKey: Map<string, Capture>;
  coveredStates: Set<number>;
  matchedStatesCache: Map<string, number[]>;
}

const scoreRender = (
  context: ScoringContext,
  props: Record<string, Sample>,
  path: string[],
  shapes: Shape[],
): number[] => {
  const matchedStates = getMatchedStates(context, shapes);
  for (const stateIndex of matchedStates) context.coveredStates.add(stateIndex);
  if (isEveryRegionMatched(context, matchedStates) || context.report.isTruncated)
    return matchedStates;
  const normalized = normalizeShapes(shapes);
  const closestState = findClosest(context.expectedStates, normalized);
  context.verdict.stateCounterexamples.push({
    props,
    path,
    rendered: formatShapes(normalized).slice(0, MAX_RENDERED_LENGTH),
    closestState,
    reason: explainMismatch(context.expectedStates[closestState] ?? [], normalized),
  });
  return matchedStates;
};

const scoreFirstCommit = (
  context: ScoringContext,
  observation: Observation,
  settledMatches: number[],
): void => {
  const { firstCommitShapes } = observation.after;
  if (observation.action || !firstCommitShapes) return;
  const firstMatches = scoreRender(context, observation.props, [FIRST_COMMIT], firstCommitShapes);
  if (context.externalBindingIds.size > 0) return;
  const isUnexplained = getRegionsMatchedOnBothSides(context, firstMatches, settledMatches).some(
    (regionIndex) =>
      !isRegionUnchanged(context, firstMatches, settledMatches, regionIndex) &&
      !getTransitions(
        context,
        getStatesInRegion(context, firstMatches, regionIndex),
        context.backgroundHandlerIds,
      ).some((transition) => transition.targets.some((target) => settledMatches.includes(target))),
  );
  if (isUnexplained)
    context.verdict.transitionCounterexamples.push({
      path: [],
      action: FIRST_COMMIT,
      fromStates: firstMatches,
      toStates: settledMatches,
      predictedStates: getTargetStates(context, firstMatches, context.backgroundHandlerIds),
      reason: "unpredicted-effect",
    });
};

const scoreValues = (context: ScoringContext, observation: Observation): void => {
  context.stateBindings?.forEach((binding, hookIndex) => {
    for (const [{ bindingId, path: placePath }, predicted] of context.report.places) {
      if (bindingId !== binding.id || !predicted.every((value) => value.kind === "Literal"))
        continue;
      const value = readPath(observation.after.hookStates[hookIndex], placePath);
      if (
        value === TRUNCATED_VALUE ||
        value === MISSING_PLACE ||
        isPredictedValue(value, predicted)
      )
        continue;
      context.verdict.valueCounterexamples.push({
        path: observation.path,
        place: formatPlace(binding, placePath),
        value: formatRuntimeValue(value),
        predicted: predicted.map(formatAbstractValue),
      });
    }
  });
};

const createScoringContext = (
  analysis: ComponentAnalysis,
  report: StateReport,
  verdict: ComponentVerdict,
  observations: Observation[],
  knownComponents: Map<string, string>,
): ScoringContext => ({
  analysis,
  report,
  verdict,
  expectedStates: report.states.map((state) => toExpected(state.render, knownComponents)),
  handlerIdsByProbeId: getHandlerIdsByProbeId(analysis),
  stateBindings: getStateBindings(analysis, observations),
  externalBindingIds: new Set(
    analysis.bindings
      .filter((binding) => EXTERNAL_DATA_BINDING_KINDS.has(binding.kind))
      .map((binding) => binding.id),
  ),
  effectIds: new Set(analysis.handlers.filter(isEffectHandler).map((handler) => handler.id)),
  backgroundHandlerIds: new Set(
    analysis.handlers
      .filter((handler) => isEffectHandler(handler) || isSpontaneousHandler(handler))
      .map((handler) => handler.id),
  ),
  spontaneousIds: new Set(
    analysis.handlers.filter(isSpontaneousHandler).map((handler) => handler.id),
  ),
  capturesByPathKey: new Map(
    observations.flatMap((observation) =>
      observation.action ? [[getPathKey(observation.path), observation.after]] : [],
    ),
  ),
  beforeCapturesByPathKey: new Map(
    observations.flatMap((observation) =>
      observation.action && observation.before
        ? [[getPathKey(observation.path), observation.before]]
        : [],
    ),
  ),
  coveredStates: new Set(),
  matchedStatesCache: new Map(),
});

const getReachedUnreachableBranches = (report: StateReport, coveredSides: Set<string>): string[] =>
  report.unreachableBranches
    .filter(
      (unreachableBranch) =>
        unreachableBranch.branch.loc !== GeneratedSource &&
        coveredSides.has(
          getSideKey(
            getProbeId(unreachableBranch.branch.file, unreachableBranch.branch.loc),
            unreachableBranch.isTrueSide,
          ),
        ),
    )
    .map((unreachableBranch) =>
      `${unreachableBranch.description} ${formatLine(unreachableBranch.branch.loc)}`.trim(),
    );

const scoreObservation = (
  context: ScoringContext,
  observation: Observation,
  probeIds: Set<string>,
  coveredSides: Set<string>,
): void => {
  for (const probeHit of observation.after.probes)
    if (probeIds.has(probeHit.id)) coveredSides.add(getSideKey(probeHit.id, probeHit.isTrueSide));
  if (observation.after.error) {
    context.verdict.renderErrorCount++;
    return;
  }
  const afterMatches = scoreRender(
    context,
    observation.props,
    observation.path,
    observation.after.shapes,
  );
  scoreFirstCommit(context, observation, afterMatches);
  scoreValues(context, observation);
  scoreTransition(context, observation, afterMatches);
};

export const scoreComponent = (
  analysis: ComponentAnalysis,
  report: StateReport,
  observations: Observation[],
  knownComponents: Map<string, string>,
): ComponentVerdict => {
  const verdict: ComponentVerdict = {
    ...createEmptyVerdict(analysis, report),
    observationCount: observations.length,
  };
  if (!analysis.exportName) return verdict;
  const mountFailedVerdict = getMountFailedVerdict(verdict, observations);
  if (mountFailedVerdict) return mountFailedVerdict;
  const context = createScoringContext(analysis, report, verdict, observations, knownComponents);
  const probes = collectProbes(analysis);
  const probeIds = new Set(probes.map((probe) => probe.id));
  const coveredSides = new Set<string>();
  for (const observation of observations)
    scoreObservation(context, observation, probeIds, coveredSides);
  verdict.coveredStateIndices = [...context.coveredStates].sort((left, right) => left - right);
  verdict.branchSideCount = probes.length * 2;
  verdict.coveredBranchSideCount = coveredSides.size;
  verdict.reachedUnreachableBranches = getReachedUnreachableBranches(report, coveredSides);
  return { ...verdict, ...scoreWarnings(analysis, observations, context.stateBindings) };
};
