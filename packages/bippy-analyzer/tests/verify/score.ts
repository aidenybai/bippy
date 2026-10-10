import type { ComponentModel, RenderNode, Sample, Slot } from "../../src/symbolic-tree/model.ts";
import type { StateReport } from "../../src/symbolic-tree/states.ts";
import type { Observation } from "./driver.ts";
import {
  findClosest,
  formatShapes,
  matchesExpected,
  normalizeShapes,
  toExpected,
} from "./match.ts";
import type { Probe } from "./server.ts";
import type { Capture } from "./types.ts";

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
  atom: string;
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
const ORDERED_HOOK_NAMES = new Set([
  "useState",
  "useReducer",
  "useRef",
  "useMemo",
  "useCallback",
  "useContext",
]);
const LITERAL_CASE_PATTERN = /^(".*"|-?\d+(\.\d+)?|true|false|null|undefined)$/;

export const getProbeId = (file: string, start: number): string => `${file}:${start}`;

export const collectProbes = (model: ComponentModel): Probe[] => {
  const probes: Probe[] = [];
  const visit = (node: RenderNode): void => {
    if (node.kind === "branch") {
      if (node.probe !== "none")
        probes.push({
          id: getProbeId(model.file, node.span.start),
          file: model.file,
          start: node.span.start,
          end: node.span.end,
          mode: node.probe,
        });
      visit(node.whenTrue);
      visit(node.whenFalse);
    }
    if (node.kind === "element") for (const child of node.children) visit(child);
    if (node.kind === "list") visit(node.item);
  };
  visit(model.render);
  return probes;
};

const getStaticText = (node: RenderNode): string | null => {
  if (node.kind === "text") return node.text;
  if (node.kind === "empty") return "";
  if (node.kind === "element") {
    const parts = node.children.map(getStaticText);
    return parts.every((part) => part !== null)
      ? parts.join(" ").replace(/\s+/g, " ").trim()
      : null;
  }
  return null;
};

const collectTriggerLabels = (node: RenderNode, labels: Map<string, TriggerLabel>): void => {
  if (node.kind === "element") {
    for (const attribute of node.attributes) {
      if (attribute.transitionId) {
        labels.set(attribute.transitionId, {
          tag: node.tag,
          text: getStaticText(node),
          event: attribute.name,
        });
      }
    }
    for (const child of node.children) collectTriggerLabels(child, labels);
  }
  if (node.kind === "branch") {
    collectTriggerLabels(node.whenTrue, labels);
    collectTriggerLabels(node.whenFalse, labels);
  }
  if (node.kind === "list") collectTriggerLabels(node.item, labels);
};

const getStateSlots = (model: ComponentModel): Slot[] | null => {
  const hookSlots = model.slots.filter((slot) => slot.source !== "prop" && slot.source !== "item");
  if (hookSlots.some((slot) => !slot.hookName || !ORDERED_HOOK_NAMES.has(slot.hookName)))
    return null;
  return model.slots.filter((slot) => slot.source === "state" || slot.source === "reducer");
};

const readPath = (value: unknown, path: string[]): unknown =>
  path.reduce<unknown>(
    (current, segment) =>
      current && typeof current === "object" ? Reflect.get(current, segment) : undefined,
    value,
  );

const toCaseText = (value: unknown): string =>
  value === undefined ? "undefined" : JSON.stringify(value);

export const scoreComponent = (
  model: ComponentModel,
  report: StateReport,
  observations: Observation[],
  knownComponents: Map<string, string>,
): ComponentVerdict => {
  const verdict: ComponentVerdict = {
    name: model.name,
    file: model.file,
    status: model.exportName ? "verified" : "not-exported",
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
  if (!model.exportName) return verdict;

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
  const triggerLabels = new Map<string, TriggerLabel>();
  collectTriggerLabels(model.render, triggerLabels);
  const stateSlots = getStateSlots(model);
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

  const probes = collectProbes(model);
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

    if (stateSlots) {
      for (const [atomKey, predicted] of report.initial) {
        const [slotName = "", ...fieldPath] = atomKey.split(".");
        const slotIndex = stateSlots.findIndex((slot) => slot.name === slotName);
        if (slotIndex === -1 || !predicted.every((caseText) => LITERAL_CASE_PATTERN.test(caseText)))
          continue;
        const value = toCaseText(readPath(after.hookStates[slotIndex], fieldPath));
        if (!predicted.includes(value) && verdict.wrongValues.length < MAX_RECORDED_FAILURES) {
          verdict.wrongValues.push({ path, atom: atomKey, value, predicted });
        }
      }
    }

    if (!action || !before || before.error) continue;
    const beforeMatches = getMatches(before);
    if (beforeMatches.length === 0 || afterMatches.length === 0) continue;
    const eventName = action.kind === "click" ? "onClick" : "onChange";
    const candidates = model.transitions.filter((transition) => {
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
    .filter((deadBranch) =>
      witnessedSides.has(`${getProbeId(model.file, deadBranch.span.start)}:${deadBranch.side}`),
    )
    .map((deadBranch) => `${deadBranch.text} (line ${deadBranch.span.line})`);
  return verdict;
};
