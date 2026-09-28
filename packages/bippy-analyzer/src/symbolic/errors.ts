export class SymbolicEngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class SymbolicEngineCleanupError extends AggregateError {
  constructor(loadError: unknown, cleanupError: unknown) {
    super([loadError, cleanupError], "Symbolic engine loading and cleanup both failed");
    this.name = new.target.name;
  }
}
