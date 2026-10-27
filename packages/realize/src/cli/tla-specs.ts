import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { check, formatValue, parseConfig, parseModule } from "tla-ts";
import type { CheckResult, CheckStatus } from "tla-ts";
import { ConfigError } from "../core/config-error";
import type { AnalyzedComponent } from "../core/types";
import { formatTla, getTlaModuleNames } from "./tla";
import type { TlaSpec } from "./tla";

export interface SpecCheck {
  specFile: string;
  configFile: string | null;
  result: CheckResult;
}

export type ComponentModuleResolver = (name: string, specFile: string) => TlaSpec | null;

const IGNORED_DIRECTORIES = new Set(["node_modules"]);
const SPECIFICATION_PATTERN = /^\s*(?:INIT|NEXT|SPECIFICATION)\b/m;
const CHECK_DEADLOCK_PATTERN = /^\s*CHECK_DEADLOCK\b/m;

export const findSpecFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory())
      return entry.name.startsWith(".") || IGNORED_DIRECTORIES.has(entry.name)
        ? []
        : findSpecFiles(path);
    return entry.name.endsWith(".tla") ? [path] : [];
  });

export const createComponentModuleResolver = (
  components: AnalyzedComponent[],
  rootDirectory: string,
): ComponentModuleResolver => {
  const moduleNames = getTlaModuleNames(components, rootDirectory);
  const specsByKey = new Map<string, TlaSpec>();
  return (name, specFile) => {
    const qualified = components.filter((component) => moduleNames.get(component) === name);
    const candidates =
      qualified.length > 0
        ? qualified
        : components.filter((component) => component.analysis.name === name);
    const siblings =
      candidates.length > 1
        ? candidates.filter((component) => dirname(component.analysis.file) === dirname(specFile))
        : candidates;
    const [component, ...others] = siblings;
    if (candidates.length > 1 && (!component || others.length > 0))
      throw new ConfigError(
        `${name} matches ${candidates.length} components, so name one of ${candidates.map((candidate) => moduleNames.get(candidate)).join(", ")}`,
      );
    if (!component) return null;
    const key = `${component.analysis.file}\0${component.analysis.name}\0${name}`;
    const spec = specsByKey.get(key) ?? formatTla(component, { rootDirectory, moduleName: name });
    specsByKey.set(key, spec);
    return spec;
  };
};

const VIOLATION_MESSAGES: Record<CheckStatus, (name: string) => string> = {
  success: () => "",
  "assumption-violation": (name) => `Error: Assumption ${name} is false.`,
  deadlock: () => "Error: Deadlock reached.",
  "invariant-violation": (name) => `Error: Invariant ${name} is violated.`,
  "property-violation": (name) => `Error: Property ${name} is violated.`,
  "liveness-violation": (name) => `Error: Temporal property ${name} was violated.`,
  "postcondition-violation": (name) => `Error: Postcondition ${name} is false.`,
};

export const checkSpec = (
  specFile: string,
  resolveComponentModule: ComponentModuleResolver,
): SpecCheck | null => {
  const source = readFileSync(specFile, "utf8");
  const module = parseModule(source);
  const componentSpecs = [
    ...module.extends,
    ...module.instances.map((instance) => instance.module),
  ].flatMap((name) => resolveComponentModule(name, specFile) ?? []);
  if (componentSpecs.length === 0) return null;
  const configFile = specFile.replace(/\.tla$/, ".cfg");
  const userConfig = existsSync(configFile) ? readFileSync(configFile, "utf8") : "";
  const assignedNames = new Set(parseConfig(userConfig).constants.map((constant) => constant.name));
  const constants = [
    ...new Set(componentSpecs.flatMap((componentSpec) => componentSpec.constants)),
  ].filter((constant) => !assignedNames.has(constant));
  const config = [
    ...(constants.length > 0
      ? [`CONSTANTS ${constants.map((constant) => `${constant} = ${constant}`).join(" ")}`]
      : []),
    ...(SPECIFICATION_PATTERN.test(userConfig) ? [] : ["SPECIFICATION Spec"]),
    ...(CHECK_DEADLOCK_PATTERN.test(userConfig) ? [] : ["CHECK_DEADLOCK FALSE"]),
    userConfig,
  ].join("\n");
  const result = check({
    source,
    config,
    loadModule: (name) => {
      const componentSpec = resolveComponentModule(name, specFile);
      if (componentSpec) return componentSpec.source;
      const siblingFile = join(dirname(specFile), `${name}.tla`);
      return existsSync(siblingFile) ? readFileSync(siblingFile, "utf8") : undefined;
    },
  });
  return { specFile, configFile: existsSync(configFile) ? configFile : null, result };
};

export const formatSpecCheck = (specCheck: SpecCheck, rootDirectory: string): string => {
  const { result } = specCheck;
  const { violation } = result;
  const trace = violation?.trace ?? [];
  const loopStart = violation?.loopStart;
  return [
    `Checking ${relative(rootDirectory, specCheck.specFile)}${specCheck.configFile ? ` with ${relative(rootDirectory, specCheck.configFile)}` : ""}`,
    ...(violation
      ? [
          VIOLATION_MESSAGES[result.status](violation.name),
          ...(trace.length > 0 ? ["Error: The behavior up to this point is:"] : []),
          ...trace.flatMap((step, stepIndex) => [
            `State ${stepIndex + 1}: <${step.action ?? "Initial predicate"}>`,
            ...Object.entries(step.state).map(
              ([name, value]) => `/\\ ${name} = ${formatValue(value)}`,
            ),
            "",
          ]),
          ...(loopStart === undefined
            ? []
            : [
                loopStart === trace.length - 1
                  ? `State ${loopStart + 2}: Stuttering`
                  : `Back to state ${loopStart + 1}`,
              ]),
        ]
      : ["Model checking completed. No error has been found."]),
    `${result.generatedStates} states generated, ${result.distinctStates} distinct states found, 0 states left on queue.`,
    `The depth of the complete state graph search is ${result.depth}.`,
  ].join("\n");
};
