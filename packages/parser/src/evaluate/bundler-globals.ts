import type { Expression } from "oxc-parser";
import { getMemberChain, isStringLiteralNode } from "../parse/ast-walk.js";
import type {
  ModuleBundler,
  ProcessEnvironment,
  RenderEnvironment,
  StaticValue,
} from "../types.js";
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

/** Node objects webpack-style bundlers polyfill on the client while Vite leaves them undeclared. */
const POLYFILLED_NODE_OBJECTS = new Set(["process", "Buffer"]);

/** Free names some bundlers define per module (webpack's Node shims, AMD's `define`) and others leave undeclared. */
export const BUNDLER_INJECTED_NAMES = new Set([
  ...POLYFILLED_NODE_OBJECTS,
  "global",
  "define",
  "require",
  "__dirname",
  "__filename",
]);

/** Of those, the names Vite leaves to the browser, where reading them throws; esbuild's CommonJS wrapper still supplies `require`. */
const VITE_UNDECLARED_NAMES = new Set([...POLYFILLED_NODE_OBJECTS, "global", "define"]);

export const isBundlerUndeclaredName = (bundler: ModuleBundler, name: string): boolean =>
  bundler === "vite" && VITE_UNDECLARED_NAMES.has(name);

/** Packages that bundle the client with webpack, whose `node.global` polyfill makes the bare `global` the page's window. */
const WEBPACK_BUNDLER_PACKAGES = ["webpack", "react-scripts", "next", "@rspack/core"];

export const isWebpackBundled = (
  hasDeclaredDependency: (packageName: string) => boolean,
): boolean => WEBPACK_BUNDLER_PACKAGES.some(hasDeclaredDependency);

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
  /** Environment objects a `define` replaced wholesale, so undeclared variables read `undefined`. */
  definedObjects?: ReadonlySet<string>;
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
  if (environment.definedObjects?.has(objectName)) return UNDEFINED_VALUE;
  const reason = `environment variable ${variable}`;
  return branchValue([UNDEFINED_VALUE, unknownPrimitiveValue("string", reason)], reason, null);
};

/** Vite and webpack replace these in the source text of every client module, whether or not `process` exists at runtime. */
const NODE_ENV_DEFINES = new Set([
  "process.env.NODE_ENV",
  "global.process.env.NODE_ENV",
  "globalThis.process.env.NODE_ENV",
]);

export const getInlinedNodeEnv = (name: string): StaticValue | null =>
  NODE_ENV_DEFINES.has(name) ? primitiveValue(DEV_SERVER_MODE) : null;

const getComparedNodeEnvLiteral = (member: Expression, literal: Expression): string | null => {
  const chain = getMemberChain(member);
  if (chain === null || !NODE_ENV_DEFINES.has(chain.join("."))) return null;
  return isStringLiteralNode(literal) ? literal.value : null;
};

/**
 * The outcome of `process.env.NODE_ENV === "production"`-style tests once the
 * bundler has inlined `NODE_ENV`, which decides `if (…) module.exports = require(…)` wrappers.
 */
export const decideInlinedNodeEnvTest = (test: Expression): boolean | null => {
  if (test.type !== "BinaryExpression") return null;
  const isEquality = test.operator === "===" || test.operator === "==";
  if (!isEquality && test.operator !== "!==" && test.operator !== "!=") return null;
  const compared =
    getComparedNodeEnvLiteral(test.left, test.right) ??
    getComparedNodeEnvLiteral(test.right, test.left);
  if (compared === null) return null;
  return isEquality ? compared === DEV_SERVER_MODE : compared !== DEV_SERVER_MODE;
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

/** A define of `null` for these means the bundler leaves the name unset rather than inlining `null`. */
export const isUnsettableDefineName = (name: string): boolean =>
  isEnvironmentVariableName(name) || BUNDLER_INJECTED_NAMES.has(name);

const isBundlerObject = (name: string): boolean =>
  name === "module" ||
  name === "import.meta" ||
  ENVIRONMENT_OBJECTS.includes(name) ||
  HOT_MODULE_OBJECTS.has(name);

/** `typeof` of a name the bundler itself provides; null for names it leaves to the host. */
export const getBundlerGlobalTypeof = (name: string): string | null => {
  if (isBundlerObject(name)) return "object";
  return name === "import.meta.glob" ? "function" : null;
};

export const getBundlerGlobal = (
  name: string,
  environment: EnvironmentLookup = NO_ENVIRONMENT,
): StaticValue | null => {
  if (isBundlerObject(name) || name === "import.meta.glob" || POLYFILLED_NODE_OBJECTS.has(name))
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
