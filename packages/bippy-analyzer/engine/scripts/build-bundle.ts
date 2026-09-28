import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { transformAsync } from "@babel/core";
import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";
import { nodeResolve } from "@rollup/plugin-node-resolve";
import { rollup, type Plugin } from "rollup";
import macros from "../vendor/transform.mjs";
import source from "../source.json" with { type: "json" };
import { EngineBuildCleanupError, EngineBuildError } from "../errors.js";
import { engineDirectory } from "../manifest.js";
import { lowerGenerators } from "./lower-generators.js";
import { controlSpecifier, capturesSpecifier } from "./control-paths.js";

const require = createRequire(import.meta.url);
const normalize = (filename: string): string => filename.split(sep).join("/");

const getSourceName = (filename: string, sourceDirectory: string): string => {
  const relativeName = relative(sourceDirectory, filename);
  if (!relativeName.startsWith("..") && !isAbsolute(relativeName))
    return `engine262/${normalize(relativeName)}`;
  const normalized = normalize(filename);
  const dependency = normalized.lastIndexOf("/node_modules/");
  if (dependency !== -1) return normalized.slice(dependency + 1);
  throw new EngineBuildError(`Unrecognized engine source-map input: ${filename}`);
};

const getEnginePlugin = (sourceDirectory: string): Plugin => ({
  name: "engine262-source",
  resolveId(specifier) {
    if (specifier === "#self") return join(sourceDirectory, "src/index.mts");
    if (specifier === controlSpecifier)
      return join(sourceDirectory, "src/host-defined/control/execution-machine.mts");
    if (specifier === capturesSpecifier)
      return join(sourceDirectory, "src/host-defined/control/native-captures.mts");
  },
  async transform(code, filename) {
    if (
      filename.endsWith("/Case_Folding/C/symbols.js") ||
      filename.endsWith("/Case_Folding/S/symbols.js")
    ) {
      const symbols: unknown = require(filename);
      if (
        !(symbols instanceof Map) ||
        Array.from(symbols).some(
          ([key, value]) => typeof key !== "string" || typeof value !== "string",
        )
      )
        throw new EngineBuildError("Unexpected Unicode case-folding data");
      return {
        code: `export default new Map(${JSON.stringify(Array.from(symbols))});`,
        map: { mappings: "" },
      };
    }
    if (!filename.startsWith(sourceDirectory + sep) || !filename.endsWith(".mts")) return null;
    const result = await transformAsync(code, {
      filename,
      babelrc: false,
      configFile: false,
      sourceMaps: true,
      presets: [[require.resolve("@babel/preset-typescript"), {}]],
      plugins: [
        macros,
        [require.resolve("@babel/plugin-proposal-decorators"), { version: "2023-11" }],
      ],
    });
    if (!result?.code || !result.map)
      throw new EngineBuildError(`Engine transform produced no code or source map: ${filename}`);
    if (filename.startsWith(join(sourceDirectory, "src/host-defined/control") + sep))
      return { code: result.code, map: JSON.stringify(result.map) };
    const lowered = await lowerGenerators(result.code, filename, result.map);
    return { code: lowered.code, map: JSON.stringify(lowered.map) };
  },
});

export const buildBundle = async (
  sourceDirectory: string,
  outputDirectory: string,
): Promise<void> => {
  const license = await readFile(join(engineDirectory, "vendor/LICENSE"), "utf8");
  const controlLicense = await readFile(join(engineDirectory, "extensions/LICENSE"), "utf8");
  const bundle = await rollup({
    input: join(sourceDirectory, "src/index.mts"),
    plugins: [
      getEnginePlugin(sourceDirectory),
      (json.default || json)({ compact: true }),
      (commonjs.default || commonjs)(),
      nodeResolve({ extensions: [".mts", ".mjs", ".js", ".json"] }),
    ],
    onLog(level, log, handler) {
      if (log.code === "CIRCULAR_DEPENDENCY") return;
      if (level === "warn") throw new EngineBuildError(`Engine build warning: ${log.message}`);
      handler(level, log);
    },
  });
  let failure: unknown;
  let isFailed = false;
  try {
    await bundle.write({
      file: join(outputDirectory, "engine.mjs"),
      format: "es",
      sourcemap: true,
      sourcemapPathTransform: (filename, mapFilename) =>
        getSourceName(resolve(dirname(mapFilename), filename), sourceDirectory),
      banner: `/*! engine262 ${source.revision}, bippy evaluation hook\n${license
        .split("\n")
        .map((line) => ` * ${line}`)
        .join("\n")}\n${controlLicense
        .split("\n")
        .map((line) => ` * ${line}`)
        .join("\n")}\n */`,
    });
  } catch (error) {
    isFailed = true;
    failure = error;
  }
  try {
    await bundle.close();
  } catch (error) {
    if (isFailed) throw new EngineBuildCleanupError(failure, error);
    throw error;
  }
  if (isFailed) throw failure;
};
