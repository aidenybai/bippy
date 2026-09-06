import { join, resolve } from "node:path";
import { createStaticRenderer, formatFiber } from "../src/index.js";

const [, , fixtureFile] = process.argv;
if (!fixtureFile) {
  console.error("usage: tsx scripts/debug-fixture.ts <tests/components/file>");
  process.exit(1);
}

const componentsDirectory = resolve(import.meta.dirname, "../tests/components");
const renderer = createStaticRenderer({
  rootDirectory: componentsDirectory,
  tsconfigPath: join(componentsDirectory, "tsconfig.json"),
});
const result = renderer.renderComponent(resolve(componentsDirectory, fixtureFile));
console.log(formatFiber(result.root, { rootDirectory: componentsDirectory }));
for (const diagnostic of result.diagnostics) {
  console.log(`[${diagnostic.severity}] ${diagnostic.code}: ${diagnostic.message}`);
}
