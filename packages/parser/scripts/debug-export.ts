import { readFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { describeValue } from "../src/evaluate/values.js";
import { createStaticRenderer } from "../src/index.js";
import { readObservationsJson } from "../src/observations.js";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    packages: { type: "string", multiple: true, default: [] },
    route: { type: "string" },
    capture: { type: "string" },
    alias: { type: "string", multiple: true, default: [] },
  },
});
const [rootArg, fileArg, exportName = "default"] = positionals;
if (!rootArg || !fileArg) {
  console.error(
    "usage: tsx scripts/debug-export.ts [--packages <name>]... [--alias <specifier>=<path>]... [--route <path>] [--capture <capture.json>] <root> <file> [exportName]",
  );
  process.exit(1);
}
const rootDirectory = path.resolve(rootArg);
const observations =
  values.capture === undefined
    ? undefined
    : readObservationsJson(
        JSON.parse(readFileSync(values.capture, "utf8")).observations,
        values.capture,
      );
const aliases = Object.fromEntries(
  values.alias.map((entry) => {
    const separator = entry.indexOf("=");
    if (separator === -1) throw new Error(`--alias expects <specifier>=<path>, got ${entry}`);
    return [entry.slice(0, separator), entry.slice(separator + 1)];
  }),
);
const renderer = await createStaticRenderer({
  rootDirectory,
  tsconfigPath: path.join(rootDirectory, "tsconfig.json"),
  externalPackageAllowList: values.packages,
  aliases,
  route: values.route,
  observations,
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
          key === "node" || key === "location" || key === "module" || key === "scope"
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
  const location = diagnostic.location
    ? ` (${diagnostic.location.filePath}:${diagnostic.location.line}:${diagnostic.location.column})`
    : "";
  console.log(`[${diagnostic.severity}] ${diagnostic.code}: ${diagnostic.message}${location}`);
}
