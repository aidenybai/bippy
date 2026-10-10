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
  toExpected,
} from "./match.js";
import type { Probe } from "./server.js";
import type { Capture } from "./types.js";

export type ComponentStatus = "verified" | "not-exported" | "mount-failed";

export interface WrongState {
  props: Record<string, Sample>;
  path: string[];
  rendered: string;
  closestState: number;
}

export interface WrongEdge {
  path: string[];
  action: string;
  fromStates: number[];
  toStates: number[];
  reason: "unpredicted-target" | "unmodeled-handler";
}

export interface WrongValue {
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

interface TriggerLabel {
  tag: string;
  text: string | null;
  event: string;
}

const MAX_RECORDED_FAILURES = 10;
const ORDERED_HOOK_KINDS = new Set<string>([
  "useState",
  "useReducer",
  "useRef",
  "useMemo",
  "useCallback",
  "useContext",
]);

export const getProbeId = (file: string, start: number): string => `${file}:${start}`;

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
      return parts.every((part) => part !== null)
        ? parts.join(" ").replace(/\s+/g, " ").trim()
        : null;
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
    (binding) => binding.kind !== "prop" && binding.kind !== "item",
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

  const firstMount = observations[0]?.after;
  if (
    observations.every(
      (observation) => observation.after.error && observation.after.shapes.length === 0,
    )
  ) {
    return {
      ...verdict,
      status: "mount-failed",
      error: firstMount?.error ?? "nothing was mounted",
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
      if (verdict.wrongStates.length < MAX_RECORDED_FAILURES) {
        const shapes = normalizeShapes(after.shapes);
        verdict.wrongStates.push({
          props: observation.props,
          path,
          rendered: formatShapes(shapes).slice(0, 300),
          closestState: findClosest(expectedStates, shapes),
        });
      }
    } else {
      for (const match of afterMatches) witnessedStates.add(match);
    }

    if (stateBindings) {
      stateBindings.forEach((binding, hookIndex) => {
        const placePrefix = `${binding.id}`;
        for (const [placeKey, predicted] of report.places) {
          const [bindingId = "", ...path] = placeKey.split(".");
          if (bindingId !== placePrefix || !predicted.every((value) => value.kind === "Literal"))
            continue;
          const value = readPath(after.hookStates[hookIndex], path);
          if (
            !isPredictedValue(value, predicted) &&
            verdict.wrongValues.length < MAX_RECORDED_FAILURES
          ) {
            verdict.wrongValues.push({
              path: observation.path,
              place: formatPlace(binding, path),
              value: formatRuntimeValue(value),
              predicted: predicted.map(formatAbstractValue),
            });
          }
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
    if (candidates.length === 0) {
      if (!isUnchanged && verdict.wrongEdges.length < MAX_RECORDED_FAILURES) {
        verdict.wrongEdges.push({
          path,
          action: action.key,
          fromStates: beforeMatches,
          toStates: afterMatches,
          reason: "unmodeled-handler",
        });
      }
      continue;
    }
    const isPredicted = beforeMatches.some(
      (from) =>
        report.states[from]?.edges.some(
          (edge) =>
            candidates.some((candidate) => candidate.id === edge.transitionId) &&
            edge.targets.some((target) => afterMatches.includes(target)),
        ) || isUnchanged,
    );
    if (isPredicted) verdict.witnessedEdges++;
    else if (verdict.wrongEdges.length < MAX_RECORDED_FAILURES) {
      verdict.wrongEdges.push({
        path,
        action: action.key,
        fromStates: beforeMatches,
        toStates: afterMatches,
        reason: "unpredicted-target",
      });
    }
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
