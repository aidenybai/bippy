import type { StaticValue } from "../types.js";
import { rangedNumberValue } from "./primitive-shapes.js";
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
 * the interval clears itself or a tick changes nothing. Readings taken in
 * evaluation order never decrease, and two readings taken by the same task
 * (no timer round between them) are less than a second apart.
 */
export class TimerQueue {
  private tasks: (() => void)[] = [];
  private readonly clearedHandles = new WeakSet<StaticValue>();
  private clockSequence = 0;
  private clockTask = 0;
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
      for (const task of tasks) {
        this.clockTask += 1;
        task();
      }
    } finally {
      this.isFlushing = false;
    }
  }

  readClock(name: string): StaticValue {
    return {
      kind: "unknown-primitive",
      primitiveType: "number",
      reason: `${name}()`,
      clock: {
        ordering: this.isClockSettled ? "settled" : "reading",
        sequence: ++this.clockSequence,
        task: this.clockTask,
      },
    };
  }
}

const UNBOUNDED_ELAPSED: StaticValue = {
  kind: "unknown-primitive",
  primitiveType: "number",
  reason: "time elapsed until the interval settled",
  clock: { ordering: "unbounded", sequence: 0, task: 0 },
};

const SAME_TASK_ELAPSED_BOUND_MS = 1000;

const isUnbounded = (value: StaticValue): boolean =>
  value.kind === "unknown-primitive" && value.clock?.ordering === "unbounded";

/** `later - earlier` for two clock readings; null unless both are readings. */
const subtractReadings = (left: StaticValue, right: StaticValue): StaticValue | null => {
  if (left.kind !== "unknown-primitive" || right.kind !== "unknown-primitive") return null;
  const leftClock = left.clock;
  const rightClock = right.clock;
  if (!leftClock || !rightClock) return null;
  if (leftClock.ordering === "settled" && rightClock.ordering === "reading") {
    return UNBOUNDED_ELAPSED;
  }
  if (leftClock.ordering === "unbounded" || rightClock.ordering === "unbounded") return null;
  if (leftClock.ordering !== rightClock.ordering) return null;
  const bound =
    leftClock.task === rightClock.task ? SAME_TASK_ELAPSED_BOUND_MS : Number.POSITIVE_INFINITY;
  return leftClock.sequence >= rightClock.sequence
    ? rangedNumberValue("time elapsed between clock readings", { min: 0, max: bound })
    : rangedNumberValue("time elapsed between clock readings", { min: -bound, max: 0 });
};

const isFiniteNumber = (value: StaticValue): boolean =>
  value.kind === "primitive" && typeof value.value === "number" && Number.isFinite(value.value);

/** Arithmetic and comparisons the clock ordering decides; null when it does not apply. */
export const applyClockOperator = (
  operator: string,
  left: StaticValue,
  right: StaticValue,
): StaticValue | null => {
  if (operator === "-") {
    const elapsed = subtractReadings(left, right);
    if (elapsed) return elapsed;
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
