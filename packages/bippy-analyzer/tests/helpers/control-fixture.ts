import { transformAsync } from "@babel/core";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { rollup } from "rollup";
import { lowerGenerators } from "../../engine/scripts/lower-generators.js";
import { controlSpecifier, capturesSpecifier } from "../../engine/scripts/control-paths.js";

const directory = resolve(import.meta.dirname, "../../engine/extensions");
const require = createRequire(import.meta.url);

export const evaluateLowered = async (
  source: string,
  globals: Readonly<Record<string, unknown>> = {},
): Promise<unknown> => {
  const lowered = await lowerGenerators(
    `import { captureControl } from ${JSON.stringify(controlSpecifier)};\nimport { getNativeCaptures } from ${JSON.stringify(capturesSpecifier)};\n${source}\nexport { result };`,
    "control-fixture.mjs",
  );
  const bundle = await rollup({
    input: "control-fixture",
    onwarn: (warning) => {
      throw new Error(warning.message);
    },
    plugins: [
      {
        name: "control-fixture",
        resolveId: (specifier, importer) => {
          if (specifier === "control-fixture") return "\0control-fixture";
          if (specifier === controlSpecifier) return resolve(directory, "execution-machine.mts");
          if (specifier === capturesSpecifier) return resolve(directory, "native-captures.mts");
          if (specifier.startsWith(".") && importer) return resolve(dirname(importer), specifier);
        },
        load: async (filename) => {
          if (filename === "\0control-fixture") return lowered.code;
          if (filename.startsWith(directory)) {
            const result = await transformAsync(await readFile(filename, "utf8"), {
              filename,
              configFile: false,
              babelrc: false,
              presets: [require.resolve("@babel/preset-typescript")],
            });
            if (!result?.code) throw new Error("Missing fixture runtime transform");
            return result.code;
          }
        },
      },
    ],
  });
  let failure: unknown;
  let isFailed = false;
  let observation: unknown;
  try {
    const output = await bundle.generate({ format: "iife", name: "Fixture", exports: "named" });
    const chunk = output.output[0];
    if (chunk?.type !== "chunk") throw new Error("Missing fixture chunk");
    observation = runInNewContext(`${chunk.code}\nFixture.result`, globals, { timeout: 10000 });
  } catch (error) {
    isFailed = true;
    failure = error;
  }
  try {
    await bundle.close();
  } catch (error) {
    if (isFailed)
      throw new AggregateError([failure, error], "Control fixture execution and cleanup failed");
    throw error;
  }
  if (isFailed) throw failure;
  return observation;
};
