import { ANY_EVENT, isEffectHandler } from "../../../src/core/collect-handlers";
import type {
  AbstractValue,
  BindingKind,
  Binding,
  ComponentAnalysis,
  Sample,
  StateReport,
  SymbolicValue,
  Transition,
} from "../../../src/core/types";
import { forEachJsxElement, forEachRenderNode } from "../../../src/core/utils/traverse";
import {
  formatAbstractValue,
  formatLine,
  formatPlace,
  formatStateLabel,
} from "../../../src/core/format";
import { isStateBinding } from "../../../src/core/utils/checks";
import { getLocationKey } from "../../../src/core/utils/hir";
import type { types } from "@babel/core";
import { GeneratedSource } from "../../../src/react-compiler/HIR/HIR";
import type { Observation } from "./driver";
import { TRUNCATED_VALUE } from "./types";
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

type Trigger = "sure" | "maybe";

interface TriggerLabel {
  tag: string;
  text: string | null;
  event: string;
}

const FIRST_COMMIT = "first commit";
const NON_HOOK_BINDING_KINDS = new Set<BindingKind>(["prop", "item", "call", "loop", "suspense"]);
const EXTERNAL_DATA_BINDING_KINDS = new Set<BindingKind>(["hook", "context", "call", "suspense"]);
const MAX_RENDERED_LENGTH = 300;
const MAX_PROPS_LENGTH = 160;
const ORDERED_HOOK_KINDS = new Set<string>([
  "useState",
  "useReducer",
  "useRef",
  "useMemo",
  "useCallback",
  "useContext",
]);

const isComponentTag = (tag: string): boolean => /^[A-Z]/.test(tag) || tag.includes(".");

const isLabelTarget = (label: TriggerLabel, target: ActionTarget): boolean =>
  label.tag === target.tag && (label.text === null || label.text === target.label);

const DISPATCHED_EVENTS = new Set(["onClick", "onChange", "onInput", "onSubmit"]);

const getTrigger = (label: TriggerLabel, action: Action): Trigger | null => {
  if (isComponentTag(label.tag))
    return label.text === null || label.text.includes(action.label) ? "maybe" : null;
  if (!DISPATCHED_EVENTS.has(label.event) && label.event !== ANY_EVENT) return "maybe";
  const eventName = action.kind === "click" ? "onClick" : "onChange";
  if (label.event !== eventName && label.event !== ANY_EVENT) return null;
  if (isLabelTarget(label, action)) return "sure";
  return action.kind === "click" &&
    action.clickAncestors.some((target) => isLabelTarget(label, target))
    ? "maybe"
    : null;
};

const getProbeId = (file: string, loc: types.SourceLocation): string =>
  `${file}:${getLocationKey(loc)}`;

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

const collectTriggerLabels = (render: SymbolicValue): Map<string, TriggerLabel> => {
  const labels = new Map<string, TriggerLabel>();
  forEachJsxElement(render, (value) => {
    for (const prop of value.props) {
      if (!prop.handlerId) continue;
      labels.set(prop.handlerId, {
        tag: value.tag.name,
        text: getStaticText(value) || null,
        event: prop.kind === "JsxAttribute" ? prop.name : ANY_EVENT,
      });
    }
  });
  return labels;
};

const getStateBindings = (analysis: ComponentAnalysis): Binding[] | null => {
  const hookBindings = analysis.bindings.filter(
    (binding) => !NON_HOOK_BINDING_KINDS.has(binding.kind),
  );
  if (
    hookBindings.some((binding) => !binding.hookKind || !ORDERED_HOOK_KINDS.has(binding.hookKind))
  )
    return null;
  return analysis.bindings.filter(isStateBinding);
};

const isPredictedValue = (value: unknown, predicted: AbstractValue[]): boolean =>
  predicted.some((candidate) => candidate.kind === "Literal" && Object.is(candidate.value, value));

const readPath = (value: unknown, path: string[]): unknown =>
  path.reduce<unknown>((current, segment) => {
    if (current === TRUNCATED_VALUE) return current;
    return current && typeof current === "object" ? Reflect.get(current, segment) : undefined;
  }, value);

const formatRuntimeValue = (value: unknown): string =>
  value === undefined ? "undefined" : JSON.stringify(value);

interface ScoringContext {
  analysis: ComponentAnalysis;
  report: StateReport;
  verdict: ComponentVerdict;
  expectedStates: ExpectedShape[][];
  triggerLabels: Map<string, TriggerLabel>;
  stateBindings: Binding[] | null;
  externalBindingIds: Set<number>;
  effectIds: Set<string>;
  coveredStates: Set<number>;
  matchedStatesCache: Map<string, number[]>;
}

const createEmptyVerdict = (
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
        context.effectIds,
      ).some((transition) => transition.targets.some((target) => settledMatches.includes(target))),
  );
  if (isUnexplained)
    context.verdict.transitionCounterexamples.push({
      path: [],
      action: FIRST_COMMIT,
      fromStates: firstMatches,
      toStates: settledMatches,
      predictedStates: getTargetStates(context, firstMatches, context.effectIds),
      reason: "unpredicted-effect",
    });
};

const scoreValues = (context: ScoringContext, observation: Observation): void => {
  context.stateBindings?.forEach((binding, hookIndex) => {
    for (const [{ bindingId, path: placePath }, predicted] of context.report.places) {
      if (bindingId !== binding.id || !predicted.every((value) => value.kind === "Literal"))
        continue;
      const value = readPath(observation.after.hookStates[hookIndex], placePath);
      if (value === TRUNCATED_VALUE || isPredictedValue(value, predicted)) continue;
      context.verdict.valueCounterexamples.push({
        path: observation.path,
        place: formatPlace(binding, placePath),
        value: formatRuntimeValue(value),
        predicted: predicted.map(formatAbstractValue),
      });
    }
  });
};

interface ObservedEdge {
  action: Action;
  path: string[];
  beforeMatches: number[];
  afterMatches: number[];
  triggeredIds: Set<string>;
  maybeTriggeredIds: Set<string>;
}

const getTriggeredHandlerIds = (
  context: ScoringContext,
  action: Action,
): Pick<ObservedEdge, "triggeredIds" | "maybeTriggeredIds"> => {
  const triggeredIds = new Set<string>();
  const maybeTriggeredIds = new Set<string>();
  for (const handler of context.analysis.handlers) {
    const label = context.triggerLabels.get(handler.id);
    const trigger = label ? getTrigger(label, action) : null;
    if (trigger) triggeredIds.add(handler.id);
    if (trigger === "maybe") maybeTriggeredIds.add(handler.id);
  }
  return { triggeredIds, maybeTriggeredIds };
};

const canChildActionChange = (
  context: ScoringContext,
  edge: ObservedEdge,
  regionIndex: number,
): boolean => edge.action.isInChild && isExternalRegion(context, regionIndex);

const isRegionEdgePredicted = (
  context: ScoringContext,
  edge: ObservedEdge,
  regionIndex: number,
): boolean => {
  if (canChildActionChange(context, edge, regionIndex)) return true;
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
  };
  const regions = getRegionIndices(context);
  if (edge.triggeredIds.size === 0) {
    const isExplained = regions.every(
      (regionIndex) =>
        isRegionUnchanged(context, beforeMatches, afterMatches, regionIndex) ||
        canChildActionChange(context, edge, regionIndex),
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
  knownComponents: Map<string, string>,
): ScoringContext => ({
  analysis,
  report,
  verdict,
  expectedStates: report.states.map((state) => toExpected(state.render, knownComponents)),
  triggerLabels: collectTriggerLabels(analysis.render),
  stateBindings: getStateBindings(analysis),
  externalBindingIds: new Set(
    analysis.bindings
      .filter((binding) => EXTERNAL_DATA_BINDING_KINDS.has(binding.kind))
      .map((binding) => binding.id),
  ),
  effectIds: new Set(analysis.handlers.filter(isEffectHandler).map((handler) => handler.id)),
  coveredStates: new Set(),
  matchedStatesCache: new Map(),
});

const getReachedUnreachableBranches = (report: StateReport, coveredSides: Set<string>): string[] =>
  report.unreachableBranches
    .filter(
      (unreachableBranch) =>
        unreachableBranch.branch.loc !== GeneratedSource &&
        coveredSides.has(
          `${getProbeId(unreachableBranch.branch.file, unreachableBranch.branch.loc)}:${unreachableBranch.isTrueSide}`,
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
    if (probeIds.has(probeHit.id)) coveredSides.add(`${probeHit.id}:${probeHit.isTrueSide}`);
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
  const context = createScoringContext(analysis, report, verdict, knownComponents);
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
