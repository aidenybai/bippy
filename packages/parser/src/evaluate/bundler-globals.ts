import type { ProcessEnvironment, RenderEnvironment, StaticValue } from "../types.js";
import {
  FALSE_VALUE,
  TRUE_VALUE,
  UNDEFINED_VALUE,
  branchValue,
  objectFromRecord,
  primitiveValue,
  unknownPrimitiveValue,
} from "./values.js";

const DEV_SERVER_MODE = "development";

const ENVIRONMENT_OBJECTS = ["process.env", "import.meta.env"];

const VITE_ENVIRONMENT: Record<string, StaticValue> = {
  MODE: primitiveValue(DEV_SERVER_MODE),
  DEV: TRUE_VALUE,
  PROD: FALSE_VALUE,
  SSR: FALSE_VALUE,
  BASE_URL: primitiveValue("/"),
};

export interface EnvironmentLookup {
  declared: ProcessEnvironment | null;
  renderEnvironment: RenderEnvironment | null;
}

const NO_ENVIRONMENT: EnvironmentLookup = { declared: null, renderEnvironment: null };

const getDeclaredVariable = (
  { declared, renderEnvironment }: EnvironmentLookup,
  variable: string,
): StaticValue | null => {
  if (declared === null) return null;
  const isInlined =
    renderEnvironment === "server" ||
    (declared.clientPrefix !== null && variable.startsWith(declared.clientPrefix));
  const value = isInlined ? declared.variables[variable] : undefined;
  return value === undefined ? UNDEFINED_VALUE : primitiveValue(value);
};

/** Bundlers inline what the build environment set; without the environment, an arbitrary variable is usually unset. */
const getEnvironmentVariable = (
  objectName: string,
  variable: string,
  environment: EnvironmentLookup,
): StaticValue => {
  if (variable === "NODE_ENV") return primitiveValue(DEV_SERVER_MODE);
  if (objectName === "import.meta.env" && variable in VITE_ENVIRONMENT)
    return VITE_ENVIRONMENT[variable];
  const declared = getDeclaredVariable(environment, variable);
  if (declared !== null) return declared;
  const reason = `environment variable ${variable}`;
  return branchValue([UNDEFINED_VALUE, unknownPrimitiveValue("string", reason)], reason, null);
};

const HOT_MODULE_OBJECTS = new Set(["module.hot", "import.meta.hot"]);

/** HMR handlers only run on a hot update, which never happens before the snapshot is captured. */
const HOT_MODULE_HANDLER_METHODS = new Set([
  "accept",
  "decline",
  "dispose",
  "addDisposeHandler",
  "removeDisposeHandler",
  "addStatusHandler",
  "removeStatusHandler",
  "invalidate",
  "on",
  "off",
  "send",
  "prune",
]);

export const isEnvironmentObject = (globalName: string): boolean =>
  ENVIRONMENT_OBJECTS.includes(globalName);

export const isEnvironmentVariableName = (name: string): boolean =>
  ENVIRONMENT_OBJECTS.some((objectName) => name.startsWith(`${objectName}.`));

export const getBundlerGlobal = (
  name: string,
  environment: EnvironmentLookup = NO_ENVIRONMENT,
): StaticValue | null => {
  if (name === "module" || name === "import.meta") return { kind: "global", name };
  if (ENVIRONMENT_OBJECTS.includes(name) || HOT_MODULE_OBJECTS.has(name))
    return { kind: "global", name };
  for (const objectName of ENVIRONMENT_OBJECTS) {
    if (name.startsWith(`${objectName}.`))
      return getEnvironmentVariable(objectName, name.slice(objectName.length + 1), environment);
  }
  if (name === "module.hot.data") return UNDEFINED_VALUE;
  if (name === "import.meta.hot.data") return objectFromRecord({});
  if (name === "import.meta.url") return unknownPrimitiveValue("string", name);
  return null;
};

export const callHotModuleMethod = (receiver: StaticValue, name: string): StaticValue | null => {
  if (receiver.kind !== "global" || !HOT_MODULE_OBJECTS.has(receiver.name)) return null;
  if (HOT_MODULE_HANDLER_METHODS.has(name)) return UNDEFINED_VALUE;
  if (name === "status") return primitiveValue("idle");
  return null;
};
