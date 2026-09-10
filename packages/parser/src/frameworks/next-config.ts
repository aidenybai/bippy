import { existsSync } from "node:fs";
import type { Interpreter } from "../evaluate/interpreter.js";
import { readStyledComponentsOption } from "../evaluate/styled-components-transform.js";
import {
  getObjectProperty,
  getTruthiness,
  objectFromRecord,
  primitiveValue,
  UNDEFINED_VALUE,
  unknownValue,
} from "../evaluate/values.js";
import type { ReactPackageSpecifiers } from "../materialize/react-runtime.js";
import type { StaticRenderer } from "../render/static-renderer.js";
import type { StaticValue } from "../types.js";
import { NEXT_PHASES } from "./next-externals.js";

const NEXT_CONFIG_FILES = [
  "next.config.js",
  "next.config.mjs",
  "next.config.cjs",
  "next.config.ts",
  "next.config.mts",
];
const EXPERIMENTAL_REACT_FLAGS = ["ppr", "taint", "viewTransition", "routerBFCache"];

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
  if (exported.kind !== "function" && exported.kind !== "native-function") return exported;
  const phaseArguments = [
    primitiveValue(NEXT_PHASES.PHASE_DEVELOPMENT_SERVER),
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

/**
 * The React build Next bundles for `app/` in place of the app's own
 * (`createVendoredReactAliases`): the experimental channel when one of the
 * `experimental` flags `needsExperimentalReact` reads is set, canary otherwise.
 */
export const readNextVendoredReactPackages = (
  renderer: StaticRenderer,
  interpreter: Interpreter,
): ReactPackageSpecifiers => {
  const config = evaluateNextConfig(renderer, interpreter);
  const experimental = config === null ? UNDEFINED_VALUE : readOption(config, "experimental");
  const flags = EXPERIMENTAL_REACT_FLAGS.map((flag) =>
    getTruthiness(readOption(experimental, flag)),
  );
  const isExperimental = flags.includes(true);
  if (!isExperimental && flags.includes(null)) {
    interpreter.report(
      "next-config",
      "experimental React flags in next.config could not be evaluated; materializing with Next's canary React",
      null,
      "warning",
    );
  }
  const channel = isExperimental ? "-experimental" : "";
  return {
    react: `next/dist/compiled/react${channel}`,
    dom: `next/dist/compiled/react-dom${channel}`,
    domClient: `next/dist/compiled/react-dom${channel}/client`,
    domServer: `next/dist/compiled/react-dom${channel}/server`,
  };
};
