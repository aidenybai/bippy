import { isEffectHandler } from "../../../src/core/handlers/handler-predicates";
import { getValueLabels } from "../../../src/core/model/domains";
import { containsValue } from "../../../src/core/model/abstract";
import { and, inValues, or } from "../../../src/core/model/predicates";
import { exploreModel } from "../../../src/core/model/explore";
import type { StateGraph } from "../../../src/core/model/explore";
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
import {
  collectBranchCounters,
  getHandlerIdsByCounterId,
  getBranchId,
  getEdgeKey,
} from "./branch-counters";
import type { Observation } from "./driver";
import { MISSING_PLACE, formatRuntimeValue, getStateBindings, readPath } from "./hook-states";
import { checkWarnings } from "./mutation";
import { TRUNCATED_VALUE, getStateOrigin } from "./types";
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

const isSpontaneousHandler = (handler: Handler): boolean =>
  handler.trigger.kind === "Event"
    ? SPONTANEOUS_EVENTS.has(handler.trigger.event)
    : handler.trigger.kind === "Effect" && handler.trigger.hookKind === "Custom";

interface Edge {
  predicate: Predicate;
  description: string;
  isReachable: boolean | null;
}

interface StateVariable {
  variable: Variable;
  hookIndex: number;
}

interface DomainViolation {
  variable: string;
  value: string;
  domain: string[];
}

interface ModelIndex {
  model: ComponentModel;
  explored: StateGraph;
  edges: Map<string, Edge>;
  stateVariables: StateVariable[];
  variablesByName: Map<string, Variable>;
}

interface AbstractState {
  predicate: Predicate;
  edges: string[];
  values: string[];
  domainViolations: DomainViolation[];
}

const combineReachability = (left: boolean | null, right: boolean | null): boolean | null => {
  if (left === true || right === true) return true;
  return left === null || right === null ? null : false;
};

const collectEdges = (model: ComponentModel): Map<string, Edge> => {
  const edges = new Map<string, Edge>();
  for (const branch of model.branches) {
    if (branch.loc === GeneratedSource) continue;
    const counterId = getBranchId(branch.file, branch.loc);
    for (const isConsequent of [true, false]) {
      const edge = isConsequent ? branch.consequent : branch.alternate;
      const key = getEdgeKey(counterId, isConsequent);
      const existing = edges.get(key);
      edges.set(key, {
        predicate: existing ? or([existing.predicate, edge.predicate]) : edge.predicate,
        description: `${branch.label} is ${isConsequent ? "true" : "false"} ${formatLine(branch.loc)}`,
        isReachable: existing
          ? combineReachability(existing.isReachable, edge.isReachable)
          : edge.isReachable,
      });
    }
  }
  return edges;
};

const collectStateVariables = (
  analysis: ComponentAnalysis,
  model: ComponentModel,
  observations: Observation[],
): StateVariable[] => {
  const stateBindings = getStateBindings(analysis, observations) ?? [];
  const mutatedOrigins = new Set(
    observations.flatMap((observation) => observation.after.mutatedOrigins),
  );
  return model.variables.flatMap((variable) => {
    if (variable.source !== "state") return [];
    const hookIndex = stateBindings.findIndex((binding) => binding.id === variable.bindingId);
    return hookIndex === -1 || mutatedOrigins.has(getStateOrigin(hookIndex))
      ? []
      : [{ variable, hookIndex }];
  });
};

export const indexModel = (
  analysis: ComponentAnalysis,
  model: ComponentModel,
  observations: Observation[],
): ModelIndex => ({
  model,
  explored: exploreModel(model.variables, model.actions, model.views),
  edges: collectEdges(model),
  stateVariables: collectStateVariables(analysis, model, observations),
  variablesByName: new Map(model.variables.map((variable) => [variable.name, variable])),
});

const getTakenEdgeKeys = (modelIndex: ModelIndex, capture: Capture): string[] => {
  const edgesByCounter = new Map<string, Set<boolean>>();
  for (const hit of capture.branchHits) {
    const edges = edgesByCounter.get(hit.id) ?? new Set<boolean>();
    edges.add(hit.isConsequent);
    edgesByCounter.set(hit.id, edges);
  }
  return [...edgesByCounter].flatMap(([counterId, edges]) => {
    const [isConsequent] = edges;
    const key = getEdgeKey(counterId, isConsequent ?? true);
    return edges.size === 1 && modelIndex.edges.has(key) ? [key] : [];
  });
};

export const abstractCapture = (modelIndex: ModelIndex, capture: Capture): AbstractState => {
  const edgeKeys = getTakenEdgeKeys(modelIndex, capture);
  const values: string[] = [];
  const domainViolations: DomainViolation[] = [];
  const valuePredicates: Predicate[] = [];
  for (const stateVariable of modelIndex.stateVariables) {
    const variable = stateVariable.variable;
    const value = readPath(capture.stateValues[stateVariable.hookIndex], variable.path);
    if (OPAQUE_VALUES.has(value)) continue;
    const domain = getValueLabels(variable.domain);
    const containingValues = getValueLabels(
      variable.domain.filter((candidate) => containsValue(candidate.abstract, value)),
    );
    values.push(`${variable.label} = ${formatRuntimeValue(value)}`);
    if (containingValues.length === 0)
      domainViolations.push({ variable: variable.label, value: formatRuntimeValue(value), domain });
    else valuePredicates.push(inValues(variable.name, containingValues, domain));
  }
  return {
    predicate: and([
      ...edgeKeys.flatMap((key) => modelIndex.edges.get(key)?.predicate ?? []),
      ...valuePredicates,
    ]),
    edges: edgeKeys.flatMap((key) => modelIndex.edges.get(key)?.description ?? []),
    values,
    domainViolations,
  };
};

export const canShowView = (modelIndex: ModelIndex, observed: AbstractState, view: View): boolean =>
  modelIndex.explored.findTrace(and([observed.predicate, view.predicate])) !== null;

const isPropInput = (modelIndex: ModelIndex, action: Action): boolean =>
  action.writes.some(
    (write) => modelIndex.variablesByName.get(write.variable)?.bindingKind === "prop",
  );

const createActionFilter =
  (modelIndex: ModelIndex, handlerIds: Set<string>, backgroundIds: Set<string>) =>
  (action: Action, taken: Action[]): boolean => {
    if (action.phase === "input") return !isPropInput(modelIndex, action);
    if (action.phase === "fulfilled" || action.phase === "rejected") return true;
    if (action.handlerId === null) return false;
    if (backgroundIds.has(action.handlerId)) return true;
    return handlerIds.has(action.handlerId) && !taken.includes(action);
  };

class ComponentCheck {
  readonly #modelIndex: ModelIndex;
  readonly #verdict: ComponentVerdict;
  readonly #handlerIdsByCounterId: Map<string, string[]>;
  readonly #backgroundIds: Set<string>;
  readonly #coveredViews = new Set<string>();
  readonly #seenKeys = new Set<string>();

  constructor(analysis: ComponentAnalysis, modelIndex: ModelIndex, verdict: ComponentVerdict) {
    this.#modelIndex = modelIndex;
    this.#verdict = verdict;
    this.#handlerIdsByCounterId = getHandlerIdsByCounterId(analysis);
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

  checkRender(observation: Observation, observed: AbstractState): void {
    for (const violation of observed.domainViolations)
      if (this.#isFirstSeen(JSON.stringify(["value", violation])))
        this.#verdict.domainCounterexamples.push({ path: observation.path, ...violation });
    if (observed.domainViolations.length > 0) return;
    const trace = this.#modelIndex.explored.findTrace(observed.predicate);
    if (trace) {
      for (const view of this.#modelIndex.model.views)
        if (!this.#coveredViews.has(view.label) && canShowView(this.#modelIndex, observed, view))
          this.#coveredViews.add(view.label);
      return;
    }
    if (this.#isFirstSeen(JSON.stringify(["render", observed.edges, observed.values])))
      this.#verdict.renderCounterexamples.push({
        props: observation.props,
        path: observation.path,
        edges: observed.edges,
        values: observed.values,
      });
  }

  checkTransition(observation: Observation, after: AbstractState): void {
    if (!observation.action || !observation.before || observation.before.error) return;
    const handlerIds = new Set(
      observation.after.handlerCalls.flatMap(
        (counterId) => this.#handlerIdsByCounterId.get(counterId) ?? [],
      ),
    );
    if (handlerIds.size === 0) return;
    const beforeObserved = abstractCapture(this.#modelIndex, observation.before);
    if (beforeObserved.domainViolations.length > 0 || after.domainViolations.length > 0) return;
    this.#verdict.checkedTransitionCount++;
    const isStutter =
      !this.#modelIndex.model.actions.some(
        (action) => action.handlerId !== null && handlerIds.has(action.handlerId),
      ) &&
      this.#modelIndex.explored.findTrace(and([beforeObserved.predicate, after.predicate])) !==
        null;
    if (isStutter) return;
    const isCovered = this.#modelIndex.explored.findTransition(
      beforeObserved.predicate,
      after.predicate,
      createActionFilter(this.#modelIndex, handlerIds, this.#backgroundIds),
    );
    if (isCovered !== false) return;
    const handlers = [...handlerIds].sort();
    if (
      this.#isFirstSeen(
        JSON.stringify([
          "transition",
          observation.action.label,
          handlers,
          beforeObserved.edges,
          after.edges,
        ]),
      )
    )
      this.#verdict.transitionCounterexamples.push({
        path: observation.path,
        action: observation.action.label,
        handlers,
      });
  }
}

export const checkComponent = (
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
  const modelIndex = indexModel(analysis, model, observations);
  const score = new ComponentCheck(analysis, modelIndex, verdict);
  const counterIds = new Set(collectBranchCounters(analysis).map((counter) => counter.id));
  const coveredEdges = new Set<string>();
  for (const observation of observations) {
    for (const hit of observation.after.branchHits)
      if (counterIds.has(hit.id)) coveredEdges.add(getEdgeKey(hit.id, hit.isConsequent));
    if (observation.after.error) {
      verdict.renderErrorCount++;
      continue;
    }
    if (verdict.isTruncated) continue;
    const observed = abstractCapture(modelIndex, observation.after);
    score.checkRender(observation, observed);
    score.checkTransition(observation, observed);
  }
  verdict.coveredViews = score.coveredViews;
  verdict.branchEdgeCount = counterIds.size * 2;
  verdict.coveredBranchEdgeCount = coveredEdges.size;
  verdict.unreachableEdgesTaken = [...coveredEdges].flatMap((key) => {
    const edge = modelIndex.edges.get(key);
    return edge?.isReachable === false ? [edge.description] : [];
  });
  return {
    ...verdict,
    ...checkWarnings(analysis, observations, getStateBindings(analysis, observations)),
  };
};
