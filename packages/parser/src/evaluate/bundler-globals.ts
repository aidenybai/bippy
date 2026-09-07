import type { StaticValue } from "../types.js";
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

/** Bundlers inline what the build environment set; an arbitrary variable is usually unset. */
const getEnvironmentVariable = (objectName: string, variable: string): StaticValue => {
  if (variable === "NODE_ENV") return primitiveValue(DEV_SERVER_MODE);
  if (objectName === "import.meta.env" && variable in VITE_ENVIRONMENT)
    return VITE_ENVIRONMENT[variable];
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

export const getBundlerGlobal = (name: string): StaticValue | null => {
  if (name === "module" || name === "import.meta") return { kind: "global", name };
  if (ENVIRONMENT_OBJECTS.includes(name) || HOT_MODULE_OBJECTS.has(name))
    return { kind: "global", name };
  for (const objectName of ENVIRONMENT_OBJECTS) {
    if (name.startsWith(`${objectName}.`))
      return getEnvironmentVariable(objectName, name.slice(objectName.length + 1));
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
