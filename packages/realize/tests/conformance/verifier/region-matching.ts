import type {
  AbstractValue,
  Binding,
  BindingKind,
  ComponentAnalysis,
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
