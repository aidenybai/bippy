import { areGuardsSatisfiable } from "../symbolic/guard-solver.js";
import {
  andGuard,
  combineGuardContexts,
  constantGuard,
  type Guard,
  type GuardContext,
  orGuard,
} from "../symbolic/guards.js";

interface GuardedRunner {
  <Result>(cause: GuardContext, run: () => Result): Result;
}

export class CommitCauses {
  private current: GuardContext = { guard: constantGuard(true), inputs: [] };
  private pending: GuardContext[] = [];
  private active: GuardContext | null = null;
  private isRendering = false;
  private hasTrackedCause = false;
  private hasCommitted = false;

  constructor(
    private readonly runGuarded: GuardedRunner = (_cause, run) => run(),
    private readonly isGuardPossible: (guard: Guard) => boolean = (guard) =>
      areGuardsSatisfiable([guard]),
  ) {}

  beginRender(ancestry: GuardContext = { guard: constantGuard(true), inputs: [] }): void {
    if (this.isRendering) {
      if (!this.hasTrackedCause)
        this.current = combineGuardContexts([this.current, ancestry], orGuard);
      return;
    }
    this.isRendering = true;
    this.hasTrackedCause = !this.hasCommitted || this.pending.length > 0;
    this.current = !this.hasCommitted
      ? { guard: constantGuard(true), inputs: [] }
      : this.hasTrackedCause
        ? combineGuardContexts(this.pending, orGuard)
        : ancestry;
    this.pending = [];
  }

  commit(): GuardContext {
    this.hasCommitted = true;
    this.isRendering = false;
    return this.current;
  }

  getCause(): GuardContext {
    return this.active ?? { guard: constantGuard(true), inputs: [] };
  }

  schedule(): void {
    this.pending.push(this.getCause());
  }

  bindContinuation<Arguments extends unknown[]>(
    task: (...args: Arguments) => void,
  ): (...args: Arguments) => void {
    const cause = this.getCause();
    return (...args) => this.runTask(cause, () => task(...args));
  }

  run<Result>(ancestry: GuardContext, run: () => Result): Result {
    return this.runWith(combineGuardContexts([this.current, ancestry], andGuard), run);
  }

  runTask(cause: GuardContext, task: () => void): void {
    this.runGuardedTask(combineGuardContexts([this.getCause(), cause], andGuard), task);
  }

  private runGuardedTask(cause: GuardContext, task: () => void): void {
    if (this.isGuardPossible(cause.guard)) this.runWith(cause, task);
  }

  private runWith<Result>(cause: GuardContext, run: () => Result): Result {
    const previous = this.active;
    this.active = cause;
    try {
      return this.runGuarded(cause, run);
    } finally {
      this.active = previous;
    }
  }
}
