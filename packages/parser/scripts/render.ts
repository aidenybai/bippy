import path from "node:path";
import { formatPattern, getRenderPattern } from "../src/harness/index.js";
import { createStaticRenderer } from "../src/index.js";

const [, , rootArg, entryArg, exportName] = process.argv;
const rootDirectory = path.resolve(rootArg ?? ".");
const renderer = createStaticRenderer({
  rootDirectory,
  tsconfigPath: path.join(rootDirectory, "tsconfig.json"),
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
