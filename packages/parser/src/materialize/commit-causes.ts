import {
  andGuard,
  combineGuardContexts,
  constantGuard,
  type GuardContext,
  orGuard,
} from "../harness/symbolic-tree.js";

export class CommitCauses {
  private current: GuardContext = { guard: constantGuard(true), inputs: [] };
  private pending: GuardContext[] = [];
  private active: GuardContext | null = null;
  private isRendering = false;
  private hasTrackedCause = false;
  private hasCommitted = false;

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

  schedule(): void {
    this.pending.push(this.active ?? { guard: constantGuard(true), inputs: [] });
  }

  bindTask(task: () => void): () => void {
    const cause = this.active ?? { guard: constantGuard(true), inputs: [] };
    return () => this.runWith(cause, task);
  }

  run<Result>(ancestry: GuardContext, run: () => Result): Result {
    return this.runWith(combineGuardContexts([this.current, ancestry], andGuard), run);
  }

  private runWith<Result>(cause: GuardContext, run: () => Result): Result {
    const previous = this.active;
    this.active = cause;
    try {
      return run();
    } finally {
      this.active = previous;
    }
  }
}
