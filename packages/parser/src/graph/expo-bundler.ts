import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { getInstalledModules } from "../libraries/installed-modules.js";
import { readPackageManifest } from "../package-manifest.js";
import type { JsonValue } from "../types.js";
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

const asyncRoutesSchema = z.union([z.boolean(), z.string(), z.record(z.string(), z.unknown())]);

/** The public app config fields `@expo/cli` reads to configure Expo Router and the web base URL. */
const expoConfigSchema = z.looseObject({
  experiments: z.object({ baseUrl: z.string().optional() }).optional(),
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
