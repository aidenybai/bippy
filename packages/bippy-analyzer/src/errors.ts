export class AnalyzerError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = new.target.name;
  }
}

export class ResolverConfigurationError extends AnalyzerError {}
