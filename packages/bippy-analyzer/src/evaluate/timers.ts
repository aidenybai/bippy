import type { SourceLocation } from "../parse/source-types.js";
import type { ClockReading, ClockTask, JournaledState, StaticValue } from "../types.js";
import { rangedNumberValue } from "./number-ranges.js";
import { getTruthinessPredicate, recordInputSource } from "./predicates.js";
import { areGuardsSatisfiable } from "../symbolic/guard-solver.js";
import {
  andGuard,
  combineGuardContexts,
  constantGuard,
  type Guard,
  type GuardContext,
} from "../symbolic/guards.js";
import { parseSymbolicPredicate } from "../symbolic/serialization.js";
import { branchValue, FALSE_VALUE, getTruthiness, primitiveValue, TRUE_VALUE } from "./values.js";

const getHandleIdentity = (handle: StaticValue): object =>
  handle.kind === "unknown-primitive" ? (handle.identity ?? handle) : handle;

class TaskFlag implements JournaledState<StaticValue> {
  readonly allocation = 0;

  constructor(public value: StaticValue) {}

  capture(): StaticValue {
    return this.value;
  }

  restore(value: StaticValue): void {
    this.value = value;
  }

  join(
    values: StaticValue[],
    reason: string,
    location: SourceLocation | null,
    preferredPath: number,
    predicate?: string | null,
  ): void {
    this.value = branchValue(values, reason, location, preferredPath, predicate);
  }
}

export interface ScheduledTask {
  readonly id: number;
  readonly kind: "timer" | "microtask" | "continuation";
  readonly parent: ScheduledTask | null;
  readonly cause: GuardContext;
  readonly handle: StaticValue | null;
  readonly pending: TaskFlag;
  readonly callback: () => void;
}

/** The quiet window (no React commit) after which the runtime snapshot is taken. */
export const DEFAULT_SETTLE_MS = 1_500;

/** Node's timers fire once its millisecond-truncated monotonic clock has advanced by the delay, so `Date.now()` can measure 1ms less. */
export const NODE_TIMER_UNDERRUN_MS = 1;

/** Timer tasks a static run may execute before its queue is declared unsettled. */
export const MAX_TIMER_TASKS = 512;

/**
 * Timers as the harness observes them. The runtime snapshot is captured once
 * React has been quiet for `settleMs`: a timer with a shorter delay has fired,
 * one with a longer or dynamic delay may not have, and a repeating interval
 * has either cleared itself or its ticks no longer change state.
 * Timer callbacks are queued as tasks and run one per settle round of the
 * materialized mount, so the code following `setTimeout` (including the
 * assignment of the returned handle) runs first and React commits the updates
 * a task made before the next task runs, as it does in the event loop.
 * Microtasks (`queueMicrotask`, promise reactions) run once the current task's
 * synchronous work ends: the host drains them before each timer task and at
 * the points of a React commit where the event loop would run them.
 * An interval's ticks are evaluated at that quiescent point, where any clock
 * reading is later than every earlier reading by an unbounded amount, until
 * the interval clears itself or a tick changes nothing. Readings taken in
 * evaluation order never decrease, two readings taken by the same task (no
 * timer round between them) are less than a second apart, and a reading taken
 * by a timer task is at least the timer's delay after the readings of the task
 * that scheduled it.
 */
export class TimerQueue {
  private readonly tasks: ScheduledTask[] = [];
  private readonly microtasks: ScheduledTask[] = [];
  private nextTaskId = 0;
  private activeTask: ScheduledTask | null = null;
  private readonly cancellations = new WeakMap<object, TaskFlag>();
  private clockSequence = 0;
  private clockTask: ClockTask = { scheduledBy: null, delayMs: 0 };
  private deferredDepth = 0;
  private animationFrameDepth = 0;
  private isDrainingMicrotasks = false;
  isClockSettled = false;
  isFlushing = false;
  getCause = (): GuardContext => ({ guard: constantGuard(true), inputs: [] });
  isTaskPossible = (guard: Guard): boolean => areGuardsSatisfiable([guard]);
  runWithCause = (_cause: GuardContext, task: () => void): void => task();

  constructor(
    private readonly settleMs = DEFAULT_SETTLE_MS,
    private readonly timerUnderrunMs = 0,
    private readonly recordMutation: (state: JournaledState<StaticValue>) => void = () => {},
  ) {}

  /** The delay of a timer that has fired by the captured commit, in ms; null for longer or dynamic delays. */
  getSettledDelay(delay: StaticValue | undefined): number | null {
    if (delay === undefined) return 0;
    if (delay.kind !== "primitive") return null;
    if (delay.value === undefined || delay.value === null) return 0;
    if (typeof delay.value === "number" && delay.value < this.settleMs) {
      return Math.max(0, delay.value);
    }
    return null;
  }

  get currentTaskId(): number | null {
    return this.activeTask?.id ?? null;
  }

  /** True while running a continuation of a promise that settles outside the analysis: its position on this timeline is unknown, so it may or may not have run by the captured commit. */
  get isDeferred(): boolean {
    return this.deferredDepth > 0;
  }

  get isRunningAnimationFrame(): boolean {
    return this.animationFrameDepth > 0;
  }

  runDeferred<Result>(run: () => Result): Result {
    this.deferredDepth += 1;
    try {
      return run();
    } finally {
      this.deferredDepth -= 1;
    }
  }

  runAnimationFrame<Result>(run: () => Result): Result {
    this.animationFrameDepth += 1;
    try {
      return run();
    } finally {
      this.animationFrameDepth -= 1;
    }
  }

  createHandle(name: string): StaticValue {
    return {
      ...rangedNumberValue(`${name} handle`, { min: 1, max: Number.POSITIVE_INFINITY }),
      identity: {},
    };
  }

  activate(handle: StaticValue): void {
    const identity = getHandleIdentity(handle);
    if (this.cancellations.has(identity)) return;
    const cancellation = new TaskFlag(TRUE_VALUE);
    this.cancellations.set(identity, cancellation);
    this.recordMutation(cancellation);
    cancellation.value = FALSE_VALUE;
  }

  get currentTask(): ScheduledTask | null {
    return this.activeTask;
  }

  private createTask(
    kind: ScheduledTask["kind"],
    callback: () => void,
    handle: StaticValue | null = null,
  ): ScheduledTask {
    const pending = new TaskFlag(FALSE_VALUE);
    this.recordMutation(pending);
    pending.value = TRUE_VALUE;
    return {
      id: ++this.nextTaskId,
      kind,
      parent: this.activeTask,
      cause: this.getCause(),
      handle,
      pending,
      callback,
    };
  }

  private getTaskCause(task: ScheduledTask): GuardContext | null {
    const pending = getTruthiness(task.pending.value);
    const cancellation = task.handle ? this.getCancellation(task.handle) : FALSE_VALUE;
    const isCancelled = getTruthiness(cancellation);
    if (pending === false || isCancelled === true) return null;
    const causes = [task.cause];
    for (const [value, isNegated] of [
      [task.pending.value, false],
      [cancellation, true],
    ] satisfies Array<[StaticValue, boolean]>) {
      if (getTruthiness(value) !== null) continue;
      const predicate = parseSymbolicPredicate(getTruthinessPredicate(value, isNegated));
      if (predicate.formula) causes.push({ guard: predicate.formula, inputs: predicate.inputs });
    }
    const cause = combineGuardContexts(causes, andGuard);
    return this.isTaskPossible(cause.guard) ? cause : null;
  }

  private runScheduledTask(task: ScheduledTask, cause: GuardContext): void {
    this.runWithCause(cause, () => {
      const previous = this.activeTask;
      this.activeTask = task;
      try {
        this.recordMutation(task.pending);
        task.pending.value = FALSE_VALUE;
        task.callback();
      } finally {
        this.activeTask = previous;
      }
    });
  }

  schedule(handle: StaticValue, task: () => void, delayMs = 0): void {
    this.activate(handle);
    const scheduledBy = this.clockTask;
    this.tasks.push(
      this.createTask(
        "timer",
        () => {
          this.clockTask = { scheduledBy, delayMs };
          task();
        },
        handle,
      ),
    );
  }

  /** Queues `task` for the next round, like a short timer that cannot be cleared. */
  enqueue(task: () => void): void {
    this.tasks.push(this.createTask("continuation", task));
  }

  clear(handle: StaticValue | undefined): void {
    if (!handle) return;
    const cancellation = this.cancellations.get(getHandleIdentity(handle));
    if (!cancellation || getTruthiness(cancellation.value) === true) return;
    this.recordMutation(cancellation);
    cancellation.value = TRUE_VALUE;
  }

  getCancellation(handle: StaticValue): StaticValue {
    return this.cancellations.get(getHandleIdentity(handle))?.value ?? FALSE_VALUE;
  }

  isCleared(handle: StaticValue): boolean {
    return getTruthiness(this.getCancellation(handle)) === true;
  }

  queueMicrotask(task: () => void, handle?: StaticValue): void {
    if (handle) this.activate(handle);
    this.microtasks.push(this.createTask("microtask", task, handle));
  }

  hasMicrotasks(): boolean {
    return this.microtasks.some((task) => this.getTaskCause(task) !== null);
  }

  /** Runs microtasks until none remain, including those they queue. */
  drainMicrotasks(): void {
    if (this.isDrainingMicrotasks) return;
    this.isDrainingMicrotasks = true;
    try {
      let executed = 0;
      for (const task of this.microtasks) {
        const cause = this.getTaskCause(task);
        if (!cause) continue;
        this.runScheduledTask(task, cause);
        if (++executed >= MAX_TIMER_TASKS) break;
      }
    } finally {
      this.isDrainingMicrotasks = false;
    }
  }

  hasTasks(): boolean {
    return this.tasks.some((task) => this.getTaskCause(task) !== null);
  }

  /** One turn of the event loop: the microtasks due, the next timer task, then the microtasks it queued. */
  runNextTask(): void {
    this.isFlushing = true;
    try {
      this.drainMicrotasks();
      if (this.hasMicrotasks()) return;
      for (const task of this.tasks) {
        const cause = this.getTaskCause(task);
        if (!cause) continue;
        this.runScheduledTask(task, cause);
        this.drainMicrotasks();
        break;
      }
    } finally {
      this.isFlushing = false;
    }
  }

  readClock(name: string): StaticValue {
    return recordInputSource(
      {
        kind: "unknown-primitive",
        primitiveType: "number",
        reason: `${name}()`,
        clock: {
          ordering: this.isClockSettled ? "settled" : "reading",
          sequence: ++this.clockSequence,
          task: this.clockTask,
          timerUnderrunMs: this.timerUnderrunMs,
        },
      },
      "clock",
    );
  }
}

const UNBOUNDED_ELAPSED: StaticValue = {
  kind: "unknown-primitive",
  primitiveType: "number",
  reason: "time elapsed until the interval settled",
  clock: {
    ordering: "unbounded",
    sequence: 0,
    task: { scheduledBy: null, delayMs: 0 },
    timerUnderrunMs: 0,
  },
};

const SAME_TASK_ELAPSED_BOUND_MS = 1000;
const ELAPSED_REASON = "time elapsed between clock readings";

const isUnbounded = (value: StaticValue): boolean =>
  value.kind === "unknown-primitive" && value.clock?.ordering === "unbounded";

/** The delays a later reading's scheduling chain adds up to since an earlier one, less the timer underrun; 0 when the earlier task is not on that chain. */
const getMinimumElapsed = (later: ClockReading, earlier: ClockReading): number => {
  let elapsed = 0;
  for (let task: ClockTask | null = later.task; task; task = task.scheduledBy) {
    if (task === earlier.task) return Math.max(0, elapsed - later.timerUnderrunMs);
    elapsed += task.delayMs;
  }
  return 0;
};

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
  if (leftClock.task === rightClock.task) {
    return leftClock.sequence >= rightClock.sequence
      ? rangedNumberValue(ELAPSED_REASON, { min: 0, max: SAME_TASK_ELAPSED_BOUND_MS })
      : rangedNumberValue(ELAPSED_REASON, { min: -SAME_TASK_ELAPSED_BOUND_MS, max: 0 });
  }
  return leftClock.sequence >= rightClock.sequence
    ? rangedNumberValue(ELAPSED_REASON, {
        min: getMinimumElapsed(leftClock, rightClock),
        max: Number.POSITIVE_INFINITY,
      })
    : rangedNumberValue(ELAPSED_REASON, {
        min: Number.NEGATIVE_INFINITY,
        max: -getMinimumElapsed(rightClock, leftClock),
      });
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
