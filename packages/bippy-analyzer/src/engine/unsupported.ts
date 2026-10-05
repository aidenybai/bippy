export class EngineLimitError extends Error {
  constructor(resource: string) {
    super(`Engine ${resource} budget exhausted`);
    this.name = "EngineLimitError";
  }
}

export class EngineUnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EngineUnsupportedError";
  }
}
