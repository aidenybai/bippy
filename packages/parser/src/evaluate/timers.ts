import type { StaticValue } from "../types.js";
import { primitiveValue, unknownPrimitiveValue } from "./values.js";

/**
 * Timers as the harness observes them. The runtime snapshot is captured once
 * React has been quiet for a while: short timeouts have fired, and a repeating
 * interval has either cleared itself or its ticks no longer change state.
 * Timer callbacks are queued as tasks and flushed between settle rounds of the
 * materialized mount, so the code following `setTimeout` (including the
 * assignment of the returned handle) runs first, as it does in the event loop.
 * An interval's ticks are evaluated at that quiescent point, where any clock
 * reading is later than every earlier reading by an unbounded amount, until
 * the interval clears itself or a tick changes nothing.
 */
export class TimerQueue {
  private tasks: (() => void)[] = [];
  private readonly clearedHandles = new WeakSet<StaticValue>();
  isClockSettled = false;
  isFlushing = false;

  createHandle(name: string): StaticValue {
    return unknownPrimitiveValue("number", `${name} handle`);
  }

  schedule(handle: StaticValue, task: () => void): void {
    this.tasks.push(() => {
      if (!this.clearedHandles.has(handle)) task();
    });
  }

  clear(handle: StaticValue | undefined): void {
    if (handle) this.clearedHandles.add(handle);
  }

  isCleared(handle: StaticValue): boolean {
    return this.clearedHandles.has(handle);
  }

  /** Runs the tasks queued so far; tasks they queue wait for the next round. */
  flush(): void {
    const tasks = this.tasks;
    this.tasks = [];
    this.isFlushing = true;
    try {
      for (const task of tasks) task();
    } finally {
      this.isFlushing = false;
    }
  }

  readClock(name: string): StaticValue {
    return {
      kind: "unknown-primitive",
      primitiveType: "number",
      reason: `${name}()`,
      clock: this.isClockSettled ? "settled" : "reading",
    };
  }
}

const UNBOUNDED_ELAPSED: StaticValue = {
  kind: "unknown-primitive",
  primitiveType: "number",
  reason: "time elapsed until the interval settled",
  clock: "unbounded",
};

const isUnbounded = (value: StaticValue): boolean =>
  value.kind === "unknown-primitive" && value.clock === "unbounded";

const isFiniteNumber = (value: StaticValue): boolean =>
  value.kind === "primitive" && typeof value.value === "number" && Number.isFinite(value.value);

/** Arithmetic and comparisons the clock ordering decides; null when it does not apply. */
export const applyClockOperator = (
  operator: string,
  left: StaticValue,
  right: StaticValue,
): StaticValue | null => {
  if (
    operator === "-" &&
    left.kind === "unknown-primitive" &&
    right.kind === "unknown-primitive" &&
    left.clock === "settled" &&
    right.clock === "reading"
  ) {
    return UNBOUNDED_ELAPSED;
  }
  if (isUnbounded(left) && isFiniteNumber(right)) {
    const isPositiveScale = right.kind === "primitive" && Number(right.value) > 0;
    switch (operator) {
      case "+":
      case "-":
        return UNBOUNDED_ELAPSED;
      case "*":
      case "/":
        return isPositiveScale ? UNBOUNDED_ELAPSED : null;
      case ">":
      case ">=":
        return primitiveValue(true);
      case "<":
      case "<=":
        return primitiveValue(false);
      default:
        return null;
    }
  }
  if (isFiniteNumber(left) && isUnbounded(right)) {
    switch (operator) {
      case "<":
      case "<=":
        return primitiveValue(true);
      case ">":
      case ">=":
        return primitiveValue(false);
      default:
        return null;
    }
  }
  return null;
};
