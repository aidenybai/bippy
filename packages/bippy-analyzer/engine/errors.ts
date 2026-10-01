export class EngineBuildError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class EngineCleanupError extends AggregateError {
  constructor(failures: unknown[]) {
    super(failures, "Engine resource cleanup failed");
    this.name = new.target.name;
  }
}

export class EngineBuildCleanupError extends AggregateError {
  constructor(failure: unknown, cleanupFailure: unknown) {
    super([failure, cleanupFailure], "Engine build and cleanup both failed");
    this.name = new.target.name;
  }
}
