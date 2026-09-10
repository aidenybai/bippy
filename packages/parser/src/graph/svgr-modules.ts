import { z } from "zod";
import { getInstalledModules } from "../libraries/installed-modules.js";
import type { ProjectContext, SourceTransform, TransformedSource } from "../types.js";
import { readInstalledPackage } from "./installed-package.js";
import type { ModuleResolver } from "./module-resolver.js";

const SVGR_BUNDLER_PACKAGES = ["@svgr/webpack", "@svgr/rollup"];
const SVGR_CORE_PACKAGE = "@svgr/core";
const SVGR_DEFAULT_PLUGIN_PACKAGES = ["@svgr/plugin-svgo", "@svgr/plugin-jsx"];
const SVG_EXTENSION = ".svg";
const REACT_SCRIPTS_PACKAGE = "react-scripts";
const VITE_PLUGIN_SVGR_PACKAGE = "vite-plugin-svgr";

const svgrConfigSchema = z.object({ typescript: z.boolean().optional() });

interface SyncCall {
  (...args: unknown[]): unknown;
}

interface SvgrState {
  caller: { name?: string; defaultPlugins: SyncCall[]; previousExport?: string };
  filePath: string;
}

/**
 * How a bundler's config invokes svgr: the caller it announces, the loader
 * options, the default plugins it hands svgr, the module the loader before it
 * emitted, and the import query that selects the loader when the bundler keys
 * it on one.
 */
interface SvgrLoaderRule {
  bundlerPackage: string;
  callerName?: string;
  options: Record<string, boolean>;
  defaultPluginPackages: string[];
  getPreviousExport: ((filePath: string) => string) | null;
  query?: string;
}

/**
 * `react-scripts` chains `@svgr/webpack` after `file-loader`, so the default
 * export stays the hashed asset URL only the build knows and the component is
 * the named `ReactComponent` export.
 */
const REACT_SCRIPTS_RULE: SvgrLoaderRule = {
  bundlerPackage: "@svgr/webpack",
  callerName: "@svgr/webpack",
  options: { prettier: false, svgo: false, titleProp: true, ref: true },
  defaultPluginPackages: SVGR_DEFAULT_PLUGIN_PACKAGES,
  getPreviousExport: (filePath) =>
    `export default require(${JSON.stringify(`file-loader!${filePath}`)});`,
};

/**
 * `vite-plugin-svgr` loads `*.svg?react` (its default `include`) through svgr
 * with `@svgr/plugin-jsx` as the only default plugin and no caller name; the
 * plain `.svg` import stays Vite's asset URL.
 */
const VITE_PLUGIN_SVGR_RULE: SvgrLoaderRule = {
  bundlerPackage: VITE_PLUGIN_SVGR_PACKAGE,
  options: {},
  defaultPluginPackages: ["@svgr/plugin-jsx"],
  getPreviousExport: null,
  query: "react",
};

const getDefaultExport = (module: object): SyncCall | null => {
  if (typeof module === "function") return (...args) => Reflect.apply(module, undefined, args);
  const exported: unknown = Reflect.get(module, "default");
  return typeof exported === "function" ? (...args) => Reflect.apply(exported, module, args) : null;
};

const getSyncExport = (module: object, exportName: string): SyncCall | null => {
  const exported: unknown = Reflect.get(module, exportName);
  if (typeof exported !== "function") return null;
  const sync: unknown = Reflect.get(exported, "sync");
  return typeof sync === "function" ? (...args) => Reflect.apply(sync, exported, args) : null;
};

const transformSvg = (
  loadConfig: SyncCall,
  transform: SyncCall,
  rule: SvgrLoaderRule,
  state: SvgrState,
  svgText: string,
): TransformedSource | null => {
  try {
    const config = svgrConfigSchema.safeParse(loadConfig(rule.options, state));
    const code = transform(svgText, rule.options, state);
    if (typeof code !== "string") return null;
    return { sourceText: code, lang: config.success && config.data.typescript ? "tsx" : "jsx" };
  } catch {
    return null;
  }
};

const createTransform = (rootDirectory: string, rule: SvgrLoaderRule): SourceTransform | null => {
  const installed = getInstalledModules(rootDirectory);
  const core = installed.load(SVGR_CORE_PACKAGE, rule.bundlerPackage);
  const loadConfig = core && getSyncExport(core, "loadConfig");
  const transform = core && (getSyncExport(core, "transform") ?? getSyncExport(core, "default"));
  const defaultPlugins: SyncCall[] = [];
  for (const packageName of rule.defaultPluginPackages) {
    const plugin = installed.load(packageName, rule.bundlerPackage);
    const pluginFunction = plugin && getDefaultExport(plugin);
    if (pluginFunction === null) return null;
    defaultPlugins.push(pluginFunction);
  }
  if (!loadConfig || !transform) return null;
  return {
    appliesTo: (extension, _lang, query) =>
      extension === SVG_EXTENSION &&
      (rule.query === undefined
        ? query === null
        : query !== null && new URLSearchParams(query).has(rule.query)),
    transform: (filePath, sourceText) =>
      transformSvg(
        loadConfig,
        transform,
        rule,
        {
          caller: {
            name: rule.callerName,
            defaultPlugins,
            previousExport: rule.getPreviousExport?.(filePath),
          },
          filePath,
        },
        sourceText,
      ),
  };
};

const findLoaderRule = (
  project: ProjectContext,
  resolver: ModuleResolver,
  rootDirectory: string,
): SvgrLoaderRule | null => {
  if (project.hasDeclaredDependency(REACT_SCRIPTS_PACKAGE)) return REACT_SCRIPTS_RULE;
  const isInstalled = (packageName: string): boolean =>
    readInstalledPackage(resolver, rootDirectory, packageName) !== null;
  if (project.bundler === "vite" && isInstalled(VITE_PLUGIN_SVGR_PACKAGE))
    return VITE_PLUGIN_SVGR_RULE;
  const bundlerPackage = SVGR_BUNDLER_PACKAGES.find(isInstalled);
  return bundlerPackage === undefined
    ? null
    : {
        bundlerPackage,
        callerName: bundlerPackage,
        options: {},
        defaultPluginPackages: SVGR_DEFAULT_PLUGIN_PACKAGES,
        getPreviousExport: null,
      };
};

export const createSvgrSourceTransform = (
  project: ProjectContext,
  resolver: ModuleResolver,
  rootDirectory: string,
): SourceTransform | null => {
  const rule = findLoaderRule(project, resolver, rootDirectory);
  return rule === null ? null : createTransform(rootDirectory, rule);
};
