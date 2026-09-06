import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  createStaticRenderer,
  findNearestFile,
  renderOwnerTree,
  renderSnapshotTree,
} from "../src/index.js";

const USAGE = `usage: pnpm inspect <file> [options]

  --export <name>   export to render (default: "default")
  --root <dir>      project root (default: nearest package.json directory)
  --owner           print the owner tree instead of the parent tree
  --json            print the snapshot as JSON
  --ids             show fiber ids
  --hooks           show hook calls
  --locations       show source locations
  --diagnostics     print analyzer diagnostics`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    export: { type: "string", default: "default" },
    root: { type: "string" },
    owner: { type: "boolean", default: false },
    json: { type: "boolean", default: false },
    ids: { type: "boolean", default: false },
    hooks: { type: "boolean", default: false },
    locations: { type: "boolean", default: false },
    diagnostics: { type: "boolean", default: false },
  },
});

const [fileArgument] = positionals;
if (!fileArgument) {
  console.error(USAGE);
  process.exit(1);
}
const filePath = resolve(fileArgument);
if (!existsSync(filePath)) {
  console.error(`no such file: ${filePath}`);
  process.exit(1);
}
const packageJson = findNearestFile(dirname(filePath), ["package.json"], "/");
const rootDirectory = values.root
  ? resolve(values.root)
  : packageJson
    ? dirname(packageJson)
    : dirname(filePath);

const renderer = createStaticRenderer({ rootDirectory });
const result = renderer.renderExport(filePath, values.export);
const renderOptions = {
  showIds: values.ids,
  showHooks: values.hooks,
  showLocations: values.locations,
};

if (values.json) {
  console.log(JSON.stringify(result.snapshot, null, 2));
} else {
  console.log(
    values.owner
      ? renderOwnerTree(result.snapshot, renderOptions)
      : renderSnapshotTree(result.snapshot, renderOptions),
  );
  console.log(`\n${result.root.fiberCount} fibers, ${result.root.unknownCount} unknown`);
}
if (values.diagnostics && result.diagnostics.length > 0) {
  console.log("\ndiagnostics:");
  for (const diagnostic of result.diagnostics) {
    const where = diagnostic.location
      ? ` (${diagnostic.location.filePath}:${diagnostic.location.line}:${diagnostic.location.column})`
      : "";
    console.log(`  ${diagnostic.code}: ${diagnostic.message}${where}`);
  }
}
