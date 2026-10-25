import { getBounds } from "./constraints";
import type { Bound, Constraints } from "./constraints";
import type {
  AbstractValue,
  Binding,
  Handler,
  NumberRange,
  StateUpdate,
  SymbolicValue,
} from "./types";
import { forEachSymbolicValue } from "./utils/for-each-symbolic-value";
import { getBindingPlace } from "./utils/get-binding-place";
import { getTestExpression } from "./utils/get-test-expression";
import { isWholeBinding } from "./utils/is-whole-binding";
import { negate } from "./utils/negate";

interface Interval {
  min: number;
  max: number;
}

interface GuardedUpdate {
  update: StateUpdate;
  guards: SymbolicValue[];
}

interface ReachableInterval {
  interval: Interval;
  isInteger: boolean;
}

const MAX_ROUNDS = 8;

const MAX_INTEGER_CASES = 16;

const EXTREMES = new Map<string, (...values: number[]) => number>([
  ["Math.min", Math.min],
  ["Math.max", Math.max],
]);

const union = (left: Interval, right: Interval): Interval => ({
  min: Math.min(left.min, right.min),
  max: Math.max(left.max, right.max),
});

const isSame = (left: Interval, right: Interval): boolean =>
  left.min === right.min && left.max === right.max;

const getNumber = (value: SymbolicValue): number | null =>
  value.kind === "Primitive" && typeof value.value === "number" && Number.isFinite(value.value)
    ? value.value
    : null;

const getGuardedUpdates = (binding: Binding, handlers: Handler[]): GuardedUpdate[] =>
  handlers.flatMap((handler) =>
    handler.updates
      .filter((update) => update.binding.id === binding.id)
      .map((update) => ({ update, guards: [...handler.guards, ...update.guards] })),
  );

const isIntegerOnly = (updates: GuardedUpdate[]): boolean => {
  let isInteger = true;
  for (const { update } of updates)
    forEachSymbolicValue(update.value, (part) => {
      const literal = getNumber(part);
      if (literal !== null && !Number.isInteger(literal)) isInteger = false;
      if (part.kind === "BinaryExpression" && part.operator === "/") isInteger = false;
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

const getExcludedLiteral = (
  condition: SymbolicValue,
  binding: Binding,
  isNegated: boolean,
): number | null => {
  if (condition.kind !== "BinaryExpression") return null;
  const excludes = isNegated
    ? condition.operator === "===" || condition.operator === "=="
    : condition.operator === "!==" || condition.operator === "!=";
  if (!excludes) return null;
  if (isWholeBinding(condition.left, binding)) return getNumber(condition.right);
  return isWholeBinding(condition.right, binding) ? getNumber(condition.left) : null;
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
    const excluded = isInteger ? getExcludedLiteral(condition, binding, isNegated) : null;
    if (excluded !== null && excluded === tightened.min)
      tightened = { ...tightened, min: excluded + 1 };
    if (excluded !== null && excluded === tightened.max)
      tightened = { ...tightened, max: excluded - 1 };
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
  const derived =
    value.kind === "Binding" && value.path.length === 0 ? value.binding.derived : null;
  const extreme = derived && "callee" in derived ? EXTREMES.get(derived.callee) : undefined;
  if (derived && "callee" in derived && extreme && derived.operands.length > 0) {
    const operands = derived.operands.map((operand) =>
      getValueInterval(operand, binding, hypothesis, guards, isInteger),
    );
    if (operands.some((operand) => operand === null)) return null;
    const intervals = operands.filter((operand): operand is Interval => operand !== null);
    return {
      min: extreme(...intervals.map((interval) => interval.min)),
      max: extreme(...intervals.map((interval) => interval.max)),
    };
  }
  if (value.kind === "BinaryExpression" && (value.operator === "+" || value.operator === "-")) {
    const offset = getNumber(value.right);
    const term =
      offset === null || getNumber(value.left) !== null
        ? null
        : getValueInterval(value.left, binding, hypothesis, guards, isInteger);
    if (!term || offset === null || Math.abs(offset) > Number.MAX_SAFE_INTEGER) return null;
    const sign = value.operator === "+" ? 1 : -1;
    return { min: term.min + sign * offset, max: term.max + sign * offset };
  }
  if (value.kind === "BinaryExpression" && (value.operator === "*" || value.operator === "/")) {
    const factor = getNumber(value.right);
    const term =
      factor === null || factor === 0 || getNumber(value.left) !== null
        ? null
        : getValueInterval(value.left, binding, hypothesis, guards, isInteger);
    if (!term || factor === null) return null;
    const scale = value.operator === "*" ? factor : 1 / factor;
    const ends = [term.min * scale, term.max * scale];
    return { min: Math.min(...ends), max: Math.max(...ends) };
  }
  if (value.kind === "BinaryExpression" && value.operator === "%") {
    const divisor = getNumber(value.right);
    const term =
      divisor === null || divisor === 0
        ? null
        : getValueInterval(value.left, binding, hypothesis, guards, isInteger);
    if (!term || divisor === null) return null;
    const limit =
      isInteger && Number.isInteger(divisor) ? Math.abs(divisor) - 1 : Math.abs(divisor);
    return {
      min: term.min >= 0 ? 0 : Math.max(term.min, -limit),
      max: term.max <= 0 ? 0 : Math.min(term.max, limit),
    };
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

const getValuesInterval = (values: AbstractValue[] | undefined): Interval => {
  const numbers = (values ?? []).flatMap((value) =>
    value.kind === "Literal" && typeof value.value === "number" && Number.isFinite(value.value)
      ? [value.value]
      : [],
  );
  return numbers.length > 0 && numbers.length === values?.length
    ? { min: Math.min(...numbers), max: Math.max(...numbers) }
    : { min: -Infinity, max: Infinity };
};

const getSourceInterval = (constraints: Constraints, binding: Binding): Interval =>
  constraints.bounds.reduce<Interval>(
    (interval, bound) => {
      const limit = getBoundLimit(bound, binding, false);
      return {
        min: Math.max(interval.min, limit.min ?? interval.min),
        max: Math.min(interval.max, limit.max ?? interval.max),
      };
    },
    getValuesInterval(constraints.possibleValues.get(getBindingPlace(binding))),
  );

export const getIntervalBounds = (update: StateUpdate, constraints: Constraints): Bound[] => {
  const { binding, value } = update;
  const { initial } = binding;
  const isNumber = initial?.kind === "Primitive" && typeof initial.value === "number";
  if (!isNumber || update.isRepeated || getNumber(value) !== null) return [];
  const source = getSourceInterval(constraints, binding);
  const next = getValueInterval(value, binding, source, update.guards, false);
  if (!next) return [];
  const atom = getBindingPlace(binding);
  const atMost: Bound[] = Number.isFinite(next.max)
    ? [{ left: atom, right: null, maxDifference: next.max, isStrict: false }]
    : [];
  const atLeast: Bound[] = Number.isFinite(next.min)
    ? [{ left: null, right: atom, maxDifference: -next.min, isStrict: false }]
    : [];
  return [...atMost, ...atLeast];
};

const widen = (previous: Interval, next: Interval): Interval => ({
  min: next.min < previous.min ? -Infinity : next.min,
  max: next.max > previous.max ? Infinity : next.max,
});

const getReachableInterval = (binding: Binding, handlers: Handler[]): ReachableInterval | null => {
  const initial = binding.initial ? getNumber(binding.initial) : null;
  if (initial === null) return null;
  const updates = getGuardedUpdates(binding, handlers);
  const isInteger = Number.isInteger(initial) && isIntegerOnly(updates);
  let hypothesis: Interval = { min: initial, max: initial };
  for (let round = 0; round <= MAX_ROUNDS + 1; round++) {
    let next = hypothesis;
    for (const { update, guards } of updates) {
      const interval = getValueInterval(update.value, binding, hypothesis, guards, isInteger);
      if (!interval) return null;
      next = union(next, interval);
    }
    if (isSame(next, hypothesis)) return { interval: next, isInteger };
    hypothesis = round < MAX_ROUNDS ? next : widen(hypothesis, next);
  }
  return null;
};

export const getReachableRange = (binding: Binding, handlers: Handler[]): NumberRange | null => {
  const reachable = getReachableInterval(binding, handlers);
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
  handlers: Handler[],
): AbstractValue[] | null => {
  const reachable = getReachableInterval(binding, handlers);
  if (!reachable?.isInteger) return null;
  const { min, max } = reachable.interval;
  if (!Number.isFinite(min) || !Number.isFinite(max) || max - min >= MAX_INTEGER_CASES) return null;
  return Array.from({ length: max - min + 1 }, (_, offset): AbstractValue => ({
    kind: "Literal",
    value: min + offset,
  }));
};
