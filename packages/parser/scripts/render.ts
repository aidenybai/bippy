import path from "node:path";
import { parseArgs } from "node:util";
import { formatPattern, getRenderPattern } from "../src/harness/index.js";
import { createStaticRenderer } from "../src/index.js";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    packages: { type: "string", multiple: true, default: [] },
    "all-packages": { type: "boolean", default: false },
    route: { type: "string" },
  },
});
const [rootArg, entryArg, exportName] = positionals;
if (!rootArg || !entryArg) {
  console.error(
    "usage: tsx scripts/render.ts [--packages <name>]... [--all-packages] [--route <path>] <root> <entry> [exportName]",
  );
  process.exit(1);
}
const rootDirectory = path.resolve(rootArg);
const renderer = await createStaticRenderer({
  rootDirectory,
  tsconfigPath: path.join(rootDirectory, "tsconfig.json"),
  externalPackageAllowList: values.packages,
  resolveExternalPackages: values["all-packages"],
  route: values.route,
});
const result = await (exportName
  ? renderer.renderComponent(entryArg, { exportName })
  : renderer.renderEntry(entryArg));
console.log(formatPattern(getRenderPattern(result)));
console.log("\nstats", result.stats);
for (const diagnostic of result.diagnostics) {
  console.log(
    `[${diagnostic.severity}] ${diagnostic.code}: ${diagnostic.message}${diagnostic.location ? ` (${diagnostic.location.filePath}:${diagnostic.location.line})` : ""}`,
  );
}
// HACK: the scheduler of React 16/17 keeps a MessageChannel port open, holding the process alive after the work is done.
process.exit(0);
