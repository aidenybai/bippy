const SUBSCRIPTION_PATTERN = /^on[A-Z]/;

const createPreloadMethod = (name: string | symbol) =>
  typeof name === "string" && SUBSCRIPTION_PATTERN.test(name)
    ? () => () => undefined
    : () => Promise.resolve({});

Object.assign(window, {
  electronAPI: new Proxy({}, { get: (_target, name) => createPreloadMethod(name) }),
});
