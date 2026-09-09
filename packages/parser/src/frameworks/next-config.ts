import { existsSync } from "node:fs";
import type { Interpreter } from "../evaluate/interpreter.js";
import { DEFAULT_STYLED_COMPONENTS_TRANSFORM } from "../evaluate/styled-components-transform.js";
import {
  getObjectProperty,
  getTruthiness,
  isKnownString,
  objectFromRecord,
  primitiveValue,
  UNDEFINED_VALUE,
  unknownValue,
} from "../evaluate/values.js";
import type { StaticRenderer } from "../render/static-renderer.js";
import type { StaticValue, StyledComponentsTransformOptions } from "../types.js";

const NEXT_CONFIG_FILES = [
  "next.config.js",
  "next.config.mjs",
  "next.config.cjs",
  "next.config.ts",
  "next.config.mts",
];
const DEVELOPMENT_PHASE = "phase-development-server";

/**
 * `next.config` as Next loads it: the default export, called with the phase
 * when it is a function; null when the project has no config file.
 */
export const evaluateNextConfig = (
  renderer: StaticRenderer,
  interpreter: Interpreter,
): StaticValue | null => {
  const configPath = NEXT_CONFIG_FILES.map((fileName) => renderer.resolvePath(fileName)).find(
    (candidate) => existsSync(candidate),
  );
  if (configPath === undefined) return null;
  const module = renderer.loadModule(configPath);
  if (!module) return unknownValue("next.config could not be parsed");
  const exported = interpreter.evaluateModuleExport(module, "default");
  if (exported.kind !== "function") return exported;
  const phaseArguments = [
    primitiveValue(DEVELOPMENT_PHASE),
    objectFromRecord({ defaultConfig: unknownValue("next's default config") }),
  ];
  return interpreter.callAwaited(
    exported,
    phaseArguments,
    interpreter.createModuleContext(module),
    null,
  );
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

/** Configures the interpreter with the source transforms `next.config`'s `compiler` options enable. */
export const applyNextCompilerOptions = (
  renderer: StaticRenderer,
  interpreter: Interpreter,
): void => {
  const config = evaluateNextConfig(renderer, interpreter);
  if (config === null) return;
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
