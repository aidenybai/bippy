import type {
  AbstractValue,
  Binding,
  ComponentAnalysis,
  Decision,
  Sample,
  StateReport,
  SymbolicValue,
} from "../../src/core/inference/types.js";
import { formatAbstractValue, formatPlace } from "../../src/core/inference/values.js";
import type { Observation } from "./driver.js";
import {
  findClosest,
  formatShapes,
  matchesExpected,
  normalizeShapes,
  normalizeText,
  toExpected,
} from "./match.js";
import type { Probe } from "./server.js";
import type { Capture } from "./types.js";

type ComponentStatus = "verified" | "not-exported" | "mount-failed";

interface WrongState {
  props: Record<string, Sample>;
  path: string[];
  rendered: string;
  closestState: number;
}

interface WrongEdge {
  path: string[];
  action: string;
  fromStates: number[];
  toStates: number[];
  reason: "unpredicted-target" | "unmodeled-handler";
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
  mountErrors: Record<string, number>;
  durationMs: number;
}

interface TriggerLabel {
  tag: string;
  text: string | null;
  event: string;
}

const MAX_RECORDED_FAILURES = 10;
const MAX_RENDERED_LENGTH = 300;
const MOUNT_ERROR_LENGTH = 80;
const ORDERED_HOOK_KINDS = new Set<string>([
  "useState",
  "useReducer",
  "useRef",
  "useMemo",
  "useCallback",
  "useContext",
]);

const getProbeId = (file: string, start: number): string => `${file}:${start}`;

const getDecisionProbeId = (file: string, decision: Decision): string | null =>
  typeof decision.loc === "symbol" ? null : getProbeId(file, decision.loc.start);

const visitRender = (value: SymbolicValue, visitor: (value: SymbolicValue) => void): void => {
  visitor(value);
  switch (value.kind) {
    case "JsxExpression":
    case "JsxFragment":
      for (const child of value.children) visitRender(child, visitor);
      return;
    case "Conditional":
      visitRender(value.consequent, visitor);
      visitRender(value.alternate, visitor);
      return;
    case "ArrayMap":
      visitRender(value.item, visitor);
      return;
    default:
      return;
  }
};

export const collectProbes = (analysis: ComponentAnalysis): Probe[] => {
  const probes = new Map<string, Probe>();
  visitRender(analysis.render, (value) => {
    if (value.kind !== "Conditional") return;
    const { decision } = value;
    if (decision.probe === "none" || typeof decision.loc === "symbol") return;
    const id = getProbeId(analysis.file, decision.loc.start);
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
      return typeof value.value === "string" || typeof value.value === "number" ? null : "";
    default:
      return null;
  }
};

const collectTriggerLabels = (render: SymbolicValue): Map<string, TriggerLabel> => {
  const labels = new Map<string, TriggerLabel>();
  visitRender(render, (value) => {
    if (value.kind !== "JsxExpression") return;
    for (const prop of value.props) {
      if (prop.kind !== "JsxAttribute" || !prop.transitionId) continue;
      labels.set(prop.transitionId, {
        tag: value.tag.name,
        text: getStaticText(value),
        event: prop.name,
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
  return analysis.bindings.filter(
    (binding) => binding.kind === "state" || binding.kind === "reducer",
  );
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
  };
  if (!analysis.exportName) return verdict;

  if (
    observations.every(
      (observation) => observation.after.error && observation.after.shapes.length === 0,
    )
  ) {
    return {
      ...verdict,
      status: "mount-failed",
      error: observations[0]?.after.error ?? "nothing was mounted",
    };
  }

  const expectedStates = report.states.map((state) => toExpected(state.render, knownComponents));
  const triggerLabels = collectTriggerLabels(analysis.render);
  const stateBindings = getStateBindings(analysis);
  const witnessedStates = new Set<number>();
  const matchCache = new Map<string, number[]>();

  const getMatches = (capture: Capture): number[] => {
    const shapes = normalizeShapes(capture.shapes);
    const key = JSON.stringify(shapes);
    const cached = matchCache.get(key);
    if (cached) return cached;
    const matches = expectedStates.flatMap((expected, index) =>
      matchesExpected(expected, shapes) ? [index] : [],
    );
    matchCache.set(key, matches);
    return matches;
  };

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

    const afterMatches = getMatches(after);
    if (afterMatches.length === 0) {
      const shapes = normalizeShapes(after.shapes);
      recordFailure(verdict.wrongStates, {
        props: observation.props,
        path,
        rendered: formatShapes(shapes).slice(0, MAX_RENDERED_LENGTH),
        closestState: findClosest(expectedStates, shapes),
      });
    } else {
      for (const match of afterMatches) witnessedStates.add(match);
    }

    if (stateBindings) {
      stateBindings.forEach((binding, hookIndex) => {
        for (const [placeKey, predicted] of report.places) {
          const [bindingId, ...placePath] = placeKey.split(".");
          if (
            bindingId !== String(binding.id) ||
            !predicted.every((value) => value.kind === "Literal")
          )
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
    const beforeMatches = getMatches(before);
    if (beforeMatches.length === 0 || afterMatches.length === 0) continue;
    const eventName = action.kind === "click" ? "onClick" : "onChange";
    const candidates = analysis.transitions.filter((transition) => {
      const label = triggerLabels.get(transition.id);
      return (
        label !== undefined &&
        label.tag === action.tag &&
        label.event === eventName &&
        (label.text === null || label.text === action.label)
      );
    });
    const isUnchanged = beforeMatches.some((match) => afterMatches.includes(match));
    const recordWrongEdge = (reason: WrongEdge["reason"]): void =>
      recordFailure(verdict.wrongEdges, {
        path,
        action: action.key,
        fromStates: beforeMatches,
        toStates: afterMatches,
        reason,
      });
    if (candidates.length === 0) {
      if (!isUnchanged) recordWrongEdge("unmodeled-handler");
      continue;
    }
    const isPredicted =
      isUnchanged ||
      beforeMatches.some((from) =>
        report.states[from]?.edges.some(
          (edge) =>
            candidates.some((candidate) => candidate.id === edge.transitionId) &&
            edge.targets.some((target) => afterMatches.includes(target)),
        ),
      );
    if (isPredicted) verdict.witnessedEdges++;
    else recordWrongEdge("unpredicted-target");
  }

  verdict.witnessedStates = [...witnessedStates].sort((left, right) => left - right);
  verdict.branchSides = probes.length * 2;
  verdict.witnessedBranchSides = witnessedSides.size;
  verdict.refutedDeadClaims = report.deadBranches
    .filter((deadBranch) => {
      const probeId = getDecisionProbeId(analysis.file, deadBranch.decision);
      return probeId !== null && witnessedSides.has(`${probeId}:${deadBranch.side}`);
    })
    .map((deadBranch) => {
      const { loc } = deadBranch.decision;
      return typeof loc === "symbol"
        ? deadBranch.description
        : `${deadBranch.description} (line ${loc.line})`;
    });
  return verdict;
};

export const countWrongClaims = (verdict: ComponentVerdict): number =>
  verdict.wrongStates.length +
  verdict.wrongEdges.length +
  verdict.wrongValues.length +
  verdict.refutedDeadClaims.length;

export const sum = <Item>(items: Item[], getValue: (item: Item) => number): number =>
  items.reduce((total, item) => total + getValue(item), 0);

export const summarizeVerdicts = (
  verdicts: ComponentVerdict[],
  durationMs: number,
): VerificationSummary => {
  const verified = verdicts.filter((verdict) => verdict.status === "verified");
  const mountFailed = verdicts.filter((verdict) => verdict.status === "mount-failed");
  const mountErrors: Record<string, number> = {};
  for (const verdict of mountFailed) {
    const message = (verdict.error ?? "unknown").replace(/\d+/g, "N").slice(0, MOUNT_ERROR_LENGTH);
    mountErrors[message] = (mountErrors[message] ?? 0) + 1;
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
    mountErrors,
    durationMs,
  };
};
