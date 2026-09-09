import { existsSync } from "node:fs";
import path from "node:path";
import type { Interpreter } from "../evaluate/interpreter.js";
import { DEFAULT_STYLED_COMPONENTS_TRANSFORM } from "../evaluate/styled-components-transform.js";
import {
  getObjectProperty,
  getTruthiness,
  isKnownString,
  objectFromRecord,
  primitiveValue,
  TRUE_VALUE,
  UNDEFINED_VALUE,
  unknownPrimitiveValue,
  unknownValue,
} from "../evaluate/values.js";
import type { StaticRenderer } from "../render/static-renderer.js";
import type {
  ModuleRecord,
  StaticObjectValue,
  StaticValue,
  StyledComponentsTransformOptions,
} from "../types.js";

const NEXT_CONFIG_FILES = [
  "next.config.js",
  "next.config.mjs",
  "next.config.cjs",
  "next.config.ts",
  "next.config.mts",
];
const DEVELOPMENT_PHASE = "phase-development-server";

export interface NextConfigEvaluation {
  module: ModuleRecord | null;
  value: StaticValue;
}

/**
 * `next.config` as Next loads it: the default export, called with the phase
 * when it is a function; null when the project has no config file.
 */
export const evaluateNextConfigModule = (
  renderer: StaticRenderer,
  interpreter: Interpreter,
): NextConfigEvaluation | null => {
  const configPath = NEXT_CONFIG_FILES.map((fileName) => renderer.resolvePath(fileName)).find(
    (candidate) => existsSync(candidate),
  );
  if (configPath === undefined) return null;
  const module = renderer.loadModule(configPath);
  if (!module) return { module, value: unknownValue("next.config could not be parsed") };
  const exported = interpreter.evaluateModuleExport(module, "default");
  if (exported.kind !== "function") return { module, value: exported };
  const phaseArguments = [
    primitiveValue(DEVELOPMENT_PHASE),
    objectFromRecord({ defaultConfig: unknownValue("next's default config") }),
  ];
  const value = interpreter.callAwaited(
    exported,
    phaseArguments,
    interpreter.createModuleContext(module),
    null,
  );
  return { module, value };
};

export const evaluateNextConfig = (
  renderer: StaticRenderer,
  interpreter: Interpreter,
): StaticValue | null => evaluateNextConfigModule(renderer, interpreter)?.value ?? null;

const eachAlternative = (value: StaticValue, visit: (alternative: StaticValue) => void): void => {
  if (value.kind === "branch") {
    for (const alternative of value.alternatives) eachAlternative(alternative, visit);
  } else {
    visit(value);
  }
};

const TURBOPACK_ALIAS_PATHS = [
  ["turbopack", "resolveAlias"],
  ["experimental", "turbo", "resolveAlias"],
];

const readPath = (value: StaticValue, keys: string[]): StaticValue =>
  keys.reduce((current, key) => readOption(current, key), value);

const collectAliasEntries = (
  aliases: StaticValue,
  collected: Map<string, Set<string>>,
  rootDirectory: string,
): void => {
  eachAlternative(aliases, (alternative) => {
    if (alternative.kind !== "object") return;
    for (const entry of alternative.entries) {
      if (entry.kind !== "property") continue;
      eachAlternative(entry.value, (target) => {
        if (!isKnownString(target)) return;
        const targets = collected.get(entry.key) ?? new Set<string>();
        targets.add(path.resolve(rootDirectory, target.value));
        collected.set(entry.key, targets);
      });
    }
  });
};

/** The compiler options Next hands `webpack(config, options)` in `next dev`; which compiler runs is not decided here. */
const webpackCompilerOptions = (): StaticObjectValue =>
  objectFromRecord({
    dev: TRUE_VALUE,
    isServer: unknownPrimitiveValue("boolean", "whether the server or client compiler runs"),
    buildId: unknownPrimitiveValue("string", "the webpack build id"),
    nextRuntime: unknownValue("the compiler's runtime"),
    defaultLoaders: unknownValue("next's default webpack loaders"),
    webpack: unknownValue("the webpack module"),
    config: unknownValue("the resolved next config"),
  });

/**
 * `resolve.alias` entries `next.config` sets, for Turbopack through
 * `turbopack.resolveAlias` and for webpack by mutating the config its
 * `webpack()` hook receives; targets resolve from the project root as both
 * bundlers do. A specifier whose alternatives disagree is left unaliased.
 */
export const readNextResolveAliases = (
  evaluation: NextConfigEvaluation,
  interpreter: Interpreter,
  rootDirectory: string,
): Record<string, string> => {
  const collected = new Map<string, Set<string>>();
  eachAlternative(evaluation.value, (config) => {
    if (config.kind !== "object") return;
    for (const keys of TURBOPACK_ALIAS_PATHS) {
      collectAliasEntries(readPath(config, keys), collected, rootDirectory);
    }
    const webpackHook = getObjectProperty(config, "webpack");
    if (webpackHook.kind !== "function" || evaluation.module === null) return;
    const webpackConfig = objectFromRecord({
      context: primitiveValue(rootDirectory),
      resolve: objectFromRecord({ alias: objectFromRecord({}) }),
    });
    const returned = interpreter.callValue(
      webpackHook,
      [webpackConfig, webpackCompilerOptions()],
      interpreter.createModuleContext(evaluation.module),
      null,
    );
    collectAliasEntries(readPath(returned, ["resolve", "alias"]), collected, rootDirectory);
  });
  const aliases: Record<string, string> = {};
  for (const [specifier, targets] of collected) {
    if (targets.size === 1) {
      aliases[specifier] = [...targets][0];
    } else {
      interpreter.report(
        "next-config",
        `resolve alias ${specifier} in next.config resolves to ${[...targets].join(" or ")}`,
        null,
        "warning",
      );
    }
  }
  return aliases;
};

/** A property of a config object; a missing object reads as `undefined`, an unknown one stays unknown. */
const readOption = (object: StaticValue, key: string): StaticValue => {
  if (object.kind === "object") return getObjectProperty(object, key);
  return object.kind === "primitive" ? UNDEFINED_VALUE : object;
};

const readBoolean = (value: StaticValue, fallback: boolean): boolean | null => {
  if (value.kind === "primitive" && value.value === undefined) return fallback;
  return getTruthiness(value);
};

const readStringList = (value: StaticValue, fallback: string[]): string[] | null => {
  if (value.kind === "primitive" && value.value === undefined) return fallback;
  if (value.kind !== "list") return null;
  const strings = value.items.flatMap((item) => (isKnownString(item) ? [item.value] : []));
  return strings.length === value.items.length ? strings : null;
};

/** `compiler.styledComponents` as Next's development build applies it; `undefined` when the analysis cannot read it. */
const readStyledComponentsOption = (
  option: StaticValue,
): StyledComponentsTransformOptions | null | undefined => {
  if (option.kind !== "object") {
    const isEnabled = getTruthiness(option);
    if (isEnabled === null) return undefined;
    return isEnabled ? DEFAULT_STYLED_COMPONENTS_TRANSFORM : null;
  }
  const defaults = DEFAULT_STYLED_COMPONENTS_TRANSFORM;
  const displayName = readBoolean(getObjectProperty(option, "displayName"), true);
  const fileName = readBoolean(getObjectProperty(option, "fileName"), defaults.fileName);
  const meaninglessFileNames = readStringList(
    getObjectProperty(option, "meaninglessFileNames"),
    defaults.meaninglessFileNames,
  );
  const topLevelImportPaths = readStringList(
    getObjectProperty(option, "topLevelImportPaths"),
    defaults.topLevelImportPaths,
  );
  if (displayName === null || fileName === null || !meaninglessFileNames || !topLevelImportPaths) {
    return undefined;
  }
  return displayName ? { fileName, meaninglessFileNames, topLevelImportPaths } : null;
};

/**
 * Configures the analysis from `next.config`: the source transforms its
 * `compiler` options enable and the module aliases it declares.
 */
export const applyNextConfig = (renderer: StaticRenderer, interpreter: Interpreter): void => {
  const evaluation = evaluateNextConfigModule(renderer, interpreter);
  if (evaluation === null) return;
  renderer.addAliases(
    readNextResolveAliases(evaluation, interpreter, renderer.options.rootDirectory),
  );
  const config = evaluation.value;
  const transform = readStyledComponentsOption(
    readOption(readOption(config, "compiler"), "styledComponents"),
  );
  if (transform === undefined) {
    interpreter.report(
      "next-config",
      "compiler.styledComponents in next.config could not be evaluated",
      null,
      "warning",
    );
    return;
  }
  if (transform !== null) interpreter.styledComponentsTransform = transform;
};
