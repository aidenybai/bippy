import { ANY_EVENT, isEffectHandler } from "../../../src/core/collect-handlers";
import type {
  AbstractValue,
  BindingKind,
  Binding,
  ComponentAnalysis,
  Handler,
  Sample,
  StateReport,
  SymbolicValue,
  Transition,
} from "../../../src/core/types";
import { forEachJsxElement } from "../../../src/core/utils/for-each-jsx-element";
import { forEachRenderNode } from "../../../src/core/utils/for-each-render-node";
import {
  formatAbstractValue,
  formatLine,
  formatPlace,
  formatStateLabel,
} from "../../../src/core/format";
import { isStateBinding } from "../../../src/core/utils/is-state-binding";
import { getLocationKey } from "../../../src/core/utils/get-location-key";
import type { types } from "@babel/core";
import { GeneratedSource } from "../../../src/react-compiler/HIR/HIR";
import type { Observation } from "./driver";
import { MAX_ACTION_LABEL_LENGTH, TRUNCATED_VALUE } from "./types";
import { appendToGroup } from "../../../src/core/utils/append-to-group";
import type { Action, ActionTarget, Probe, Shape } from "./types";
import {
  explainMismatch,
  findClosest,
  formatShapes,
  matchesExpected,
  normalizeShapes,
  normalizeText,
  toExpected,
} from "./match";
import type { ExpectedShape } from "./match";
import { scoreWarnings } from "./mutation";
import { getCaptureFailure } from "./reasons";
import type { MountFailure } from "./reasons";

type ComponentStatus = "verified" | "not-exported" | "mount-failed";

interface StateCounterexample {
  props: Record<string, Sample>;
  path: string[];
  rendered: string;
  closestState: number;
  reason: string;
}

interface TransitionCounterexample {
  path: string[];
  action: string;
  fromStates: number[];
  toStates: number[];
  predictedStates: number[];
  reason: "unpredicted-target" | "unmodeled-handler" | "unpredicted-effect";
}

interface ValueCounterexample {
  path: string[];
  place: string;
  value: string;
  predicted: string[];
}

export interface ComponentVerdict {
  name: string;
  file: string;
  status: ComponentStatus;
  error: string | null;
  mountFailure: MountFailure | null;
  observationCount: number;
  renderErrorCount: number;
  predictedStateCount: number;
  coveredStateIndices: number[];
  stateCounterexamples: StateCounterexample[];
  coveredTransitionCount: number;
  transitionCounterexamples: TransitionCounterexample[];
  branchSideCount: number;
  coveredBranchSideCount: number;
  unreachableClaimCount: number;
  reachedUnreachableBranches: string[];
  valueCounterexamples: ValueCounterexample[];
  warningCount: number;
  coveredWarningCount: number;
  refutedWarnings: string[];
  unwarnedMutations: string[];
}

export interface VerificationSummary {
  verifiedCount: number;
  unmountableCount: number;
  notExportedCount: number;
  counterexampleCount: number;
  predictedStateCount: number;
  coveredStateCount: number;
  branchSideCount: number;
  coveredBranchSideCount: number;
  warningCount: number;
  coveredWarningCount: number;
  unwarnedMutationCount: number;
  mountFailureCounts: Partial<Record<MountFailure, number>>;
  durationMs: number;
}

type TriggerCertainty = "sure" | "maybe";

export interface HandlerTarget {
  tag: string;
  text: string | null;
  event: string;
}

const FIRST_COMMIT = "first commit";
const MISSING_PLACE = Symbol("missing place");
const NON_HOOK_BINDING_KINDS = new Set<BindingKind>(["prop", "item", "call", "loop", "suspense"]);
const EXTERNAL_DATA_BINDING_KINDS = new Set<BindingKind>(["hook", "context", "call", "suspense"]);
const MAX_RENDERED_LENGTH = 300;
const MAX_PROPS_LENGTH = 160;
const DISPATCHED_EVENTS = new Set(["onClick", "onChange", "onInput", "onSubmit"]);
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
const ORDERED_HOOK_KINDS = new Set<string>([
  "useState",
  "useReducer",
  "useRef",
  "useMemo",
  "useCallback",
  "useContext",
]);

const isSpontaneousHandler = ({ trigger }: Handler): boolean =>
  trigger.kind === "Event" ? SPONTANEOUS_EVENTS.has(trigger.event) : trigger.hookKind === "Custom";

const isComponentTag = (tag: string): boolean => /^[A-Z]/.test(tag) || tag.includes(".");

const isSameLabel = (text: string, label: string): boolean => {
  const compactText = text.replace(/\s+/g, "");
  const compactLabel = label.replace(/\s+/g, "");
  return label.length < MAX_ACTION_LABEL_LENGTH
    ? compactText === compactLabel
    : compactText.startsWith(compactLabel);
};

const isSameTarget = (handlerTarget: HandlerTarget, actionTarget: ActionTarget): boolean =>
  handlerTarget.tag === actionTarget.tag &&
  (handlerTarget.text === null || isSameLabel(handlerTarget.text, actionTarget.label));

export const getTriggerCertainty = (
  handlerTarget: HandlerTarget,
  action: Action,
): TriggerCertainty | null => {
  if (isComponentTag(handlerTarget.tag))
    return handlerTarget.text === null || handlerTarget.text.includes(action.label)
      ? "maybe"
      : null;
  if (!DISPATCHED_EVENTS.has(handlerTarget.event) && handlerTarget.event !== ANY_EVENT)
    return "maybe";
  const eventName = action.kind === "click" ? "onClick" : "onChange";
  if (handlerTarget.event !== eventName && handlerTarget.event !== ANY_EVENT) return null;
  if (isSameTarget(handlerTarget, action))
    return handlerTarget.text === null || action.label.length >= MAX_ACTION_LABEL_LENGTH
      ? "maybe"
      : "sure";
  return action.kind === "click" &&
    action.clickAncestors.some((ancestor) => isSameTarget(handlerTarget, ancestor))
    ? "maybe"
    : null;
};

export const getHandlerCertainty = (
  handlerTargets: HandlerTarget[],
  action: Action,
): TriggerCertainty | null => {
  const certainties = handlerTargets.map((handlerTarget) =>
    getTriggerCertainty(handlerTarget, action),
  );
  if (certainties.includes("sure")) return "sure";
  return certainties.includes("maybe") ? "maybe" : null;
};

const getProbeId = (file: string, loc: types.SourceLocation): string =>
  `${file}:${getLocationKey(loc)}`;

const getSideKey = (probeId: string, isTrueSide: boolean): string => `${probeId}:${isTrueSide}`;

export const collectProbes = (analysis: ComponentAnalysis): Probe[] => {
  const probes = new Map<string, Probe>();
  forEachRenderNode(analysis.render, (value) => {
    if (value.kind !== "Conditional") return;
    const { branch } = value;
    if (branch.probe === "none" || branch.loc === GeneratedSource) return;
    const id = getProbeId(branch.file, branch.loc);
    probes.set(id, {
      id,
      file: branch.file,
      start: branch.loc.start.index,
      end: branch.loc.end.index,
      mode: branch.probe,
    });
  });
  return [...probes.values()];
};

const getStaticText = (value: SymbolicValue): string | null => {
  switch (value.kind) {
    case "JSXText":
      return value.value;
    case "JsxExpression":
    case "JsxFragment": {
      const parts = value.children.map(getStaticText);
      return parts.every((part) => part !== null) ? normalizeText(parts.join(" ")) : null;
    }
    case "Primitive":
      if (typeof value.value === "string") return normalizeText(value.value);
      return typeof value.value === "number" ? null : "";
    default:
      return null;
  }
};

const collectHandlerTargets = (render: SymbolicValue): Map<string, HandlerTarget[]> => {
  const handlerTargets = new Map<string, HandlerTarget[]>();
  forEachJsxElement(render, (value) => {
    for (const prop of value.props) {
      if (!prop.handlerId) continue;
      appendToGroup(handlerTargets, prop.handlerId, {
        tag: value.tag.name,
        text: getStaticText(value) || null,
        event: prop.kind === "JsxAttribute" ? prop.name : ANY_EVENT,
      });
    }
  });
  return handlerTargets;
};

const getStateBindings = (
  analysis: ComponentAnalysis,
  observations: Observation[],
): Binding[] | null => {
  const hookBindings = analysis.bindings.filter(
    (binding) => !NON_HOOK_BINDING_KINDS.has(binding.kind),
  );
  if (
    hookBindings.some((binding) => !binding.hookKind || !ORDERED_HOOK_KINDS.has(binding.hookKind))
  )
    return null;
  const stateBindings = analysis.bindings.filter(isStateBinding);
  const isEveryQueueAState = observations.every(
    ({ after }) => after.error !== null || after.hookStates.length === stateBindings.length,
  );
  return isEveryQueueAState ? stateBindings : null;
};

const isPredictedValue = (value: unknown, predicted: AbstractValue[]): boolean =>
  predicted.some((candidate) => candidate.kind === "Literal" && Object.is(candidate.value, value));

const readPath = (value: unknown, path: string[]): unknown => {
  let current = value;
  for (const segment of path) {
    if (current === TRUNCATED_VALUE) return current;
    if (!current || typeof current !== "object") return MISSING_PLACE;
    current = Reflect.get(current, segment);
  }
  return current;
};

const formatRuntimeValue = (value: unknown): string =>
  value === undefined ? "undefined" : JSON.stringify(value);

interface ScoringContext {
  analysis: ComponentAnalysis;
  report: StateReport;
  verdict: ComponentVerdict;
  expectedStates: ExpectedShape[][];
  handlerTargets: Map<string, HandlerTarget[]>;
  stateBindings: Binding[] | null;
  externalBindingIds: Set<number>;
  effectIds: Set<string>;
  backgroundHandlerIds: Set<string>;
  spontaneousIds: Set<string>;
  actionsByKey: Map<string, Action>;
  coveredStates: Set<number>;
  matchedStatesCache: Map<string, number[]>;
}

export const createEmptyVerdict = (
  analysis: ComponentAnalysis,
  report: StateReport,
): ComponentVerdict => ({
  name: analysis.name,
  file: analysis.file,
  status: analysis.exportName ? "verified" : "not-exported",
  error: null,
  mountFailure: null,
  observationCount: 0,
  renderErrorCount: 0,
  predictedStateCount: report.states.length,
  coveredStateIndices: [],
  stateCounterexamples: [],
  coveredTransitionCount: 0,
  transitionCounterexamples: [],
  branchSideCount: 0,
  coveredBranchSideCount: 0,
  unreachableClaimCount: report.unreachableBranches.length,
  reachedUnreachableBranches: [],
  valueCounterexamples: [],
  warningCount: analysis.warnings.length,
  coveredWarningCount: 0,
  refutedWarnings: [],
  unwarnedMutations: [],
});

const getMatchedStates = (context: ScoringContext, capturedShapes: Shape[]): number[] => {
  const shapes = normalizeShapes(capturedShapes);
  const shapesKey = JSON.stringify(shapes);
  const cachedStates = context.matchedStatesCache.get(shapesKey);
  if (cachedStates) return cachedStates;
  const matchedStates = context.expectedStates.flatMap((expected, stateIndex) =>
    matchesExpected(expected, shapes) ? [stateIndex] : [],
  );
  context.matchedStatesCache.set(shapesKey, matchedStates);
  return matchedStates;
};

const getRegionIndices = (context: ScoringContext): number[] =>
  context.report.regions.map((_region, regionIndex) => regionIndex);

const getStatesInRegion = (
  context: ScoringContext,
  stateIndices: number[],
  regionIndex: number,
): number[] =>
  stateIndices.filter(
    (stateIndex) => context.report.states[stateIndex]?.regionIndex === regionIndex,
  );

const isEveryRegionMatched = (context: ScoringContext, matchedStates: number[]): boolean =>
  getRegionIndices(context).every(
    (regionIndex) => getStatesInRegion(context, matchedStates, regionIndex).length > 0,
  );

const isRegionUnchanged = (
  context: ScoringContext,
  beforeStates: number[],
  afterStates: number[],
  regionIndex: number,
): boolean =>
  getStatesInRegion(context, beforeStates, regionIndex).some((stateIndex) =>
    afterStates.includes(stateIndex),
  );

const isExternalRegion = (context: ScoringContext, regionIndex: number): boolean =>
  context.report.regions[regionIndex]?.bindingIds.some((bindingId) =>
    context.externalBindingIds.has(bindingId),
  ) ?? false;

const getTransitions = (
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

const getTargetStates = (
  context: ScoringContext,
  fromStates: number[],
  handlerIds: Set<string>,
): number[] => [
  ...new Set(
    getTransitions(context, fromStates, handlerIds).flatMap((transition) => transition.targets),
  ),
];

const scoreRender = (
  context: ScoringContext,
  props: Record<string, Sample>,
  path: string[],
  shapes: Shape[],
): number[] | null => {
  const matchedStates = getMatchedStates(context, shapes);
  if (isEveryRegionMatched(context, matchedStates)) {
    for (const stateIndex of matchedStates) context.coveredStates.add(stateIndex);
    return matchedStates;
  }
  if (!context.report.isTruncated) {
    const normalized = normalizeShapes(shapes);
    const closestState = findClosest(context.expectedStates, normalized);
    context.verdict.stateCounterexamples.push({
      props,
      path,
      rendered: formatShapes(normalized).slice(0, MAX_RENDERED_LENGTH),
      closestState,
      reason: explainMismatch(context.expectedStates[closestState] ?? [], normalized),
    });
  }
  return null;
};

const scoreFirstCommit = (
  context: ScoringContext,
  observation: Observation,
  settledMatches: number[] | null,
): void => {
  const { firstCommitShapes } = observation.after;
  if (observation.action || !firstCommitShapes) return;
  const firstMatches = scoreRender(context, observation.props, [FIRST_COMMIT], firstCommitShapes);
  if (!firstMatches || !settledMatches || context.externalBindingIds.size > 0) return;
  const isUnexplained = getRegionIndices(context).some(
    (regionIndex) =>
      getStatesInRegion(context, settledMatches, regionIndex).length > 0 &&
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

const getTriggeredHandlerIds = (context: ScoringContext, action: Action): EdgeHandlerIds => {
  const edgeIds: EdgeHandlerIds = { triggeredIds: new Set(), maybeTriggeredIds: new Set() };
  for (const handler of context.analysis.handlers) {
    const certainty = getHandlerCertainty(context.handlerTargets.get(handler.id) ?? [], action);
    if (certainty) edgeIds.triggeredIds.add(handler.id);
    if (certainty === "maybe") edgeIds.maybeTriggeredIds.add(handler.id);
  }
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
    path.slice(0, -1).flatMap((actionKey) => {
      const earlierAction = context.actionsByKey.get(actionKey);
      return earlierAction ? [...getTriggeredHandlerIds(context, earlierAction).triggeredIds] : [];
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
  const transitions = getTransitions(
    context,
    getStatesInRegion(context, edge.beforeMatches, regionIndex),
    edge.triggeredIds,
  );
  if (transitions.length === 0) return isUnchanged;
  return transitions.some(
    (transition) =>
      transition.targets.some((target) => edge.afterMatches.includes(target)) ||
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
    predictedStates: getTargetStates(context, edge.beforeMatches, edge.triggeredIds),
    reason,
  });
};

const scoreTransition = (
  context: ScoringContext,
  observation: Observation,
  afterMatches: number[],
): void => {
  const { action, before } = observation;
  if (!action || !before || before.error) return;
  const beforeMatches = getMatchedStates(context, before.shapes);
  if (!isEveryRegionMatched(context, beforeMatches)) return;
  const edge: ObservedEdge = {
    action,
    path: observation.path,
    beforeMatches,
    afterMatches,
    ...getTriggeredHandlerIds(context, action),
    earlierTriggeredIds: getEarlierTriggeredIds(context, observation.path),
  };
  const regions = getRegionIndices(context);
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

const getMountFailedVerdict = (
  verdict: ComponentVerdict,
  observations: Observation[],
): ComponentVerdict | null => {
  const isNothingMounted = observations.every(
    (observation) => observation.after.error && observation.after.shapes.length === 0,
  );
  if (!isNothingMounted) return null;
  const firstCapture = observations[0]?.after;
  return {
    ...verdict,
    status: "mount-failed",
    error: firstCapture?.error ?? "nothing was mounted",
    mountFailure: firstCapture ? getCaptureFailure(firstCapture) : "did-not-render",
  };
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
  handlerTargets: collectHandlerTargets(analysis.render),
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
  actionsByKey: new Map(
    observations.flatMap((observation) =>
      observation.action ? [[observation.action.key, observation.action]] : [],
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
  if (afterMatches) scoreTransition(context, observation, afterMatches);
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

const formatSample = (sample: Sample): string => {
  switch (sample.kind) {
    case "Value":
      return JSON.stringify(sample.value);
    case "Array":
      return `[${sample.items.map(formatSample).join(", ")}]`;
    case "Object":
      return "{…}";
    case "Element":
      return "<span>";
    case "Promise":
      return `Promise(${formatSample(sample.value)})`;
    case "Date":
      return `Date(${sample.value})`;
    case "Set":
      return `Set(${sample.items.map(formatSample).join(", ")})`;
    case "Map":
      return "Map(…)";
    case "Function":
      return "fn";
    case "Undefined":
      return "undefined";
  }
};

const formatProps = (props: Record<string, Sample>): string =>
  Object.entries(props)
    .filter(([, sample]) => sample.kind !== "Undefined")
    .map(([name, sample]) => `${name}=${formatSample(sample)}`)
    .join(" ")
    .slice(0, MAX_PROPS_LENGTH) || "no props";

const formatStates = (stateIndices: number[]): string =>
  stateIndices.map(formatStateLabel).join("|");

export const formatCounterexamples = (verdict: ComponentVerdict): string[] => [
  ...verdict.stateCounterexamples.map(
    (counterexample) =>
      `unpredicted state after [${counterexample.path.join(" → ") || "mount"}] with ${formatProps(counterexample.props)}: ${counterexample.reason} (closest ${formatStates([counterexample.closestState])})`,
  ),
  ...verdict.transitionCounterexamples.map(
    (counterexample) =>
      `${counterexample.reason}: ${counterexample.action} went ${formatStates(counterexample.fromStates)} → ${formatStates(counterexample.toStates)}, predicted ${formatStates(counterexample.predictedStates) || "no change"}`,
  ),
  ...verdict.valueCounterexamples.map(
    (counterexample) =>
      `${counterexample.place} = ${counterexample.value}, predicted ${counterexample.predicted.join(" | ")}`,
  ),
  ...verdict.reachedUnreachableBranches.map((claim) => `unreachable branch was reached: ${claim}`),
  ...verdict.refutedWarnings.map((warning) => `mutation warning refuted: ${warning}`),
];

export const countCounterexamples = (verdict: ComponentVerdict): number =>
  verdict.stateCounterexamples.length +
  verdict.transitionCounterexamples.length +
  verdict.valueCounterexamples.length +
  verdict.reachedUnreachableBranches.length +
  verdict.refutedWarnings.length;

export const sum = <Item>(items: Item[], getValue: (item: Item) => number): number =>
  items.reduce((total, item) => total + getValue(item), 0);

export const formatMountFailures = (
  mountFailureCounts: VerificationSummary["mountFailureCounts"],
): string =>
  Object.entries(mountFailureCounts)
    .sort(([, left], [, right]) => (right ?? 0) - (left ?? 0))
    .map(([failure, count]) => `${failure} ${count}`)
    .join(", ");

export const summarizeVerdicts = (
  verdicts: ComponentVerdict[],
  durationMs: number,
): VerificationSummary => {
  const verifiedVerdicts = verdicts.filter((verdict) => verdict.status === "verified");
  const mountFailedVerdicts = verdicts.filter((verdict) => verdict.status === "mount-failed");
  const mountFailureCounts: Partial<Record<MountFailure, number>> = {};
  for (const verdict of mountFailedVerdicts) {
    const failure = verdict.mountFailure ?? "other";
    mountFailureCounts[failure] = (mountFailureCounts[failure] ?? 0) + 1;
  }
  return {
    verifiedCount: verifiedVerdicts.length,
    unmountableCount: mountFailedVerdicts.length,
    notExportedCount: verdicts.filter((verdict) => verdict.status === "not-exported").length,
    counterexampleCount: sum(verifiedVerdicts, countCounterexamples),
    predictedStateCount: sum(verifiedVerdicts, (verdict) => verdict.predictedStateCount),
    coveredStateCount: sum(verifiedVerdicts, (verdict) => verdict.coveredStateIndices.length),
    branchSideCount: sum(verifiedVerdicts, (verdict) => verdict.branchSideCount),
    coveredBranchSideCount: sum(verifiedVerdicts, (verdict) => verdict.coveredBranchSideCount),
    warningCount: sum(verifiedVerdicts, (verdict) => verdict.warningCount),
    coveredWarningCount: sum(verifiedVerdicts, (verdict) => verdict.coveredWarningCount),
    unwarnedMutationCount: sum(verifiedVerdicts, (verdict) => verdict.unwarnedMutations.length),
    mountFailureCounts,
    durationMs,
  };
};
