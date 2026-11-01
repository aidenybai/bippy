import { isEffectHandler } from "../../../src/core/handlers/handler-predicates";
import { getValueLabels } from "../../../src/core/model/domains";
import { containsValue } from "../../../src/core/model/abstract";
import { and, inValues, or } from "../../../src/core/model/predicates";
import { exploreModel } from "../../../src/core/model/explore";
import type { ExploredModel } from "../../../src/core/model/explore";
import type {
  Action,
  ComponentModel,
  Predicate,
  Variable,
  View,
} from "../../../src/core/model/types";
import type { ComponentAnalysis, Handler } from "../../../src/core/types";
import { formatLine } from "../../../src/core/values/format";
import { GeneratedSource } from "../../../src/react-compiler/HIR/HIR";
import { collectProbes, getHandlerIdsByProbeId, getProbeId, getSideKey } from "./branch-probes";
import type { Observation } from "./driver";
import { MISSING_PLACE, formatRuntimeValue, getStateBindings, readPath } from "./hook-states";
import { scoreWarnings } from "./mutation";
import { TRUNCATED_VALUE, getStateOwner } from "./types";
import type { Capture } from "./types";
import { createEmptyVerdict, getMountFailedVerdict } from "./verdicts";
import type { ComponentVerdict } from "./verdicts";

const OPAQUE_VALUES = new Set<unknown>([
  TRUNCATED_VALUE,
  MISSING_PLACE,
  "[function]",
  "[value]",
  "[node]",
]);

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

const isSpontaneousHandler = ({ trigger }: Handler): boolean =>
  trigger.kind === "Event"
    ? SPONTANEOUS_EVENTS.has(trigger.event)
    : trigger.kind === "Effect" && trigger.hookKind === "Custom";

interface Side {
  predicate: Predicate;
  description: string;
  isReachable: boolean | null;
}

interface StateVariable {
  variable: Variable;
  hookIndex: number;
}

interface Misfit {
  variable: string;
  value: string;
  domain: string[];
}

export interface Coverage {
  model: ComponentModel;
  explored: ExploredModel;
  sides: Map<string, Side>;
  stateVariables: StateVariable[];
  variablesByName: Map<string, Variable>;
}

export interface Observed {
  predicate: Predicate;
  sides: string[];
  values: string[];
  misfits: Misfit[];
}

const combineReachability = (left: boolean | null, right: boolean | null): boolean | null => {
  if (left === true || right === true) return true;
  return left === null || right === null ? null : false;
};

const collectSides = (model: ComponentModel): Map<string, Side> => {
  const sides = new Map<string, Side>();
  for (const branch of model.branches) {
    if (branch.loc === GeneratedSource) continue;
    const probeId = getProbeId(branch.file, branch.loc);
    for (const isTrueSide of [true, false]) {
      const edge = isTrueSide ? branch.consequent : branch.alternate;
      const key = getSideKey(probeId, isTrueSide);
      const existing = sides.get(key);
      sides.set(key, {
        predicate: existing ? or([existing.predicate, edge.predicate]) : edge.predicate,
        description: `${branch.test} is ${isTrueSide ? "true" : "false"} ${formatLine(branch.loc)}`,
        isReachable: existing
          ? combineReachability(existing.isReachable, edge.isReachable)
          : edge.isReachable,
      });
    }
  }
  return sides;
};

const collectStateVariables = (
  analysis: ComponentAnalysis,
  model: ComponentModel,
  observations: Observation[],
): StateVariable[] => {
  const stateBindings = getStateBindings(analysis, observations) ?? [];
  const mutatedOwners = new Set(observations.flatMap(({ after }) => after.mutatedOwners));
  return model.variables.flatMap((variable) => {
    if (variable.source !== "state") return [];
    const hookIndex = stateBindings.findIndex((binding) => binding.id === variable.bindingId);
    return hookIndex === -1 || mutatedOwners.has(getStateOwner(hookIndex))
      ? []
      : [{ variable, hookIndex }];
  });
};

export const createCoverage = (
  analysis: ComponentAnalysis,
  model: ComponentModel,
  observations: Observation[],
): Coverage => ({
  model,
  explored: exploreModel(model.variables, model.actions, model.views),
  sides: collectSides(model),
  stateVariables: collectStateVariables(analysis, model, observations),
  variablesByName: new Map(model.variables.map((variable) => [variable.name, variable])),
});

const getObservedSideKeys = (coverage: Coverage, capture: Capture): string[] => {
  const sidesByProbe = new Map<string, Set<boolean>>();
  for (const hit of capture.probes) {
    const sides = sidesByProbe.get(hit.id) ?? new Set<boolean>();
    sides.add(hit.isTrueSide);
    sidesByProbe.set(hit.id, sides);
  }
  return [...sidesByProbe].flatMap(([probeId, sides]) => {
    const [isTrueSide] = sides;
    const key = getSideKey(probeId, isTrueSide ?? true);
    return sides.size === 1 && coverage.sides.has(key) ? [key] : [];
  });
};

export const observe = (coverage: Coverage, capture: Capture): Observed => {
  const sideKeys = getObservedSideKeys(coverage, capture);
  const values: string[] = [];
  const misfits: Misfit[] = [];
  const valuePredicates: Predicate[] = [];
  for (const { variable, hookIndex } of coverage.stateVariables) {
    const value = readPath(capture.hookStates[hookIndex], variable.path);
    if (OPAQUE_VALUES.has(value)) continue;
    const domain = getValueLabels(variable.domain);
    const containingValues = getValueLabels(
      variable.domain.filter((candidate) => containsValue(candidate.abstract, value)),
    );
    values.push(`${variable.label} = ${formatRuntimeValue(value)}`);
    if (containingValues.length === 0)
      misfits.push({ variable: variable.label, value: formatRuntimeValue(value), domain });
    else valuePredicates.push(inValues(variable.name, containingValues, domain));
  }
  return {
    predicate: and([
      ...sideKeys.flatMap((key) => coverage.sides.get(key)?.predicate ?? []),
      ...valuePredicates,
    ]),
    sides: sideKeys.flatMap((key) => coverage.sides.get(key)?.description ?? []),
    values,
    misfits,
  };
};

export const isShowingView = (coverage: Coverage, observed: Observed, view: View): boolean =>
  coverage.explored.findTrace(and([observed.predicate, view.predicate])) !== null;

const isPropInput = (coverage: Coverage, action: Action): boolean =>
  action.writes.some(
    ({ variable }) => coverage.variablesByName.get(variable)?.bindingKind === "prop",
  );

const createActionFilter =
  (coverage: Coverage, handlerIds: Set<string>, backgroundIds: Set<string>) =>
  (action: Action, taken: Action[]): boolean => {
    if (action.phase === "input") return !isPropInput(coverage, action);
    if (action.phase === "resolves" || action.phase === "rejects") return true;
    if (action.handlerId === null) return false;
    if (backgroundIds.has(action.handlerId)) return true;
    return handlerIds.has(action.handlerId) && !taken.includes(action);
  };

class ComponentScore {
  readonly #coverage: Coverage;
  readonly #verdict: ComponentVerdict;
  readonly #handlerIdsByProbeId: Map<string, string[]>;
  readonly #backgroundIds: Set<string>;
  readonly #coveredViews = new Set<string>();
  readonly #seenKeys = new Set<string>();

  constructor(analysis: ComponentAnalysis, coverage: Coverage, verdict: ComponentVerdict) {
    this.#coverage = coverage;
    this.#verdict = verdict;
    this.#handlerIdsByProbeId = getHandlerIdsByProbeId(analysis);
    this.#backgroundIds = new Set(
      analysis.handlers
        .filter((handler) => isEffectHandler(handler) || isSpontaneousHandler(handler))
        .map((handler) => handler.id),
    );
  }

  get coveredViews(): string[] {
    return [...this.#coveredViews].sort();
  }

  #isFirstSeen(key: string): boolean {
    if (this.#seenKeys.has(key)) return false;
    this.#seenKeys.add(key);
    return true;
  }

  scoreRender(observation: Observation, observed: Observed): void {
    for (const misfit of observed.misfits)
      if (this.#isFirstSeen(JSON.stringify(["value", misfit])))
        this.#verdict.valueCounterexamples.push({ path: observation.path, ...misfit });
    if (observed.misfits.length > 0) return;
    const { model, explored } = this.#coverage;
    const witness = explored.findTrace(observed.predicate);
    if (witness) {
      for (const view of model.views)
        if (!this.#coveredViews.has(view.label) && isShowingView(this.#coverage, observed, view))
          this.#coveredViews.add(view.label);
      return;
    }
    if (this.#isFirstSeen(JSON.stringify(["render", observed.sides, observed.values])))
      this.#verdict.renderCounterexamples.push({
        props: observation.props,
        path: observation.path,
        sides: observed.sides,
        values: observed.values,
      });
  }

  scoreTransition(observation: Observation, after: Observed): void {
    const { action, before } = observation;
    if (!action || !before || before.error) return;
    const handlerIds = new Set(
      observation.after.handlerHits.flatMap(
        (probeId) => this.#handlerIdsByProbeId.get(probeId) ?? [],
      ),
    );
    if (handlerIds.size === 0) return;
    const beforeObserved = observe(this.#coverage, before);
    if (beforeObserved.misfits.length > 0 || after.misfits.length > 0) return;
    this.#verdict.checkedTransitionCount++;
    const isCovered = this.#coverage.explored.findTransition(
      beforeObserved.predicate,
      after.predicate,
      createActionFilter(this.#coverage, handlerIds, this.#backgroundIds),
    );
    if (isCovered !== false) return;
    const handlers = [...handlerIds].sort();
    if (
      this.#isFirstSeen(
        JSON.stringify(["transition", action.label, handlers, beforeObserved.sides, after.sides]),
      )
    )
      this.#verdict.transitionCounterexamples.push({
        path: observation.path,
        action: action.label,
        handlers,
      });
  }
}

export const scoreComponent = (
  analysis: ComponentAnalysis,
  model: ComponentModel,
  observations: Observation[],
): ComponentVerdict => {
  const verdict: ComponentVerdict = {
    ...createEmptyVerdict(analysis, model),
    observationCount: observations.length,
  };
  if (!analysis.exportName) return verdict;
  const mountFailedVerdict = getMountFailedVerdict(verdict, observations);
  if (mountFailedVerdict) return mountFailedVerdict;
  const coverage = createCoverage(analysis, model, observations);
  const score = new ComponentScore(analysis, coverage, verdict);
  const probeIds = new Set(collectProbes(analysis).map((probe) => probe.id));
  const coveredSides = new Set<string>();
  for (const observation of observations) {
    for (const hit of observation.after.probes)
      if (probeIds.has(hit.id)) coveredSides.add(getSideKey(hit.id, hit.isTrueSide));
    if (observation.after.error) {
      verdict.renderErrorCount++;
      continue;
    }
    if (verdict.isTruncated) continue;
    const observed = observe(coverage, observation.after);
    score.scoreRender(observation, observed);
    score.scoreTransition(observation, observed);
  }
  verdict.coveredViews = score.coveredViews;
  verdict.branchSideCount = probeIds.size * 2;
  verdict.coveredBranchSideCount = coveredSides.size;
  verdict.reachedUnreachableSides = [...coveredSides].flatMap((key) => {
    const side = coverage.sides.get(key);
    return side?.isReachable === false ? [side.description] : [];
  });
  return {
    ...verdict,
    ...scoreWarnings(analysis, observations, getStateBindings(analysis, observations)),
  };
};
