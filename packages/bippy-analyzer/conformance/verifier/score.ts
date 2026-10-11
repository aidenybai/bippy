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
import { GeneratedSource } from "../../src/compiler/hir/hir.js";
import type { Observation } from "./driver.js";
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
import { classifyMountError } from "./reasons.js";
import type { MountFailure } from "./reasons.js";
import type { Probe } from "./server.js";
import type { Shape } from "./types.js";

type ComponentStatus = "verified" | "not-exported" | "mount-failed";

interface WrongState {
  props: Record<string, Sample>;
  path: string[];
  rendered: string;
  closestState: number;
  reason: string;
}

interface WrongEdge {
  path: string[];
  action: string;
  fromStates: number[];
  toStates: number[];
  predictedStates: number[];
  reason: "unpredicted-target" | "unmodeled-handler" | "unpredicted-effect";
}

interface WrongValue {
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
  witnessedStates: number[];
  wrongStates: WrongState[];
  witnessedEdges: number;
  wrongEdges: WrongEdge[];
  branchSides: number;
  witnessedBranchSides: number;
  deadClaims: number;
  refutedDeadClaims: string[];
  wrongValues: WrongValue[];
  warnings: number;
  witnessedWarnings: number;
  refutedWarnings: string[];
  unwarnedMutations: string[];
}

export interface VerificationSummary {
  verified: number;
  couldNotMount: number;
  notExported: number;
  wrong: number;
  predictedStates: number;
  witnessedStates: number;
  branchSides: number;
  witnessedBranchSides: number;
  warnings: number;
  witnessedWarnings: number;
  unwarnedMutations: number;
  mountFailures: Partial<Record<MountFailure, number>>;
  durationMs: number;
}

interface TriggerLabel {
  tag: string;
  text: string | null;
  event: string;
}

const FIRST_COMMIT = "first commit";
const EXTERNAL_DATA_BINDING_KINDS = new Set<BindingKind>(["hook", "context", "call"]);
const MAX_RECORDED_FAILURES = 10;
const MAX_RENDERED_LENGTH = 300;
const ORDERED_HOOK_KINDS = new Set<string>([
  "useState",
  "useReducer",
  "useRef",
  "useMemo",
  "useCallback",
  "useContext",
]);

/**
 * A component given an event handler passes it to some element it renders, so its clicks
 * land on a host element of any tag.
 */
const isComponentTag = (tag: string): boolean => /^[A-Z]/.test(tag) || tag.includes(".");

const getProbeId = (file: string, loc: { start: number; end: number }): string =>
  `${file}:${loc.start}:${loc.end}`;

export const collectProbes = (analysis: ComponentAnalysis): Probe[] => {
  const probes = new Map<string, Probe>();
  forEachRenderNode(analysis.render, (value) => {
    if (value.kind !== "Conditional") return;
    const { decision } = value;
    if (decision.probe === "none" || decision.loc === GeneratedSource) return;
    const id = getProbeId(analysis.file, decision.loc);
    probes.set(id, {
      id,
      file: analysis.file,
      start: decision.loc.start,
      end: decision.loc.end,
      mode: decision.probe,
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
      if (!prop.transitionId) continue;
      labels.set(prop.transitionId, {
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
    (binding) => binding.kind !== "prop" && binding.kind !== "item" && binding.kind !== "call",
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
  path.reduce<unknown>(
    (current, segment) =>
      current && typeof current === "object" ? Reflect.get(current, segment) : undefined,
    value,
  );

const formatRuntimeValue = (value: unknown): string =>
  value === undefined ? "undefined" : JSON.stringify(value);

const recordFailure = <Failure>(failures: Failure[], failure: Failure): void => {
  if (failures.length < MAX_RECORDED_FAILURES) failures.push(failure);
};

export const scoreComponent = (
  analysis: ComponentAnalysis,
  report: StateReport,
  observations: Observation[],
  knownComponents: Map<string, string>,
): ComponentVerdict => {
  const verdict: ComponentVerdict = {
    name: analysis.name,
    file: analysis.file,
    status: analysis.exportName ? "verified" : "not-exported",
    error: null,
    mountFailure: null,
    observations: observations.length,
    renderErrors: 0,
    predictedStates: report.states.length,
    witnessedStates: [],
    wrongStates: [],
    witnessedEdges: 0,
    wrongEdges: [],
    branchSides: 0,
    witnessedBranchSides: 0,
    deadClaims: report.deadBranches.length,
    refutedDeadClaims: [],
    wrongValues: [],
    warnings: analysis.warnings.length,
    witnessedWarnings: 0,
    refutedWarnings: [],
    unwarnedMutations: [],
  };
  if (!analysis.exportName) return verdict;

  if (
    observations.every(
      (observation) => observation.after.error && observation.after.shapes.length === 0,
    )
  ) {
    const error = observations[0]?.after.error ?? "nothing was mounted";
    return {
      ...verdict,
      status: "mount-failed",
      error,
      mountFailure: classifyMountError(error),
    };
  }

  const expectedStates = report.states.map((state) => toExpected(state.render, knownComponents));
  const triggerLabels = collectTriggerLabels(analysis.render);
  const stateBindings = getStateBindings(analysis);
  const witnessedStates = new Set<number>();
  const matchCache = new Map<string, number[]>();

  const describeMismatch = (props: Record<string, Sample>, path: string[], shapes: Shape[]) => {
    const closestState = findClosest(expectedStates, shapes);
    return {
      props,
      path,
      rendered: formatShapes(shapes).slice(0, MAX_RENDERED_LENGTH),
      closestState,
      reason: explainMismatch(expectedStates[closestState] ?? [], shapes),
    };
  };

  const getMatches = (capturedShapes: Shape[]): number[] => {
    const shapes = normalizeShapes(capturedShapes);
    const key = JSON.stringify(shapes);
    const cached = matchCache.get(key);
    if (cached) return cached;
    const matches = expectedStates.flatMap((expected, index) =>
      matchesExpected(expected, shapes) ? [index] : [],
    );
    matchCache.set(key, matches);
    return matches;
  };

  const groupIndices = report.groups.map((_, index) => index);
  const inGroup = (matches: number[], group: number): number[] =>
    matches.filter((match) => report.states[match]?.group === group);
  const isEveryGroupMatched = (matches: number[]): boolean =>
    groupIndices.every((group) => inGroup(matches, group).length > 0);
  const isGroupUnchanged = (before: number[], after: number[], group: number): boolean =>
    inGroup(before, group).some((match) => after.includes(match));
  const externalBindingIds = new Set(
    analysis.bindings
      .filter((binding) => EXTERNAL_DATA_BINDING_KINDS.has(binding.kind))
      .map((binding) => binding.id),
  );
  const isExternalGroup = (group: number): boolean =>
    report.groups[group]?.bindingIds.some((bindingId) => externalBindingIds.has(bindingId)) ??
    false;
  const getEdges = (from: number[], transitionIds: Set<string>) =>
    from.flatMap(
      (index) =>
        report.states[index]?.edges.filter((edge) => transitionIds.has(edge.transitionId)) ?? [],
    );

  const effectIds = new Set(
    analysis.transitions
      .filter((transition) => transition.trigger.kind === "Effect")
      .map((transition) => transition.id),
  );
  const hasExternalData = analysis.bindings.some((binding) =>
    EXTERNAL_DATA_BINDING_KINDS.has(binding.kind),
  );
  const probes = collectProbes(analysis);
  const probeIds = new Set(probes.map((probe) => probe.id));
  const witnessedSides = new Set<string>();

  for (const observation of observations) {
    const { after, before, action, path } = observation;
    for (const hit of after.probes)
      if (probeIds.has(hit.id)) witnessedSides.add(`${hit.id}:${hit.outcome}`);
    if (after.error) {
      verdict.renderErrors++;
      continue;
    }

    const afterMatches = getMatches(after.shapes);
    if (!isEveryGroupMatched(afterMatches)) {
      recordFailure(
        verdict.wrongStates,
        describeMismatch(observation.props, path, normalizeShapes(after.shapes)),
      );
    } else {
      for (const match of afterMatches) witnessedStates.add(match);
    }

    if (!action && after.firstCommitShapes) {
      const firstMatches = getMatches(after.firstCommitShapes);
      if (!isEveryGroupMatched(firstMatches)) {
        recordFailure(
          verdict.wrongStates,
          describeMismatch(
            observation.props,
            [FIRST_COMMIT],
            normalizeShapes(after.firstCommitShapes),
          ),
        );
      } else {
        for (const match of firstMatches) witnessedStates.add(match);
        const isUnexplained = groupIndices.some(
          (group) =>
            inGroup(afterMatches, group).length > 0 &&
            !isGroupUnchanged(firstMatches, afterMatches, group) &&
            !getEdges(inGroup(firstMatches, group), effectIds).some((edge) =>
              edge.targets.some((target) => afterMatches.includes(target)),
            ),
        );
        if (!hasExternalData && isUnexplained) {
          recordFailure(verdict.wrongEdges, {
            path: [],
            action: FIRST_COMMIT,
            fromStates: firstMatches,
            toStates: afterMatches,
            predictedStates: [
              ...new Set(getEdges(firstMatches, effectIds).flatMap((edge) => edge.targets)),
            ],
            reason: "unpredicted-effect",
          });
        }
      }
    }

    if (stateBindings) {
      stateBindings.forEach((binding, hookIndex) => {
        for (const [placeKey, predicted] of report.places) {
          const { bindingId, path: placePath } = parsePlaceKey(placeKey);
          if (bindingId !== binding.id || !predicted.every((value) => value.kind === "Literal"))
            continue;
          const value = readPath(after.hookStates[hookIndex], placePath);
          if (isPredictedValue(value, predicted)) continue;
          recordFailure(verdict.wrongValues, {
            path,
            place: formatPlace(binding, placePath),
            value: formatRuntimeValue(value),
            predicted: predicted.map(formatAbstractValue),
          });
        }
      });
    }

    if (!action || !before || before.error) continue;
    const beforeMatches = getMatches(before.shapes);
    if (!isEveryGroupMatched(beforeMatches) || !isEveryGroupMatched(afterMatches)) continue;
    const eventName = action.kind === "click" ? "onClick" : "onChange";
    const candidates = analysis.transitions.filter((transition) => {
      const label = triggerLabels.get(transition.id);
      return (
        label !== undefined &&
        (label.tag === action.tag || isComponentTag(label.tag)) &&
        (label.event === eventName || label.event === ANY_EVENT) &&
        (label.text === null || label.text === action.label)
      );
    });
    const candidateIds = new Set(candidates.map((candidate) => candidate.id));
    const recordWrongEdge = (reason: WrongEdge["reason"]): void =>
      recordFailure(verdict.wrongEdges, {
        path,
        action: action.key,
        fromStates: beforeMatches,
        toStates: afterMatches,
        predictedStates: [
          ...new Set(getEdges(beforeMatches, candidateIds).flatMap((edge) => edge.targets)),
        ],
        reason,
      });
    // A child's handler can change any hook or context value the component reads.
    const isFreeToChange = (group: number): boolean => action.isInChild && isExternalGroup(group);
    if (candidates.length === 0) {
      const isExplained = groupIndices.every(
        (group) => isGroupUnchanged(beforeMatches, afterMatches, group) || isFreeToChange(group),
      );
      if (!isExplained) recordWrongEdge("unmodeled-handler");
      continue;
    }
    const isPredicted = groupIndices.every((group) => {
      const isUnchangedInGroup = isGroupUnchanged(beforeMatches, afterMatches, group);
      const edges = getEdges(inGroup(beforeMatches, group), candidateIds);
      if (isFreeToChange(group)) return true;
      return edges.length === 0
        ? isUnchangedInGroup
        : edges.some(
            (edge) =>
              edge.targets.some((target) => afterMatches.includes(target)) ||
              (isUnchangedInGroup && edge.isAsync),
          );
    });
    if (isPredicted) verdict.witnessedEdges++;
    else recordWrongEdge("unpredicted-target");
  }

  verdict.witnessedStates = [...witnessedStates].sort((left, right) => left - right);
  verdict.branchSides = probes.length * 2;
  verdict.witnessedBranchSides = witnessedSides.size;
  verdict.refutedDeadClaims = report.deadBranches
    .filter(({ decision, side }) => {
      const { loc } = decision;
      return (
        loc !== GeneratedSource && witnessedSides.has(`${getProbeId(analysis.file, loc)}:${side}`)
      );
    })
    .map(({ decision, description }) => `${description} ${formatLine(decision.loc)}`.trim());
  return { ...verdict, ...scoreWarnings(analysis, observations, stateBindings) };
};

const formatSample = (sample: Sample): string => {
  if (sample.kind === "Value") return JSON.stringify(sample.value);
  if (sample.kind === "Array") return `[${sample.items.map(formatSample).join(", ")}]`;
  if (sample.kind === "Object") return "{…}";
  return sample.kind === "Function" ? "fn" : "undefined";
};

const formatProps = (props: Record<string, Sample>): string =>
  Object.entries(props)
    .filter(([, sample]) => sample.kind !== "Undefined")
    .map(([name, sample]) => `${name}=${formatSample(sample)}`)
    .join(" ")
    .slice(0, 160) || "no props";

export const formatStates = (states: number[]): string =>
  states.map((state) => `S${state + 1}`).join("|");

export const formatWrongClaims = (verdict: ComponentVerdict): string[] => [
  ...verdict.wrongStates.map(
    (wrong) =>
      `unpredicted state after [${wrong.path.join(" → ") || "mount"}] with ${formatProps(wrong.props)}: ${wrong.reason} (closest ${formatStates([wrong.closestState])})`,
  ),
  ...verdict.wrongEdges.map(
    (wrong) =>
      `${wrong.reason}: ${wrong.action} went ${formatStates(wrong.fromStates)} → ${formatStates(wrong.toStates)}, predicted ${formatStates(wrong.predictedStates) || "no change"}`,
  ),
  ...verdict.wrongValues.map(
    (wrong) => `${wrong.place} = ${wrong.value}, predicted ${wrong.predicted.join(" | ")}`,
  ),
  ...verdict.refutedDeadClaims.map((claim) => `dead branch was reached: ${claim}`),
  ...verdict.refutedWarnings.map((warning) => `mutation warning refuted: ${warning}`),
];

export const countWrongClaims = (verdict: ComponentVerdict): number =>
  verdict.wrongStates.length +
  verdict.wrongEdges.length +
  verdict.wrongValues.length +
  verdict.refutedDeadClaims.length +
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
    wrong: sum(verified, countWrongClaims),
    predictedStates: sum(verified, (verdict) => verdict.predictedStates),
    witnessedStates: sum(verified, (verdict) => verdict.witnessedStates.length),
    branchSides: sum(verified, (verdict) => verdict.branchSides),
    witnessedBranchSides: sum(verified, (verdict) => verdict.witnessedBranchSides),
    warnings: sum(verified, (verdict) => verdict.warnings),
    witnessedWarnings: sum(verified, (verdict) => verdict.witnessedWarnings),
    unwarnedMutations: sum(verified, (verdict) => verdict.unwarnedMutations.length),
    mountFailures,
    durationMs,
  };
};
