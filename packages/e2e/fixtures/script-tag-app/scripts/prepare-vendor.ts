// Vendors the React 18 UMD builds and bundles bippy into a classic-script
// IIFE so the static pages can exercise the no-bundler integration path.
import { build } from "esbuild";
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const fixtureDirectory = path.resolve(import.meta.dirname, "..");
const vendorDirectory = path.join(fixtureDirectory, "public/vendor");
const fixtureRequire = createRequire(path.join(fixtureDirectory, "package.json"));

const UMD_BUILDS: ReadonlyMap<string, readonly string[]> = new Map([
  ["react-18", ["react.development.js", "react.production.min.js"]],
  ["react-dom-18", ["react-dom.development.js", "react-dom.production.min.js"]],
]);

mkdirSync(vendorDirectory, { recursive: true });

for (const [packageName, umdFileNames] of UMD_BUILDS) {
  const packageDirectory = path.dirname(fixtureRequire.resolve(`${packageName}/package.json`));
  for (const umdFileName of umdFileNames) {
    copyFileSync(
      path.join(packageDirectory, "umd", umdFileName),
      path.join(vendorDirectory, umdFileName),
    );
  }
}

await build({
  bundle: true,
  entryPoints: [path.join(fixtureDirectory, "scripts/bippy-entry.ts")],
  format: "iife",
  globalName: "Bippy",
  outfile: path.join(vendorDirectory, "bippy.iife.js"),
  define: {
    "process.env.NODE_ENV": '"development"',
    "process.env.VERSION": '"e2e"',
  },
});
