import path from "node:path";
import { parseArgs } from "node:util";
import { describeValue } from "../src/evaluate/values.js";
import { createStaticRenderer } from "../src/index.js";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { packages: { type: "string", multiple: true, default: [] } },
});
const [rootArg, fileArg, exportName = "default"] = positionals;
if (!rootArg || !fileArg) {
  console.error(
    "usage: tsx scripts/debug-export.ts [--packages <name>]... <root> <file> [exportName]",
  );
  process.exit(1);
}
const rootDirectory = path.resolve(rootArg);
const renderer = createStaticRenderer({
  rootDirectory,
  tsconfigPath: path.join(rootDirectory, "tsconfig.json"),
  externalPackageAllowList: values.packages,
});
const result = await renderer.renderWith((interpreter) => {
  const module = renderer.loadModule(path.resolve(rootDirectory, fileArg));
  if (!module) throw new Error(`could not parse ${fileArg}`);
  const exported = interpreter.evaluateModuleExport(module, exportName);
  console.log("export:", describeValue(exported));
  if (exported.kind === "function" || exported.kind === "native-function") {
    const called = interpreter.callValue(
      exported,
      [],
      interpreter.createModuleContext(module),
      null,
    );
    console.log("call():", describeValue(called));
    console.log(
      JSON.stringify(
        called,
        (key, value) =>
          key === "node" || key === "location"
            ? undefined
            : typeof value === "bigint"
              ? String(value)
              : value,
        1,
      ).slice(0, 4000),
    );
  }
  return exported;
});
for (const diagnostic of result.diagnostics) {
  console.log(`[${diagnostic.severity}] ${diagnostic.code}: ${diagnostic.message}`);
}
