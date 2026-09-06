import path from "node:path";
import { createStaticRenderer, formatFiber } from "../src/index.js";

const [, , rootArg, entryArg, exportName] = process.argv;
const rootDirectory = path.resolve(rootArg ?? ".");
const renderer = createStaticRenderer({
  rootDirectory,
  tsconfigPath: path.join(rootDirectory, "tsconfig.json"),
});
const result = exportName
  ? renderer.renderComponent(entryArg, { exportName })
  : renderer.renderEntry(entryArg);
console.log(
  formatFiber(result.root, {
    showProps: true,
    showLocations: true,
    showNotes: true,
    rootDirectory,
  }),
);
console.log("\nstats", result.stats);
for (const diagnostic of result.diagnostics) {
  console.log(
    `[${diagnostic.severity}] ${diagnostic.code}: ${diagnostic.message}${diagnostic.location ? ` (${diagnostic.location.filePath}:${diagnostic.location.line})` : ""}`,
  );
}
