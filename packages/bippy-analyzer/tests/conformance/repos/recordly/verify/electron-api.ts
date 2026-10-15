const createPreloadResult = (): (() => void) =>
  Object.assign(() => undefined, {
    then: (onFulfilled?: (value: object) => unknown) => Promise.resolve(onFulfilled?.({})),
    catch: () => Promise.resolve({}),
    finally: (onFinally?: () => void) => Promise.resolve(onFinally?.()),
  });

Object.assign(window, {
  electronAPI: new Proxy({}, { get: () => createPreloadResult }),
});
