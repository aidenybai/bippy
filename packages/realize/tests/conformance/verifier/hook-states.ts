import type { Binding, BindingKind, ComponentAnalysis } from "../../../src/core/types";
import { isStateBinding } from "../../../src/core/values/is-state-binding";
import type { Observation } from "./driver";
import { TRUNCATED_VALUE } from "./types";

export const MISSING_PLACE = Symbol("missing place");

const NON_HOOK_BINDING_KINDS = new Set<BindingKind>(["prop", "item", "call", "loop", "suspense"]);

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
  const stateBindings = analysis.bindings.filter(
    (binding) => isStateBinding(binding) && binding.kind !== "memo",
  );
  const isEveryQueueAState = observations.every(
    (observation) =>
      observation.after.error !== null ||
      observation.after.stateValues.length === stateBindings.length,
  );
  return isEveryQueueAState ? stateBindings : null;
};

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
  value === undefined || typeof value === "number" ? String(value) : JSON.stringify(value);
