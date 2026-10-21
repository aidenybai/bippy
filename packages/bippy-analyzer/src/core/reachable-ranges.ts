import { getBounds } from "./constraints";
import type { Bound } from "./constraints";
import type { AbstractValue, Binding, NumberRange, StateUpdate, SymbolicValue } from "./types";
import { forEachSymbolicValue } from "./utils/for-each-symbolic-value";
import { getTestExpression } from "./utils/get-test-expression";
import { isWholeBinding } from "./utils/is-whole-binding";
import { negate } from "./utils/negate";

interface Interval {
  min: number;
  max: number;
}

const MAX_ROUNDS = 8;

const MAX_INTEGER_CASES = 16;

const union = (left: Interval, right: Interval): Interval => ({
  min: Math.min(left.min, right.min),
  max: Math.max(left.max, right.max),
});

const isSame = (left: Interval, right: Interval): boolean =>
  left.min === right.min && left.max === right.max;

const getNumber = (value: SymbolicValue): number | null =>
  value.kind === "Primitive" && typeof value.value === "number" ? value.value : null;

const isIntegerOnly = (binding: Binding, updates: StateUpdate[]): boolean => {
  let isInteger = true;
  for (const update of updates)
    forEachSymbolicValue(update.value, (part) => {
      const literal = getNumber(part);
      if (literal !== null && !Number.isInteger(literal)) isInteger = false;
    });
  return isInteger;
};

const getBoundLimit = (bound: Bound, binding: Binding, isInteger: boolean): Partial<Interval> => {
  const strictness = bound.isStrict && isInteger ? 1 : 0;
  const isBindingAtom = (atom: Bound["left"]): boolean =>
    atom !== null && atom.bindingId === binding.id && atom.path.length === 0;
  if (isBindingAtom(bound.left) && bound.right === null)
    return { max: bound.maxDifference - strictness };
  if (isBindingAtom(bound.right) && bound.left === null)
    return { min: -bound.maxDifference + strictness };
  return {};
};

const tighten = (
  interval: Interval,
  binding: Binding,
  guards: SymbolicValue[],
  isInteger: boolean,
): Interval => {
  let tightened = interval;
  for (const guard of guards) {
    const isNegated = guard.kind === "UnaryExpression" && guard.operator === "!";
    const condition = isNegated ? guard.value : guard;
    for (const bound of getBounds(condition, !isNegated) ?? []) {
      const limit = getBoundLimit(bound, binding, isInteger);
      tightened = {
        min: Math.max(tightened.min, limit.min ?? tightened.min),
        max: Math.min(tightened.max, limit.max ?? tightened.max),
      };
    }
  }
  return tightened;
};

const clamp = (range: NumberRange, inner: Interval): Interval => ({
  min: Math.max(Math.min(inner.min, range.max ?? Infinity), range.min ?? -Infinity),
  max: Math.min(Math.max(inner.max, range.min ?? -Infinity), range.max ?? Infinity),
});

const getValueInterval = (
  value: SymbolicValue,
  binding: Binding,
  hypothesis: Interval,
  guards: SymbolicValue[],
  isInteger: boolean,
): Interval | null => {
  const literal = getNumber(value);
  if (literal !== null) return { min: literal, max: literal };
  if (isWholeBinding(value, binding)) return tighten(hypothesis, binding, guards, isInteger);
  if (value.kind === "Binding" && value.binding.range?.inner)
    return clamp(
      value.binding.range,
      getValueInterval(value.binding.range.inner, binding, hypothesis, guards, isInteger) ?? {
        min: -Infinity,
        max: Infinity,
      },
    );
  if (value.kind === "BinaryExpression" && (value.operator === "+" || value.operator === "-")) {
    const offset = getNumber(value.right);
    const term =
      offset === null || getNumber(value.left) !== null
        ? null
        : getValueInterval(value.left, binding, hypothesis, guards, isInteger);
    if (!term || offset === null) return null;
    const sign = value.operator === "+" ? 1 : -1;
    return { min: term.min + sign * offset, max: term.max + sign * offset };
  }
  if (value.kind === "Conditional") {
    const test = getTestExpression(value);
    const consequent = getValueInterval(
      value.consequent,
      binding,
      hypothesis,
      [...guards, test],
      isInteger,
    );
    const alternate = getValueInterval(
      value.alternate,
      binding,
      hypothesis,
      [...guards, negate(test)],
      isInteger,
    );
    return consequent && alternate ? union(consequent, alternate) : null;
  }
  return null;
};

interface ReachableInterval {
  interval: Interval;
  isInteger: boolean;
}

const widen = (previous: Interval, next: Interval): Interval => ({
  min: next.min < previous.min ? -Infinity : next.min,
  max: next.max > previous.max ? Infinity : next.max,
});

const getReachableInterval = (
  binding: Binding,
  updates: StateUpdate[],
): ReachableInterval | null => {
  const initial = binding.initial ? getNumber(binding.initial) : null;
  if (initial === null) return null;
  const isInteger = Number.isInteger(initial) && isIntegerOnly(binding, updates);
  let hypothesis: Interval = { min: initial, max: initial };
  for (let round = 0; round <= MAX_ROUNDS + 1; round++) {
    let next = hypothesis;
    for (const update of updates) {
      const interval = getValueInterval(
        update.value,
        binding,
        hypothesis,
        update.guards,
        isInteger,
      );
      if (!interval) return null;
      next = union(next, interval);
    }
    if (isSame(next, hypothesis)) return { interval: next, isInteger };
    hypothesis = round < MAX_ROUNDS ? next : widen(hypothesis, next);
  }
  return null;
};

export const getReachableRange = (binding: Binding, updates: StateUpdate[]): NumberRange | null => {
  const reachable = getReachableInterval(binding, updates);
  if (!reachable) return null;
  const { min, max } = reachable.interval;
  if (!Number.isFinite(min) && !Number.isFinite(max)) return null;
  return {
    min: Number.isFinite(min) ? min : null,
    max: Number.isFinite(max) ? max : null,
    inner: null,
  };
};

export const getReachableIntegers = (
  binding: Binding,
  updates: StateUpdate[],
): AbstractValue[] | null => {
  const reachable = getReachableInterval(binding, updates);
  if (!reachable?.isInteger) return null;
  const { min, max } = reachable.interval;
  if (!Number.isFinite(min) || !Number.isFinite(max) || max - min >= MAX_INTEGER_CASES) return null;
  return Array.from({ length: max - min + 1 }, (_, offset): AbstractValue => ({
    kind: "Literal",
    value: min + offset,
  }));
};
