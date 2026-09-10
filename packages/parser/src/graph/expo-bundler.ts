import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { CommandFailedError, parseWithSchema } from "../errors.js";
import { getCreateElementRewrites } from "../libraries/babel-plugins.js";
import { getInstalledModules } from "../libraries/installed-modules.js";
import { WORKLETS_PLUGIN_NAME } from "../libraries/worklets-plugin.js";
import { readPackageManifest } from "../package-manifest.js";
import type { BabelTransform, JsonValue, ProcessEnvironment } from "../types.js";
import type { ModuleResolverOptions } from "./module-resolver.js";

/** Expo CLI's default `EXPO_PUBLIC_FOLDER`: a project `public/index.html` replaces the bundled template. */
const PUBLIC_FOLDER = "public";

const TEMPLATE_INDEX_HTML = "static/template/index.html";

/** `@expo/cli` replaces these `node_modules` files with virtual modules in web bundles (`static/shims/<package path>`). */
const SHIMS_FOLDER = "static/shims";

/** `withMetroMultiPlatform`'s web aliases: exact module names redirected before Metro resolves them. */
const WEB_ALIASES: Record<string, string> = {
  "react-native$": "react-native-web",
  "react-native/index$": "react-native-web",
  "react-native/Libraries/Image/resolveAssetSource$": "expo-asset/build/resolveAssetSource",
};

/** `babel-preset-expo` inlines `process.env.EXPO_PUBLIC_*` into client bundles. */
export const EXPO_CLIENT_PREFIX = "EXPO_PUBLIC_";

/** `@expo/metro-config`'s `loadBabelConfig`: the project config it extends, else the SDK's own preset. */
const BABEL_CONFIG_FILES = [".babelrc", ".babelrc.js", "babel.config.js"];
const DEFAULT_BABEL_PRESETS = ["expo/internal/babel-preset", "babel-preset-expo"];

/** pnpm's bin shims export the `NODE_PATH` the CLI, and the Metro transform workers it forks, resolve Babel plugins with. */
const SHIM_NODE_PATH_PATTERN = /^\s*export NODE_PATH="([^"]*)"/m;

/** `@babel/plugin-transform-react-jsx` and its `/development` variant; the first to visit a file's JSX compiles it. */
const JSX_PLUGIN_KEY_PATTERN = /^transform-react-jsx(\/development)?$/;

/** The loaded plugins come back on their own pipe: a project's `babel.config.js` may log to stdout while it loads. */
const LOADED_OPTIONS_FD = 3;

const LOAD_BABEL_OPTIONS_SCRIPT = `
const [babelCorePath, resultFd] = process.argv.slice(1);
const fs = require("node:fs");
const options = JSON.parse(fs.readFileSync(0, "utf8"));
const loaded = require(babelCorePath).loadOptions(options);
fs.writeSync(
  Number(resultFd),
  JSON.stringify(loaded === null ? null : loaded.plugins.map(({ key, options }) => ({ key, options }))),
);
`;

const jsxPluginOptionsSchema = z.looseObject({
  runtime: z.enum(["classic", "automatic"]).optional(),
  importSource: z.string().optional(),
  pragma: z.string().optional(),
  pragmaFrag: z.string().optional(),
});

const loadedPluginsSchema = z
  .array(z.object({ key: z.string(), options: z.unknown().optional() }))
  .nullable();

const asyncRoutesSchema = z.union([z.boolean(), z.string(), z.record(z.string(), z.unknown())]);

const webBundlerSchema = z.enum(["metro", "webpack"]);

export type ExpoWebBundler = z.infer<typeof webBundlerSchema>;

/** The public app config fields `@expo/cli` reads to configure Expo Router, the web bundler and the web base URL. */
const expoConfigSchema = z.looseObject({
  experiments: z.object({ baseUrl: z.string().optional() }).optional(),
  web: z.object({ bundler: webBundlerSchema.optional() }).optional(),
  extra: z
    .object({
      router: z
        .object({ root: z.string().optional(), asyncRoutes: asyncRoutesSchema.optional() })
        .optional(),
    })
    .optional(),
});

interface ExpoConfig extends z.infer<typeof expoConfigSchema> {}

const getConfigResultSchema = z.object({ exp: expoConfigSchema });

const expoConfigModuleSchema = z.object({
  getConfig: z.custom<(projectRoot: string, options: object) => unknown>(
    (value) => typeof value === "function",
  ),
});

/** The public `exp` the CLI resolves from `app.json`/`app.config.*` plus config plugins, as `babel-preset-expo` inlines it. */
const readExpoConfig = (rootDirectory: string): ExpoConfig | null => {
  const configModule = getInstalledModules(rootDirectory).load("expo/config");
  const parsedModule = expoConfigModuleSchema.safeParse(configModule);
  if (!parsedModule.success) return null;
  const result = parsedModule.data.getConfig(rootDirectory, {
    isPublicConfig: true,
    skipSDKVersionRequirement: true,
  });
  const parsedResult = getConfigResultSchema.safeParse(result);
  return parsedResult.success ? parsedResult.data.exp : null;
};

const isDirectory = (directoryPath: string): boolean =>
  existsSync(directoryPath) && statSync(directoryPath).isDirectory();

/** `expo start` runs in the package that declares `expo`: the CLI reads that `package.json` as the project root. */
const isExpoProject = (rootDirectory: string): boolean => {
  const manifestPath = path.join(rootDirectory, "package.json");
  if (!existsSync(manifestPath)) return false;
  const { dependencies, devDependencies } = readPackageManifest(manifestPath);
  return dependencies?.expo !== undefined || devDependencies?.expo !== undefined;
};

/** The `@expo/cli` the project's `expo` binary `require`s; null when Expo is not the project's dev server. */
export const findExpoCliDirectory = (rootDirectory: string): string | null => {
  if (!isExpoProject(rootDirectory)) return null;
  const installed = getInstalledModules(rootDirectory);
  const expoBinary = installed.resolve("expo/bin/cli");
  if (expoBinary === null) return null;
  const manifestPath = installed.resolveBeside("@expo/cli/package.json", expoBinary);
  return manifestPath === null ? null : path.dirname(manifestPath);
};

/** `@expo/cli`'s `getPlatformBundlers`: `web.bundler`, else webpack when `@expo/webpack-config` is installed. */
export const getExpoWebBundler = (rootDirectory: string): ExpoWebBundler =>
  readExpoConfig(rootDirectory)?.web?.bundler ??
  (getInstalledModules(rootDirectory).resolve("@expo/webpack-config/package.json") === null
    ? "metro"
    : "webpack");

/** How `@expo/cli`'s Metro resolver rewrites web requests: `react-native` aliases and its static shims. */
export const getExpoResolverOptions = (
  expoCliDirectory: string,
  platform: string,
): Pick<ModuleResolverOptions, "aliases" | "shimDirectories"> => ({
  aliases: platform === "web" ? WEB_ALIASES : {},
  shimDirectories: platform === "web" ? [path.join(expoCliDirectory, SHIMS_FOLDER)] : [],
});

/** The page Expo's Metro dev server answers `/` with: the project's `public/index.html`, else the CLI's template. */
export const readExpoDocumentShell = (
  rootDirectory: string,
  expoCliDirectory: string,
): string | null => {
  const projectIndex = path.join(rootDirectory, PUBLIC_FOLDER, "index.html");
  if (existsSync(projectIndex)) return readFileSync(projectIndex, "utf8");
  const templateIndex = path.join(expoCliDirectory, TEMPLATE_INDEX_HTML);
  return existsSync(templateIndex) ? readFileSync(templateIndex, "utf8") : null;
};

/** `@expo/cli`'s `getRouterDirectoryModuleIdWithManifest`: `extra.router.root`, else `src/app` when present, else `app`. */
const getRouterDirectory = (rootDirectory: string, config: ExpoConfig): string => {
  const configured = config.extra?.router?.root;
  if (configured !== undefined) return path.resolve(rootDirectory, configured);
  const sourceAppDirectory = path.join(rootDirectory, "src", "app");
  return isDirectory(sourceAppDirectory) ? sourceAppDirectory : path.join(rootDirectory, "app");
};

/** `getAsyncRoutesFromExpoConfig` for a development bundle: `true` or `"development"` enables lazy route loading. */
const hasAsyncRoutes = (config: ExpoConfig, platform: string): boolean => {
  const setting = config.extra?.router?.asyncRoutes;
  const resolved =
    typeof setting === "object" && setting !== null
      ? (setting[platform] ?? setting.default)
      : setting;
  return resolved === true || resolved === "development";
};

/** `getBaseUrlFromExpoConfig`: `experiments.baseUrl` without trailing slashes. */
const getBaseUrl = (config: ExpoConfig): string =>
  config.experiments?.baseUrl?.trim().replace(/\/+$/, "") ?? "";

const readShimNodePath = (rootDirectory: string): string | null => {
  const shimPath = path.join(rootDirectory, "node_modules", ".bin", "expo");
  if (!existsSync(shimPath)) return null;
  return SHIM_NODE_PATH_PATTERN.exec(readFileSync(shimPath, "utf8"))?.[1] ?? null;
};

const getBabelConfigSource = (rootDirectory: string): Record<string, JsonValue> => {
  const configPath = BABEL_CONFIG_FILES.map((fileName) => path.join(rootDirectory, fileName)).find(
    (candidate) => existsSync(candidate),
  );
  if (configPath !== undefined) return { extends: configPath };
  const installed = getInstalledModules(rootDirectory);
  const presetPath = DEFAULT_BABEL_PRESETS.map((preset) => installed.resolve(preset)).find(
    (candidate) => candidate !== null,
  );
  return presetPath === undefined || presetPath === null ? {} : { presets: [presetPath] };
};

/**
 * How Metro's Babel pass compiles element creation in a development web
 * bundle: `@expo/metro-config`'s transformer loads the project's Babel config
 * for `filePath` with the caller Expo CLI passes, in the process environment
 * (and `NODE_PATH`) its `expo` binary runs with; the first JSX plugin in the
 * resolved chain compiles every JSX element, plugins that rewrite
 * `createElement` imports apply to the files they visit, and the worklets
 * plugin marks the functions it workletizes.
 */
export const getExpoBabelTransform = (
  rootDirectory: string,
  expoCliDirectory: string,
  platform: string,
  filePath: string,
  environment: ProcessEnvironment | undefined,
): BabelTransform => {
  const installed = getInstalledModules(rootDirectory);
  const metroConfigManifest = installed.resolveBeside(
    "@expo/metro-config/package.json",
    path.join(expoCliDirectory, "package.json"),
  );
  const babelCorePath =
    metroConfigManifest === null
      ? null
      : installed.resolveBeside("@babel/core", metroConfigManifest);
  if (babelCorePath === null)
    return { pragma: null, createElementRewrites: [], workletizes: false };
  const config = readExpoConfig(rootDirectory) ?? {};
  const babelOptions: Record<string, JsonValue> = {
    sourceType: "unambiguous",
    cwd: rootDirectory,
    filename: filePath,
    ...getBabelConfigSource(rootDirectory),
    babelrc: true,
    caller: {
      name: "metro",
      bundler: "metro",
      platform,
      isServer: false,
      isReactServer: false,
      baseUrl: getBaseUrl(config),
      routerRoot: path.relative(rootDirectory, getRouterDirectory(rootDirectory, config)),
      isDev: true,
      ...(hasAsyncRoutes(config, platform) ? { asyncRoutes: true } : {}),
      projectRoot: rootDirectory,
      isNodeModule: filePath.includes("node_modules"),
      isHMREnabled: true,
      metroSourceType: "module",
      supportsStaticESM: false,
    },
  };
  const nodePath = readShimNodePath(rootDirectory);
  const result = spawnSync(
    process.execPath,
    ["-e", LOAD_BABEL_OPTIONS_SCRIPT, babelCorePath, String(LOADED_OPTIONS_FD)],
    {
      cwd: rootDirectory,
      input: JSON.stringify(babelOptions),
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        ...environment?.variables,
        NODE_ENV: "development",
        BABEL_ENV: "development",
        ...(nodePath === null ? {} : { NODE_PATH: nodePath }),
      },
    },
  );
  if (result.status !== 0) {
    throw new CommandFailedError(`babel.loadOptions(${filePath})`, result.status, result.stderr);
  }
  const plugins = parseWithSchema(
    loadedPluginsSchema,
    JSON.parse(String(result.output[LOADED_OPTIONS_FD])),
    `babel.loadOptions(${filePath})`,
  );
  const jsxPlugin = plugins?.find((plugin) => JSX_PLUGIN_KEY_PATTERN.test(plugin.key));
  const options = jsxPluginOptionsSchema.parse(jsxPlugin?.options ?? {});
  const pluginNames = (plugins ?? []).map((plugin) => plugin.key);
  return {
    pragma:
      jsxPlugin === undefined
        ? null
        : {
            runtime: options.runtime ?? null,
            factory: options.pragma ?? null,
            fragment: options.pragmaFrag ?? null,
            importSource: options.importSource ?? null,
          },
    createElementRewrites: getCreateElementRewrites(pluginNames),
    workletizes: pluginNames.includes(WORKLETS_PLUGIN_NAME),
  };
};

/**
 * What `babel-preset-expo` inlines into every module of a development web
 * bundle: its `define-plugin`, `expo-inline-manifest-plugin` and
 * `expo-router-plugin` outputs for the options `@expo/cli` derives from the
 * app config.
 */
export const getExpoDefines = (
  rootDirectory: string,
  platform: string,
): Record<string, JsonValue> => {
  const config = readExpoConfig(rootDirectory) ?? {};
  const defines: Record<string, JsonValue> = {
    __DEV__: true,
    "process.env.EXPO_OS": platform,
    "process.env.EXPO_SERVER": false,
    "process.env.EXPO_BASE_URL": getBaseUrl(config),
    "process.env.EXPO_PROJECT_ROOT": rootDirectory,
    "process.env.APP_MANIFEST": JSON.stringify(config),
  };
  const routerEntry = getInstalledModules(rootDirectory).resolve("expo-router/entry");
  if (routerEntry !== null) {
    const routerDirectory = getRouterDirectory(rootDirectory, config);
    defines["process.env.EXPO_ROUTER_ABS_APP_ROOT"] = routerDirectory;
    defines["process.env.EXPO_ROUTER_APP_ROOT"] = path.relative(
      path.dirname(routerEntry),
      routerDirectory,
    );
    defines["process.env.EXPO_ROUTER_IMPORT_MODE"] = hasAsyncRoutes(config, platform)
      ? "lazy"
      : "sync";
  }
  return defines;
};
