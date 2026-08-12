export class BippyError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "BippyError";
  }
}

export class BippyHookInspectionError extends BippyError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = "BippyHookInspectionError";
  }
}

export class BippyUnsupportedHookError extends BippyHookInspectionError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = "BippyUnsupportedHookError";
  }
}

export class BippyHookRenderError extends BippyHookInspectionError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = "BippyHookRenderError";
  }
}

export class BippySourceMapError extends BippyError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = "BippySourceMapError";
  }
}
