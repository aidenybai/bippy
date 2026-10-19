import { SETUP_PATH, WRAPPER_PATH } from "../types";
import type { MountRequest, Wrapper } from "../types";
import { hydrate } from "./hydrate";

export interface LoadedWrapper {
  type: unknown;
  props: Record<string, unknown>;
}

interface SetupModule {
  scenarios?: Record<string, (...scenarioArguments: unknown[]) => unknown>;
}

const isComponentType = (value: unknown): boolean =>
  typeof value === "function" ||
  (typeof value === "object" && value !== null && "$$typeof" in value);

const getComponentType = (value: unknown): unknown => {
  if (!isComponentType(value)) return Reflect.get(Object(value), "Root");
  const provider = Reflect.get(Object(value), "Provider");
  return "Consumer" in Object(value) && isComponentType(provider) ? provider : value;
};

const findPartName = (exportNames: string[], exportName: string): string | undefined =>
  exportNames
    .filter((name) => exportName.endsWith(name))
    .sort((left, right) => right.length - left.length)[0] ??
  exportNames
    .filter((name) => name.endsWith(exportName))
    .sort((left, right) => left.length - right.length)[0];

export const loadWrapper = async ({ candidate }: Wrapper): Promise<LoadedWrapper | null> => {
  const isPackage = candidate.kind === "package";
  const query = new URLSearchParams(
    isPackage
      ? { specifier: candidate.specifier, importer: candidate.importer }
      : { specifier: candidate.file, importer: candidate.file },
  );
  const imported: Record<string, unknown> | null = await import(
    /* @vite-ignore */ `${WRAPPER_PATH}?${query}`
  ).catch(() => null);
  if (!imported) return null;
  const moduleExports: Record<string, unknown> =
    isPackage && candidate.namespace ? Object(imported[candidate.namespace]) : imported;
  const exportNames = Object.keys(moduleExports).filter((name) => /^[A-Z]/.test(name));
  const partName = isPackage ? findPartName(exportNames, candidate.exportName) : undefined;
  const value =
    moduleExports[candidate.exportName] ??
    (partName ? moduleExports[partName] : undefined) ??
    (isPackage ? moduleExports.Root : undefined);
  const componentType = getComponentType(value);
  if (!isComponentType(componentType)) return null;
  return {
    type: componentType,
    props: Object.fromEntries(
      Object.entries(candidate.props).map(([name, sample]) => [name, hydrate(sample)]),
    ),
  };
};

export const runScenario = async (
  scenario: NonNullable<MountRequest["scenario"]>,
): Promise<boolean> => {
  const setupModule: SetupModule = await import(/* @vite-ignore */ SETUP_PATH);
  const runner = setupModule.scenarios?.[scenario.name];
  if (!runner) return false;
  await runner(...scenario.args);
  return true;
};

export const importComponentModule = async (
  componentModule: MountRequest["module"],
): Promise<Record<string, unknown>> => {
  for (const url of componentModule.importerUrls)
    await import(/* @vite-ignore */ new URL(url, location.origin).href).catch(() => undefined);
  return import(/* @vite-ignore */ new URL(componentModule.url, location.origin).href);
};
