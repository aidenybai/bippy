import { build } from "esbuild";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { lowerGenerators } from "../../engine/scripts/lower-generators.js";

const runtimePath = resolve(import.meta.dirname, "../../engine/src/execution-machine.ts");
const capturesPath = resolve(import.meta.dirname, "../../engine/src/native-captures.ts");
const statePath = resolve(import.meta.dirname, "../../engine/src/owned-state.ts");
const require = createRequire(resolve(import.meta.dirname, "lowered-engine.ts"));

export const evaluateLowered = async (
  source: string,
  globals: Readonly<Record<string, unknown>> = {},
): Promise<unknown> => {
  const lowered = await lowerGenerators(
    `import { captureControl } from ${JSON.stringify(runtimePath)};\nimport {getNativeCaptures} from ${JSON.stringify(capturesPath)};\nimport {OwnedState} from ${JSON.stringify(statePath)};\n${source}\nexport { result };`,
    "machine-fixture.mjs",
  );
  const bundle = await build({
    stdin: { contents: lowered, resolveDir: process.cwd(), loader: "js" },
    bundle: true,
    format: "cjs",
    platform: "node",
    write: false,
  });
  const module: { exports: object } = { exports: {} };
  new Function("module", "exports", "require", ...Object.keys(globals), bundle.outputFiles[0].text)(
    module,
    module.exports,
    require,
    ...Object.values(globals),
  );
  return Reflect.get(module.exports, "result");
};
