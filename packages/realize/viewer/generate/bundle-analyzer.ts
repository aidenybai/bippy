import { resolve } from "node:path";
import { build } from "esbuild";

const viewerRoot = resolve(import.meta.dirname, "..");

await build({
  entryPoints: [resolve(viewerRoot, "generate/analyze-file.ts")],
  outfile: resolve(viewerRoot, ".analyzer/analyze-file.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  tsconfig: resolve(viewerRoot, "generate/tsconfig.json"),
  external: ["typescript", "tla-ts"],
  banner: {
    js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
  },
  logLevel: "warning",
});
