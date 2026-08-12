export class BippyError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "BippyError";
  }
}

export class BippyInstrumentationError extends BippyError {
  readonly callbackName: string;
  readonly instrumentationName: string;

  constructor(instrumentationName: string, callbackName: string, cause: unknown) {
    super(
      `Bippy instrumentation “${instrumentationName}” callback “${callbackName}” failed`,
      cause,
    );
    this.name = "BippyInstrumentationError";
    this.callbackName = callbackName;
    this.instrumentationName = instrumentationName;
  }
}

export class BippyReactDevToolsError extends BippyError {
  readonly callbackName: string;

  constructor(callbackName: string, cause: unknown) {
    super(`React DevTools callback “${callbackName}” failed`, cause);
    this.name = "BippyReactDevToolsError";
    this.callbackName = callbackName;
  }
}

export class BippyHookListenerError extends BippyError {
  readonly listenerName: string;

  constructor(listenerName: string, cause: unknown) {
    super(`Bippy hook listener “${listenerName}” failed`, cause);
    this.name = "BippyHookListenerError";
    this.listenerName = listenerName;
  }
}

export class BippyHookInstallationError extends BippyError {
  constructor(cause: unknown) {
    super("Bippy couldn’t install the React DevTools hook", cause);
    this.name = "BippyHookInstallationError";
  }
}

export class BippyReactBuildError extends BippyError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = "BippyReactBuildError";
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

interface BippyErrorFactory {
  (cause: unknown): BippyError;
}

export const runWithBippyError = <Result>(
  callback: () => Result,
  createError: BippyErrorFactory,
): Result => {
  try {
    return callback();
  } catch (cause) {
    if (cause instanceof BippyError) throw cause;
    throw createError(cause);
  }
};
