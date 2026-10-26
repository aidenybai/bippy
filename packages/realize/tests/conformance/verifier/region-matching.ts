import type {
  AbstractValue,
  Binding,
  BindingKind,
  ComponentAnalysis,
  Region,
} from "../../../src/core/types";
import { isStateBinding } from "../../../src/core/utils/is-state-binding";
import type { Observation } from "./driver";
import { matchesExpected, normalizeShapes } from "./match";
import { TRUNCATED_VALUE } from "./types";
import type { Shape } from "./types";
import type { ScoringContext } from "./score";

export const MISSING_PLACE = Symbol("missing place");

const NON_HOOK_BINDING_KINDS = new Set<BindingKind>(["prop", "item", "call", "loop", "suspense"]);

export const EXTERNAL_DATA_BINDING_KINDS = new Set<BindingKind>([
  "hook",
  "context",
  "call",
  "suspense",
]);

const ORDERED_HOOK_KINDS = new Set<string>([
  "useState",
  "useReducer",
  "useRef",
  "useMemo",
  "useCallback",
  "useContext",
]);

export const getStateBindings = (
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

export const isPredictedValue = (value: unknown, predicted: AbstractValue[]): boolean =>
  predicted.some((candidate) => candidate.kind === "Literal" && Object.is(candidate.value, value));

export const readPath = (value: unknown, path: string[]): unknown => {
  let current = value;
  for (const segment of path) {
    if (current === TRUNCATED_VALUE) return current;
    if (!current || typeof current !== "object") return MISSING_PLACE;
    current = Reflect.get(current, segment);
  }
  return current;
};

export const formatRuntimeValue = (value: unknown): string =>
  value === undefined ? "undefined" : JSON.stringify(value);

export const getMatchedStates = (context: ScoringContext, capturedShapes: Shape[]): number[] => {
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

export const getStatesInRegion = (
  context: ScoringContext,
  stateIndices: number[],
  regionIndex: number,
): number[] =>
  stateIndices.filter(
    (stateIndex) => context.report.states[stateIndex]?.regionIndex === regionIndex,
  );

const isRegionMatched = (
  context: ScoringContext,
  matchedStates: number[],
  regionIndex: number,
): boolean => getStatesInRegion(context, matchedStates, regionIndex).length > 0;

export const isEveryRegionMatched = (context: ScoringContext, matchedStates: number[]): boolean =>
  getRegionIndices(context).every((regionIndex) =>
    isRegionMatched(context, matchedStates, regionIndex),
  );

export const getRegionsMatchedOnBothSides = (
  context: ScoringContext,
  beforeStates: number[],
  afterStates: number[],
): number[] =>
  getRegionIndices(context).filter(
    (regionIndex) =>
      isRegionMatched(context, beforeStates, regionIndex) &&
      isRegionMatched(context, afterStates, regionIndex),
  );

export const isRegionUnchanged = (
  context: ScoringContext,
  beforeStates: number[],
  afterStates: number[],
  regionIndex: number,
): boolean =>
  getStatesInRegion(context, beforeStates, regionIndex).some((stateIndex) =>
    afterStates.includes(stateIndex),
  );

export const isExternalRegion = (context: ScoringContext, regionIndex: number): boolean =>
  context.report.regions[regionIndex]?.bindingIds.some((bindingId) =>
    context.externalBindingIds.has(bindingId),
  ) ?? false;

export type RegionData = "local" | "store" | "external";

const DATA_ORDER: RegionData[] = ["local", "store", "external"];

const combineData = (kinds: RegionData[]): RegionData =>
  kinds.reduce<RegionData>(
    (combined, kind) => (DATA_ORDER.indexOf(kind) > DATA_ORDER.indexOf(combined) ? kind : combined),
    "local",
  );

const getBindingData = (
  binding: Binding,
  bindingsById: Map<number, Binding>,
  visitedIds: Set<number>,
): RegionData => {
  if (binding.kind === "module") return "store";
  if (binding.kind === "hook")
    return binding.hookKind === "Custom" && binding.initial !== null ? "store" : "external";
  if (binding.kind === "context" || binding.kind === "suspense") return "external";
  if (binding.kind !== "call") return "local";
  if (binding.inputPlaces.length === 0 || visitedIds.has(binding.id)) return "external";
  visitedIds.add(binding.id);
  return combineData(
    binding.inputPlaces.map(({ bindingId }) => {
      const input = bindingsById.get(bindingId);
      return input ? getBindingData(input, bindingsById, visitedIds) : "external";
    }),
  );
};

export const getRegionData = (analysis: ComponentAnalysis, region: Region): RegionData => {
  const bindingsById = new Map(analysis.bindings.map((binding) => [binding.id, binding]));
  return combineData(
    region.bindingIds.map((bindingId) => {
      const binding = bindingsById.get(bindingId);
      return binding ? getBindingData(binding, bindingsById, new Set()) : "external";
    }),
  );
};
