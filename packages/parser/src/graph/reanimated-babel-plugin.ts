import { z } from "zod";
import { parseWithSchema } from "../errors.js";
import { getInstalledModules } from "../libraries/installed-modules.js";
import { getSourceLanguage } from "../parse/parse-source-file.js";
import type { ModuleBundler, SourceLanguage, SourceTransform } from "../types.js";
import { functionSchema, loadWithoutDom } from "./vite-plugins.js";

const PLUGIN_ENTRY = "react-native-reanimated/plugin";
const BABEL_CORE = "@babel/core";

const babelCoreSchema = z.object({ transformSync: functionSchema });
const babelResultSchema = z.object({ code: z.string() }).nullable();

const getBabelParserPlugins = (lang: SourceLanguage): string[] => {
  switch (lang) {
    case "ts":
      return ["typescript", "decorators-legacy"];
    case "tsx":
      return ["typescript", "jsx", "decorators-legacy"];
    default:
      return ["flow", "jsx", "decorators-legacy"];
  }
};

/**
 * Metro transpiles every module it bundles with the project's Babel config,
 * and `babel-preset-expo` enables `react-native-reanimated/plugin` whenever
 * Reanimated is installed. The plugin rewrites worklets (`'worklet'` bodies
 * and the callbacks its hooks take) into factories that attach `__closure`,
 * `__workletHash` and `__initData` to the function, which Reanimated's web
 * runtime reads for its dependencies. The installed plugin is run on the
 * modules the way Metro runs it, so the analyzed source matches the served one.
 */
export const createReanimatedWorkletTransform = async (
  rootDirectory: string,
  bundler: ModuleBundler,
): Promise<SourceTransform | null> => {
  if (bundler !== "metro") return null;
  const installed = getInstalledModules(rootDirectory);
  const plugin = await loadWithoutDom(() => installed.load(PLUGIN_ENTRY));
  if (plugin === null) return null;
  const babel = parseWithSchema(
    babelCoreSchema,
    await loadWithoutDom(() => installed.load(BABEL_CORE)),
    BABEL_CORE,
  );
  return {
    appliesTo: (_extension, lang) => lang !== null && lang !== "json",
    transform: (filePath, sourceText) => {
      const lang = getSourceLanguage(filePath);
      if (lang === null || lang === "json") return null;
      const result = parseWithSchema(
        babelResultSchema,
        babel.transformSync(sourceText, {
          filename: filePath,
          babelrc: false,
          configFile: false,
          plugins: [plugin],
          parserOpts: { sourceType: "unambiguous", plugins: getBabelParserPlugins(lang) },
          retainLines: true,
          compact: false,
        }),
        `${PLUGIN_ENTRY} transform of ${filePath}`,
      );
      return result === null ? null : { sourceText: result.code, lang };
    },
  };
};
