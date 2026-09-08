import { z } from "zod";
import { getInstalledModules } from "../libraries/installed-modules.js";
import type { SourceTransform, TransformedSource } from "../types.js";
import { readInstalledPackage } from "./installed-package.js";
import type { ModuleResolver } from "./module-resolver.js";

const SVGR_BUNDLER_PACKAGES = ["@svgr/webpack", "@svgr/rollup"];
const SVGR_CORE_PACKAGE = "@svgr/core";
const SVGR_DEFAULT_PLUGIN_PACKAGES = ["@svgr/plugin-svgo", "@svgr/plugin-jsx"];
const SVG_EXTENSION = ".svg";

const svgrConfigSchema = z.object({ typescript: z.boolean().optional() });

interface SyncCall {
  (...args: unknown[]): unknown;
}

interface SvgrState {
  caller: { name: string; defaultPlugins: object[] };
  filePath: string;
}

const getSyncExport = (module: object, exportName: string): SyncCall | null => {
  const exported: unknown = Reflect.get(module, exportName);
  if (typeof exported !== "function") return null;
  const sync: unknown = Reflect.get(exported, "sync");
  return typeof sync === "function" ? (...args) => Reflect.apply(sync, exported, args) : null;
};

const transformSvg = (
  loadConfig: SyncCall,
  transform: SyncCall,
  state: SvgrState,
  svgText: string,
): TransformedSource | null => {
  try {
    const config = svgrConfigSchema.safeParse(loadConfig({}, state));
    const code = transform(svgText, {}, state);
    if (typeof code !== "string") return null;
    return { sourceText: code, lang: config.success && config.data.typescript ? "tsx" : "jsx" };
  } catch {
    return null;
  }
};

const createTransform = (rootDirectory: string, bundlerPackage: string): SourceTransform | null => {
  const installed = getInstalledModules(rootDirectory);
  const core = installed.load(SVGR_CORE_PACKAGE, bundlerPackage);
  const loadConfig = core && getSyncExport(core, "loadConfig");
  const transform = core && getSyncExport(core, "transform");
  const defaultPlugins: object[] = [];
  for (const packageName of SVGR_DEFAULT_PLUGIN_PACKAGES) {
    const plugin = installed.load(packageName, bundlerPackage);
    if (plugin === null) return null;
    defaultPlugins.push(plugin);
  }
  if (!loadConfig || !transform) return null;
  return {
    extension: SVG_EXTENSION,
    transform: (filePath, sourceText) =>
      transformSvg(
        loadConfig,
        transform,
        { caller: { name: bundlerPackage, defaultPlugins }, filePath },
        sourceText,
      ),
  };
};

export const createSvgrSourceTransform = (
  resolver: ModuleResolver,
  rootDirectory: string,
): SourceTransform | null => {
  const bundlerPackage = SVGR_BUNDLER_PACKAGES.find(
    (packageName) => readInstalledPackage(resolver, rootDirectory, packageName) !== null,
  );
  return bundlerPackage === undefined ? null : createTransform(rootDirectory, bundlerPackage);
};
