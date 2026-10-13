import { ANY_EVENT } from "../../src/core/collect-handlers.js";
import type {
  AbstractValue,
  BindingKind,
  Binding,
  ComponentAnalysis,
  Sample,
  StateReport,
  SymbolicValue,
} from "../../src/core/types.js";
import { forEachJsxElement, forEachRenderNode } from "../../src/core/utils/traverse.js";
import { formatAbstractValue, formatLine, formatPlace } from "../../src/core/format.js";
import { isStateBinding } from "../../src/core/utils/checks.js";
import { parsePlaceKey } from "../../src/core/utils/place-key.js";
import type { types } from "@babel/core";
import { GeneratedSource } from "../../src/react-compiler/HIR/HIR.js";
import type { Observation } from "./driver.js";
import { TRUNCATED_VALUE } from "./types.js";
import type { Action, ActionTarget, Shape } from "./types.js";
import {
  explainMismatch,
  findClosest,
  formatShapes,
  matchesExpected,
  normalizeShapes,
  normalizeText,
  toExpected,
} from "./match.js";
import { scoreWarnings } from "./mutation.js";
import { getCaptureFailure } from "./reasons.js";
import type { MountFailure } from "./reasons.js";
import type { Probe } from "./server.js";

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
  observations: number;
  renderErrors: number;
  predictedStates: number;
  coveredStates: number[];
  stateCounterexamples: StateCounterexample[];
  coveredTransitions: number;
  transitionCounterexamples: TransitionCounterexample[];
  branchSides: number;
  coveredBranchSides: number;
  unreachableClaims: number;
  reachedUnreachableBranches: string[];
  valueCounterexamples: ValueCounterexample[];
  warnings: number;
  coveredWarnings: number;
  refutedWarnings: string[];
  unwarnedMutations: string[];
}

export interface VerificationSummary {
  verified: number;
  couldNotMount: number;
  notExported: number;
  counterexamples: number;
  predictedStates: number;
  coveredStates: number;
  branchSides: number;
  coveredBranchSides: number;
  warnings: number;
  coveredWarnings: number;
  unwarnedMutations: number;
  mountFailures: Partial<Record<MountFailure, number>>;
  durationMs: number;
}

type Trigger = "sure" | "maybe";

interface TriggerLabel {
  tag: string;
  text: string | null;
  event: string;
}

const FIRST_COMMIT = "first commit";
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

// A component may call a handler prop from any element it renders, under any event name.
const isComponentTag = (tag: string): boolean => /^[A-Z]/.test(tag) || tag.includes(".");

const isLabelTarget = (label: TriggerLabel, target: ActionTarget): boolean =>
  label.tag === target.tag && (label.text === null || label.text === target.label);

// Other events can fire as a side effect of these, like focus on a click.
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
  `${file}:${loc.start.index}:${loc.end.index}`;

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
    (binding) =>
      binding.kind !== "prop" &&
      binding.kind !== "item" &&
      binding.kind !== "call" &&
      binding.kind !== "suspense",
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
  expectedStates: ReturnType<typeof toExpected>[];
  triggerLabels: Map<string, TriggerLabel>;
  stateBindings: Binding[] | null;
  externalBindingIds: Set<number>;
  effectIds: Set<string>;
  coveredStates: Set<number>;
  matchCache: Map<string, number[]>;
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
  observations: 0,
  renderErrors: 0,
  predictedStates: report.states.length,
  coveredStates: [],
  stateCounterexamples: [],
  coveredTransitions: 0,
  transitionCounterexamples: [],
  branchSides: 0,
  coveredBranchSides: 0,
  unreachableClaims: report.unreachableBranches.length,
  reachedUnreachableBranches: [],
  valueCounterexamples: [],
  warnings: analysis.warnings.length,
  coveredWarnings: 0,
  refutedWarnings: [],
  unwarnedMutations: [],
});

const getMatches = (context: ScoringContext, capturedShapes: Shape[]): number[] => {
  const shapes = normalizeShapes(capturedShapes);
  const key = JSON.stringify(shapes);
  const cached = context.matchCache.get(key);
  if (cached) return cached;
  const matches = context.expectedStates.flatMap((expected, index) =>
    matchesExpected(expected, shapes) ? [index] : [],
  );
  context.matchCache.set(key, matches);
  return matches;
};

const getRegionIndices = (context: ScoringContext): number[] =>
  context.report.regions.map((_, index) => index);

const inRegion = (context: ScoringContext, matches: number[], region: number): number[] =>
  matches.filter((match) => context.report.states[match]?.region === region);

const isEveryRegionMatched = (context: ScoringContext, matches: number[]): boolean =>
  getRegionIndices(context).every((region) => inRegion(context, matches, region).length > 0);

const isRegionUnchanged = (
  context: ScoringContext,
  before: number[],
  after: number[],
  region: number,
): boolean => inRegion(context, before, region).some((match) => after.includes(match));

const isExternalRegion = (context: ScoringContext, region: number): boolean =>
  context.report.regions[region]?.bindingIds.some((bindingId) =>
    context.externalBindingIds.has(bindingId),
  ) ?? false;

const getTransitions = (context: ScoringContext, from: number[], handlerIds: Set<string>) =>
  from.flatMap(
    (index) =>
      context.report.states[index]?.transitions.filter((transition) =>
        handlerIds.has(transition.handlerId),
      ) ?? [],
  );

const getTargets = (context: ScoringContext, from: number[], handlerIds: Set<string>): number[] => [
  ...new Set(getTransitions(context, from, handlerIds).flatMap((transition) => transition.targets)),
];

/** Records a render that matches no predicted state, or the states it covers. */
const scoreRender = (
  context: ScoringContext,
  props: Record<string, Sample>,
  path: string[],
  shapes: Shape[],
): number[] | null => {
  const matches = getMatches(context, shapes);
  if (isEveryRegionMatched(context, matches)) {
    for (const match of matches) context.coveredStates.add(match);
    return matches;
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

/** Checks that what effects changed between the first commit and the settled render was predicted. */
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
    (region) =>
      inRegion(context, settledMatches, region).length > 0 &&
      !isRegionUnchanged(context, firstMatches, settledMatches, region) &&
      !getTransitions(context, inRegion(context, firstMatches, region), context.effectIds).some(
        (transition) => transition.targets.some((target) => settledMatches.includes(target)),
      ),
  );
  if (isUnexplained)
    context.verdict.transitionCounterexamples.push({
      path: [],
      action: FIRST_COMMIT,
      fromStates: firstMatches,
      toStates: settledMatches,
      predictedStates: getTargets(context, firstMatches, context.effectIds),
      reason: "unpredicted-effect",
    });
};

/** Checks each state value the page holds against the literals the analysis predicts. */
const scoreValues = (context: ScoringContext, observation: Observation): void => {
  context.stateBindings?.forEach((binding, hookIndex) => {
    for (const [placeKey, predicted] of context.report.places) {
      const { bindingId, path: placePath } = parsePlaceKey(placeKey);
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

/** Checks that an action moved every region to a state its handlers predict. */
const scoreTransition = (
  context: ScoringContext,
  observation: Observation,
  afterMatches: number[],
): void => {
  const { action, before, path } = observation;
  if (!action || !before || before.error) return;
  const beforeMatches = getMatches(context, before.shapes);
  if (!isEveryRegionMatched(context, beforeMatches)) return;
  const triggers = context.analysis.handlers.flatMap((handler) => {
    const label = context.triggerLabels.get(handler.id);
    const trigger = label ? getTrigger(label, action) : null;
    return trigger ? [{ handler, trigger }] : [];
  });
  const triggeredIds = new Set(triggers.map(({ handler }) => handler.id));
  const maybeTriggeredIds = new Set(
    triggers.flatMap(({ handler, trigger }) => (trigger === "maybe" ? [handler.id] : [])),
  );
  // A child's handler can change any hook or context value the component reads.
  const isFreeToChange = (region: number): boolean =>
    action.isInChild && isExternalRegion(context, region);
  const recordWrongEdge = (reason: TransitionCounterexample["reason"]): void => {
    context.verdict.transitionCounterexamples.push({
      path,
      action: action.key,
      fromStates: beforeMatches,
      toStates: afterMatches,
      predictedStates: getTargets(context, beforeMatches, triggeredIds),
      reason,
    });
  };
  const regions = getRegionIndices(context);
  if (triggeredIds.size === 0) {
    const isExplained = regions.every(
      (region) =>
        isRegionUnchanged(context, beforeMatches, afterMatches, region) || isFreeToChange(region),
    );
    if (!isExplained) recordWrongEdge("unmodeled-handler");
    return;
  }
  const isPredicted = regions.every((region) => {
    if (isFreeToChange(region)) return true;
    const isUnchanged = isRegionUnchanged(context, beforeMatches, afterMatches, region);
    const transitions = getTransitions(
      context,
      inRegion(context, beforeMatches, region),
      triggeredIds,
    );
    return transitions.length === 0
      ? isUnchanged
      : transitions.some(
          (transition) =>
            transition.targets.some((target) => afterMatches.includes(target)) ||
            (isUnchanged && (transition.isAsync || maybeTriggeredIds.has(transition.handlerId))),
        );
  });
  if (isPredicted) context.verdict.coveredTransitions++;
  else if (!context.report.isTruncated) recordWrongEdge("unpredicted-target");
};

export const scoreComponent = (
  analysis: ComponentAnalysis,
  report: StateReport,
  observations: Observation[],
  knownComponents: Map<string, string>,
): ComponentVerdict => {
  const verdict = { ...createEmptyVerdict(analysis, report), observations: observations.length };
  if (!analysis.exportName) return verdict;
  if (
    observations.every(
      (observation) => observation.after.error && observation.after.shapes.length === 0,
    )
  ) {
    const first = observations[0]?.after;
    return {
      ...verdict,
      status: "mount-failed",
      error: first?.error ?? "nothing was mounted",
      mountFailure: first ? getCaptureFailure(first) : "did-not-render",
    };
  }
  const context: ScoringContext = {
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
    effectIds: new Set(
      analysis.handlers
        .filter((handler) => handler.trigger.kind === "Effect")
        .map((handler) => handler.id),
    ),
    coveredStates: new Set(),
    matchCache: new Map(),
  };
  const probes = collectProbes(analysis);
  const probeIds = new Set(probes.map((probe) => probe.id));
  const coveredSides = new Set<string>();

  for (const observation of observations) {
    for (const hit of observation.after.probes)
      if (probeIds.has(hit.id)) coveredSides.add(`${hit.id}:${hit.outcome}`);
    if (observation.after.error) {
      verdict.renderErrors++;
      continue;
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
  }

  verdict.coveredStates = [...context.coveredStates].sort((left, right) => left - right);
  verdict.branchSides = probes.length * 2;
  verdict.coveredBranchSides = coveredSides.size;
  verdict.reachedUnreachableBranches = report.unreachableBranches
    .filter(({ branch, side }) => {
      const { loc } = branch;
      return loc !== GeneratedSource && coveredSides.has(`${getProbeId(branch.file, loc)}:${side}`);
    })
    .map(({ branch, description }) => `${description} ${formatLine(branch.loc)}`.trim());
  return { ...verdict, ...scoreWarnings(analysis, observations, context.stateBindings) };
};

const formatSample = (sample: Sample): string => {
  if (sample.kind === "Value") return JSON.stringify(sample.value);
  if (sample.kind === "Array") return `[${sample.items.map(formatSample).join(", ")}]`;
  if (sample.kind === "Object") return "{…}";
  if (sample.kind === "Element") return "<span>";
  if (sample.kind === "Promise") return `Promise(${formatSample(sample.value)})`;
  if (sample.kind === "Date") return `Date(${sample.value})`;
  if (sample.kind === "Set") return `Set(${sample.items.map(formatSample).join(", ")})`;
  if (sample.kind === "Map") return "Map(…)";
  return sample.kind === "Function" ? "fn" : "undefined";
};

const formatProps = (props: Record<string, Sample>): string =>
  Object.entries(props)
    .filter(([, sample]) => sample.kind !== "Undefined")
    .map(([name, sample]) => `${name}=${formatSample(sample)}`)
    .join(" ")
    .slice(0, MAX_PROPS_LENGTH) || "no props";

export const formatStates = (states: number[]): string =>
  states.map((state) => `S${state + 1}`).join("|");

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

export const formatMountFailures = (mountFailures: VerificationSummary["mountFailures"]): string =>
  Object.entries(mountFailures)
    .sort(([, left], [, right]) => (right ?? 0) - (left ?? 0))
    .map(([failure, count]) => `${failure} ${count}`)
    .join(", ");

export const summarizeVerdicts = (
  verdicts: ComponentVerdict[],
  durationMs: number,
): VerificationSummary => {
  const verified = verdicts.filter((verdict) => verdict.status === "verified");
  const mountFailed = verdicts.filter((verdict) => verdict.status === "mount-failed");
  const mountFailures: Partial<Record<MountFailure, number>> = {};
  for (const verdict of mountFailed) {
    const failure = verdict.mountFailure ?? "other";
    mountFailures[failure] = (mountFailures[failure] ?? 0) + 1;
  }
  return {
    verified: verified.length,
    couldNotMount: mountFailed.length,
    notExported: verdicts.filter((verdict) => verdict.status === "not-exported").length,
    counterexamples: sum(verified, countCounterexamples),
    predictedStates: sum(verified, (verdict) => verdict.predictedStates),
    coveredStates: sum(verified, (verdict) => verdict.coveredStates.length),
    branchSides: sum(verified, (verdict) => verdict.branchSides),
    coveredBranchSides: sum(verified, (verdict) => verdict.coveredBranchSides),
    warnings: sum(verified, (verdict) => verdict.warnings),
    coveredWarnings: sum(verified, (verdict) => verdict.coveredWarnings),
    unwarnedMutations: sum(verified, (verdict) => verdict.unwarnedMutations.length),
    mountFailures,
    durationMs,
  };
};
