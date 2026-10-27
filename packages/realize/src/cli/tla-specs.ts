import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { check, formatValue, parseConfig, parseModule } from "tla-ts";
import type { CheckStatus, TraceStep } from "tla-ts";
import { ConfigError } from "../core/config-error";
import type { AnalyzedComponent } from "../core/types";
import { formatTla, getTlaModuleNames } from "./tla";
import type { TlaSpec } from "./tla";

export interface SpecStep {
  label: string;
  changes: string[];
}

export interface PropertyResult {
  name: string;
  status: CheckStatus;
  trace: SpecStep[];
  loopStart: number | undefined;
}

export interface SpecResult {
  file: string;
  properties: PropertyResult[];
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

const formatChanges = (step: TraceStep, previous: TraceStep | undefined): string[] =>
  Object.entries(step.state).flatMap(([name, value]) => {
    const text = formatValue(value);
    const previousValue = previous?.state[name];
    return previousValue !== undefined && formatValue(previousValue) === text
      ? []
      : `${name} = ${text}`;
  });

export const checkSpec = (
  specFile: string,
  resolveComponentModule: ComponentModuleResolver,
): SpecResult | null => {
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
  const config = parseConfig(
    [
      ...(constants.length > 0
        ? [`CONSTANTS ${constants.map((constant) => `${constant} = ${constant}`).join(" ")}`]
        : []),
      ...(SPECIFICATION_PATTERN.test(userConfig) ? [] : ["SPECIFICATION Spec"]),
      ...(CHECK_DEADLOCK_PATTERN.test(userConfig) ? [] : ["CHECK_DEADLOCK FALSE"]),
      userConfig,
    ].join("\n"),
  );
  const actionLabels = new Map(
    componentSpecs.flatMap((componentSpec) => [...componentSpec.actionLabels]),
  );
  const loadModule = (name: string): string | undefined => {
    const componentSpec = resolveComponentModule(name, specFile);
    if (componentSpec) return componentSpec.source;
    const siblingFile = join(dirname(specFile), `${name}.tla`);
    return existsSync(siblingFile) ? readFileSync(siblingFile, "utf8") : undefined;
  };
  const checkOne = (name: string, isInvariant: boolean): PropertyResult => {
    const result = check({
      source,
      config: {
        ...config,
        invariants: isInvariant ? [name] : [],
        properties: isInvariant ? [] : [name],
      },
      loadModule,
    });
    const trace = result.violation?.trace ?? [];
    return {
      name,
      status: result.status,
      trace: trace.map((step, stepIndex) => ({
        label:
          step.action === undefined
            ? "first render"
            : (actionLabels.get(step.action) ?? step.action),
        changes: formatChanges(step, trace[stepIndex - 1]),
      })),
      loopStart: result.violation?.loopStart,
    };
  };
  return {
    file: specFile,
    properties: [
      ...config.invariants.map((name) => checkOne(name, true)),
      ...config.properties.map((name) => checkOne(name, false)),
    ],
  };
};

export const formatSpecResult = (result: SpecResult, rootDirectory: string): string =>
  [
    relative(rootDirectory, result.file),
    ...result.properties.flatMap((property) => {
      if (property.status === "success") return [`  holds   ${property.name}`];
      return [
        `  broken  ${property.name}`,
        ...property.trace.map(
          (step, stepIndex) =>
            `    ${stepIndex + 1}. ${step.label}${step.changes.length > 0 ? `: ${step.changes.join(", ")}` : ""}`,
        ),
        ...(property.loopStart === undefined
          ? []
          : [`    then back to step ${property.loopStart + 1}`]),
      ];
    }),
  ].join("\n");
