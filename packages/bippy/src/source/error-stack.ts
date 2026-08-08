interface ErrorConstructorWithPrepareStackTrace {
  prepareStackTrace?: unknown;
}

const errorConstructor: ErrorConstructorWithPrepareStackTrace = Error;

export const getPrepareStackTrace = (): unknown => errorConstructor.prepareStackTrace;

export const setPrepareStackTrace = (prepareStackTrace: unknown): void => {
  errorConstructor.prepareStackTrace = prepareStackTrace;
};
