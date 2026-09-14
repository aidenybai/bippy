import path from "node:path";
import { pathToFileURL } from "node:url";
import { ResolverFactory } from "oxc-resolver";
import { z } from "zod";
import { ParserError, parseWithSchema } from "../errors.js";
import type { CompilerDefine, SourceTransform, ViteClientEnvironment } from "../types.js";
import { isAssetImport } from "./asset-module.js";
import { isCssModulePath, isStylesheetPath } from "./css-module.js";
import type { ViteConfigLocation } from "./vite-config.js";
import {
  applyHtmlTransformHooks,
  applyTransformHooks,
  loadFromDirectory,
  loadWithoutDom,
  type VitePlugin,
  vitePluginSchema,
} from "./vite-plugins.js";

const VITE_PACKAGE = "vite";
const SERVE_COMMAND = "serve";
const DEVELOPMENT_MODE = "development";
const INDEX_HTML = "index.html";

const loadWithDefaultNodeEnvironment = async <Loaded>(
  load: () => Promise<Loaded>,
): Promise<Loaded> => {
  const previousEnvironment = process.env.NODE_ENV;
  process.env.NODE_ENV ||= DEVELOPMENT_MODE;
  try {
    return await load();
  } finally {
    // HACK: Preserve Vite's original NODE_ENV-presence check across the separate configuration load.
    if (!previousEnvironment && process.env.NODE_ENV === DEVELOPMENT_MODE) {
      if (previousEnvironment === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousEnvironment;
    }
  }
};

const configFunctionSchema = z.custom<(...args: unknown[]) => Promise<unknown>>(
  (value) => typeof value === "function",
);
const viteModuleSchema = z.object({
  loadConfigFromFile: configFunctionSchema,
  resolveConfig: configFunctionSchema,
});
const loadedConfigSchema = z
  .object({ config: z.object({ plugins: z.unknown().optional() }).passthrough() })
  .nullable();
const resolvedConfigSchema = z
  .object({
    plugins: z.array(z.unknown()),
    env: z.record(z.string(), z.json()),
    define: z.record(z.string(), z.unknown()).default({}),
    mode: z.string(),
  })
  .passthrough();
const namedPluginSchema = z.object({ name: z.string() });

type ViteResolvedConfig = z.infer<typeof resolvedConfigSchema>;

interface ViteConfiguration {
  readonly rootDirectory: string;
  readonly config: ViteResolvedConfig;
  readonly plugins: VitePlugin[];
  readonly environment: ViteClientEnvironment;
}

const getCompilerDefine = (value: unknown): CompilerDefine => {
  if (value === undefined || value === "undefined") return { value: undefined };
  if (typeof value !== "string") return { value: parseWithSchema(z.json(), value, "Vite define") };
  try {
    const parsed: unknown = JSON.parse(value);
    return { value: parseWithSchema(z.json(), parsed, "Vite define") };
  } catch {
    return { value: undefined, expression: value };
  }
};

const getClientEnvironment = (config: ViteResolvedConfig): ViteClientEnvironment => {
  const defines = Object.fromEntries(
    Object.entries(config.define).map(([name, value]) => [name, getCompilerDefine(value)]),
  );
  const nodeDefine = defines["process.env.NODE_ENV"];
  if (nodeDefine && (nodeDefine.expression !== undefined || typeof nodeDefine.value !== "string")) {
    throw new ParserError("Vite process.env.NODE_ENV requires a known string define");
  }
  const nodeEnvironment =
    typeof nodeDefine?.value === "string" ? nodeDefine.value : process.env.NODE_ENV || config.mode;
  return { values: { ...config.env, SSR: false }, defines, nodeEnvironment };
};

/** Vite's `PluginOption` tree: plugins, promises of them and nested arrays, with falsy entries skipped. */
const flattenPlugins = async (option: unknown, into: Set<unknown>): Promise<void> => {
  const resolved: unknown = await option;
  if (!resolved) return;
  if (Array.isArray(resolved)) {
    for (const item of resolved) await flattenPlugins(item, into);
    return;
  }
  into.add(resolved);
};

/** A plugin set's members are its name and `name:`/`name-` companions (`remix`, `remix-hmr-updates`, `react-router:route-exports`). */
const isPluginSetMember = (name: string, setName: string): boolean =>
  name === setName || name.startsWith(`${setName}:`) || name.startsWith(`${setName}-`);

/** Extensions Vite's own plugins turn into modules, which the parser models itself. */
const isViteNativeExtension = (extension: string): boolean =>
  isAssetImport(extension, extension) || isStylesheetPath(extension) || isCssModulePath(extension);

/**
 * The app's Vite config resolved the way `vite dev` resolves it (config and
 * configResolved hooks run, `apply` honoured). Only the config file's own
 * plugins are kept: the parser reads JavaScript, JSON, stylesheets and static
 * assets itself, so Vite's built-in plugins must not run on them again, and
 * neither do the plugins a framework model stands in for.
 */
export const loadViteConfiguration = async (
  { configPath, cwd: rootDirectory, cliMode }: ViteConfigLocation,
  modeledPlugins: readonly string[] = [],
): Promise<ViteConfiguration | null> => {
  const resolver = new ResolverFactory({ conditionNames: ["node", "import", "default"] });
  const viteEntry = resolver.sync(rootDirectory, VITE_PACKAGE).path;
  if (viteEntry === undefined) return null;
  return loadFromDirectory(rootDirectory, () =>
    loadWithoutDom(async () => {
      const vite = parseWithSchema(
        viteModuleSchema,
        await import(pathToFileURL(viteEntry).href),
        VITE_PACKAGE,
      );
      const loaded = parseWithSchema(
        loadedConfigSchema,
        await loadWithDefaultNodeEnvironment(() =>
          vite.loadConfigFromFile(
            { command: SERVE_COMMAND, mode: cliMode || DEVELOPMENT_MODE },
            configPath,
            rootDirectory,
          ),
        ),
        `vite config ${configPath}`,
      );
      if (loaded === null) return null;
      const configuredPlugins = new Set<unknown>();
      await flattenPlugins(loaded.config.plugins, configuredPlugins);
      const userPlugins = new Set(
        [...configuredPlugins].filter((plugin) => {
          const { name } = parseWithSchema(namedPluginSchema, plugin, `vite config ${configPath}`);
          return !modeledPlugins.some((setName) => isPluginSetMember(name, setName));
        }),
      );
      const config = parseWithSchema(
        resolvedConfigSchema,
        await vite.resolveConfig(
          {
            ...loaded.config,
            ...(cliMode === null ? {} : { mode: cliMode }),
            plugins: [...userPlugins],
            configFile: false,
            logLevel: "silent",
          },
          SERVE_COMMAND,
          DEVELOPMENT_MODE,
        ),
        `vite config ${configPath}`,
      );
      const plugins = config.plugins
        .filter((plugin) => userPlugins.has(plugin))
        .map((plugin) => parseWithSchema(vitePluginSchema, plugin, `vite config ${configPath}`));
      return { rootDirectory, config, plugins, environment: getClientEnvironment(config) };
    }),
  );
};

/**
 * The plugins that turn a non-JavaScript file (YAML, Markdown, ...) into the
 * module the dev server serves transform it here too.
 */
export const createViteAssetTransform = ({
  rootDirectory,
  plugins,
}: ViteConfiguration): SourceTransform => ({
  appliesTo: (extension, lang) => lang === null && !isViteNativeExtension(extension),
  transform: (filePath, sourceText, query) =>
    applyTransformHooks(plugins, rootDirectory, filePath, sourceText, query, "js"),
});

/**
 * The HTML `vite dev` answers a page request with: the served root's
 * `index.html` after the config's `transformIndexHtml` hooks, which is how apps
 * fill in `<base>`, titles and injected scripts before the browser parses the page.
 */
export const transformViteDocumentShell = (
  { rootDirectory, config, plugins }: ViteConfiguration,
  html: string,
  servedDirectory: string,
  route: string,
): Promise<string> =>
  loadFromDirectory(rootDirectory, () =>
    applyHtmlTransformHooks(plugins, html, {
      path: `/${INDEX_HTML}`,
      filename: path.join(servedDirectory, INDEX_HTML),
      server: { config },
      originalUrl: route,
    }),
  );
