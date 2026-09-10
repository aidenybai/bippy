import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { parseWithSchema } from "../errors.js";
import { isVersionAtLeast, readInstalledVersion } from "../libraries/installed-version.js";
import { readDeclaredDependencies } from "./project-context.js";

const EXPO_PACKAGE = "expo";
const EXPO_WEBPACK_CONFIG_PACKAGE = "@expo/webpack-config";
const METRO_PACKAGE = "metro";
const REACT_NATIVE_WEB_PACKAGE = "react-native-web";
const WEB_PLATFORM = "web";

/** `@expo/config`'s `getBareExtensions` order, which Metro tries per platform variant before the bare file. */
const METRO_SOURCE_EXTENSIONS = ["ts", "tsx", "mjs", "js", "jsx", "json", "cjs"];

/** The Metro whose `unstable_enablePackageExports` default flipped to `true`. */
const FIRST_METRO_WITH_PACKAGE_EXPORTS = "0.82.0";

interface ExpoAppConfig {
  expo?: { web?: { bundler?: string } };
}

const expoAppConfigSchema: z.ZodType<ExpoAppConfig> = z.object({
  expo: z.object({ web: z.object({ bundler: z.string().optional() }).optional() }).optional(),
});

export interface ExpoWebResolution {
  extensions: string[];
  aliases: Record<string, string>;
  exportsFields: string[];
}

const readWebBundler = (rootDirectory: string): string => {
  const appConfigPath = path.join(rootDirectory, "app.json");
  const configured = existsSync(appConfigPath)
    ? parseWithSchema(
        expoAppConfigSchema,
        JSON.parse(readFileSync(appConfigPath, "utf8")),
        appConfigPath,
      ).expo?.web?.bundler
    : undefined;
  if (configured !== undefined) return configured;
  return readInstalledVersion(rootDirectory, EXPO_WEBPACK_CONFIG_PACKAGE) === null
    ? "metro"
    : "webpack";
};

/** Expo CLI's `getPlatformBundlers`: `expo.web.bundler`, else webpack only when `@expo/webpack-config` is installed. */
export const servesWebWithMetro = (rootDirectory: string): boolean =>
  readDeclaredDependencies(path.join(rootDirectory, "package.json")).includes(EXPO_PACKAGE) &&
  readWebBundler(rootDirectory) === "metro";

/** How Expo's Metro resolves the web platform: `.web.*` variants before the bare file, `react-native` aliased to `react-native-web`, package `exports` only once Metro enables them. */
export const getExpoWebResolution = (rootDirectory: string): ExpoWebResolution | null => {
  if (!servesWebWithMetro(rootDirectory)) return null;
  const metroVersion = readInstalledVersion(rootDirectory, METRO_PACKAGE);
  return {
    extensions: [
      ...METRO_SOURCE_EXTENSIONS.map((extension) => `.${WEB_PLATFORM}.${extension}`),
      ...METRO_SOURCE_EXTENSIONS.map((extension) => `.${extension}`),
    ],
    aliases: { "react-native": REACT_NATIVE_WEB_PACKAGE },
    exportsFields:
      metroVersion !== null && isVersionAtLeast(metroVersion, FIRST_METRO_WITH_PACKAGE_EXPORTS)
        ? ["exports"]
        : [],
  };
};
