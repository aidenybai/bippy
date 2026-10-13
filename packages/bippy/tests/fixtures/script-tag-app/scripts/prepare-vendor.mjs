// Vendors the React 18 UMD builds and bundles bippy into a classic-script
// IIFE so the static pages can exercise the no-bundler integration path.
import { build } from "esbuild";
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const fixtureDirectory = path.resolve(import.meta.dirname, "..");
const vendorDirectory = path.join(fixtureDirectory, "public/vendor");
const fixtureRequire = createRequire(path.join(fixtureDirectory, "package.json"));

mkdirSync(vendorDirectory, { recursive: true });

const reactDirectory = path.dirname(fixtureRequire.resolve("react-18/package.json"));
const reactDomDirectory = path.dirname(fixtureRequire.resolve("react-dom-18/package.json"));

for (const umdFileName of ["react.development.js", "react.production.min.js"]) {
  copyFileSync(
    path.join(reactDirectory, "umd", umdFileName),
    path.join(vendorDirectory, umdFileName),
  );
}
for (const umdFileName of ["react-dom.development.js", "react-dom.production.min.js"]) {
  copyFileSync(
    path.join(reactDomDirectory, "umd", umdFileName),
    path.join(vendorDirectory, umdFileName),
  );
}

await build({
  bundle: true,
  entryPoints: [path.join(fixtureDirectory, "scripts/bippy-entry.js")],
  format: "iife",
  globalName: "Bippy",
  outfile: path.join(vendorDirectory, "bippy.iife.js"),
  define: {
    "process.env.NODE_ENV": '"development"',
    "process.env.VERSION": '"e2e"',
  },
});
