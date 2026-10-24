import { STAND_IN } from "../../../verifier/stubs/stand-in";

const SUBSCRIPTION_PATTERN = /^on[A-Z]/;

const createPreloadMethod = (name: string | symbol) =>
  typeof name === "string" && SUBSCRIPTION_PATTERN.test(name)
    ? () => () => undefined
    : () => Promise.resolve(STAND_IN);

Object.assign(window, {
  electronAPI: new Proxy({}, { get: (_target, name) => createPreloadMethod(name) }),
});
