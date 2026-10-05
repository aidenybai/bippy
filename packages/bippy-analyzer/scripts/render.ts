import path from "node:path";
import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { formatPattern, getRenderPattern } from "../src/harness/index.js";
import { createStaticRenderer } from "../src/index.js";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    packages: { type: "string", multiple: true, default: [] },
    "all-packages": { type: "boolean", default: false },
    route: { type: "string" },
    engine: { type: "boolean", default: false },
  },
});
const [rootArg, entryArg, exportName] = positionals;
if (!rootArg || !entryArg) {
  console.error(
    "usage: tsx scripts/render.ts [--packages <name>]... [--all-packages] [--route <path>] [--engine] <root> <entry> [exportName]",
  );
  process.exit(1);
}
if (values.engine && (values.packages.length || values["all-packages"]))
  throw new Error(
    "Engine execution bundles dependency source; legacy package-model flags do not apply",
  );
const rootDirectory = path.resolve(rootArg);
const tsconfigPath = path.join(rootDirectory, "tsconfig.json");
const renderer = await createStaticRenderer({
  rootDirectory,
  tsconfigPath: existsSync(tsconfigPath) ? tsconfigPath : undefined,
  execution: values.engine ? "engine" : "interpreter",
  externalPackageAllowList: values.packages,
  resolveExternalPackages: values["all-packages"],
  route: values.route,
});
const result = await (exportName
  ? renderer.renderComponent(entryArg, { exportName })
  : renderer.renderEntry(entryArg));
console.log(formatPattern(getRenderPattern(result)));
console.log("\nstats", result.stats);
if (result.engine) console.log("engine", result.engine);
for (const diagnostic of result.diagnostics) {
  console.log(
    `[${diagnostic.severity}] ${diagnostic.code}: ${diagnostic.message}${diagnostic.location ? ` (${diagnostic.location.filePath}:${diagnostic.location.line})` : ""}`,
  );
}
// HACK: the scheduler of React 16/17 keeps a MessageChannel port open, holding the process alive after the work is done.
process.exit(result.engine && result.engine.status !== "complete" ? 1 : 0);
