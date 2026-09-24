import { realpathSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { parseWithSchema } from "../errors.js";
import { getDefaultExport, getInstalledModules } from "../libraries/installed-modules.js";
import { getSourceLanguage } from "../parse/parse-source-file.js";
import type { SourceTransform } from "../parse/source-types.js";
import type { ModuleBundler, ProcessEnvironment } from "../types.js";
import { functionSchema, loadWithoutDom, runWithoutDom } from "./vite-plugins.js";

const babelSchema = z.object({ transformSync: functionSchema });
const resultSchema = z.object({ code: z.string().nullable() }).nullable();
const presetSchema = z.object({ dependencies: z.record(z.string(), z.string()).optional() });
const MACROS_PLUGIN = "babel-plugin-macros";

export const createBabelMacrosTransform = async (
  projectDirectory: string,
  bundler: ModuleBundler,
  environment: ProcessEnvironment | undefined,
): Promise<SourceTransform | null> => {
  if (bundler !== "react-scripts") return null;
  const rootDirectory = realpathSync(projectDirectory);
  const installed = getInstalledModules(rootDirectory);
  const preset = installed.load(
    "babel-preset-react-app/package.json",
    "react-scripts/package.json",
  );
  if (
    preset === null ||
    !parseWithSchema(presetSchema, preset, "babel-preset-react-app").dependencies?.[MACROS_PLUGIN]
  )
    return null;
  const plugin = await loadWithoutDom(() =>
    installed.load(MACROS_PLUGIN, ["react-scripts/package.json", "babel-preset-react-app"]),
  );
  if (plugin === null) return null;
  const babel = parseWithSchema(
    babelSchema,
    await loadWithoutDom(() => installed.load("@babel/core", "react-scripts/package.json")),
    "@babel/core",
  );
  const sourceDirectory = `${path.join(rootDirectory, "src")}${path.sep}`;
  return {
    appliesTo: (_extension, language) => language !== null && language !== "json",
    transform: (filePath, sourceText) => {
      if (!filePath.startsWith(sourceDirectory)) return null;
      const lang = getSourceLanguage(filePath);
      if (lang === null || lang === "json") return null;
      const previousDirectory = process.cwd();
      const previousEnvironment = process.env;
      process.chdir(rootDirectory);
      process.env = {
        ...(environment?.isPartial ? previousEnvironment : undefined),
        ...(environment?.variables ?? previousEnvironment),
        NODE_ENV: "development",
        BABEL_ENV: "development",
      };
      try {
        const result = parseWithSchema(
          resultSchema,
          runWithoutDom(() =>
            babel.transformSync(sourceText, {
              filename: filePath,
              babelrc: false,
              configFile: false,
              plugins: [getDefaultExport(plugin)],
              parserOpts: {
                sourceType: "unambiguous",
                plugins: [
                  "classProperties",
                  ...(lang === "ts"
                    ? ["typescript"]
                    : lang === "tsx"
                      ? ["typescript", "jsx"]
                      : ["flow", "jsx"]),
                ],
              },
              retainLines: true,
              compact: false,
            }),
          ),
          `${MACROS_PLUGIN} transform of ${filePath}`,
        );
        return result === null || result.code === null ? null : { sourceText: result.code, lang };
      } finally {
        process.env = previousEnvironment;
        process.chdir(previousDirectory);
      }
    },
  };
};
