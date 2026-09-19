import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { expect, it } from "vite-plus/test";
import { createStaticRenderer } from "../src/index.js";

const writeSource = (rootDirectory: string, fileName: string, source: string): string => {
  const filePath = join(rootDirectory, fileName);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, source);
  return filePath;
};

it("loads only demanded modules from side-effect-free packages", async () => {
  const rootDirectory = mkdtempSync(join(import.meta.dirname, "package-side-effects-"));
  try {
    const packageDirectory = join(rootDirectory, "node_modules/icon-package");
    writeSource(
      packageDirectory,
      "package.json",
      JSON.stringify({
        name: "icon-package",
        version: "1.0.0",
        module: "index.js",
        sideEffects: false,
      }),
    );
    writeSource(
      packageDirectory,
      "index.js",
      'import "./unused.js"; export { Widget } from "./widget.jsx";',
    );
    writeSource(packageDirectory, "unused.js", "globalThis.unusedPackageModule = true;");
    writeSource(packageDirectory, "label.js", 'export const label = "ready";');
    writeSource(
      packageDirectory,
      "widget.jsx",
      'import { label } from "./label.js"; export const Widget = () => <div>{label}</div>;',
    );
    const entryPath = writeSource(
      rootDirectory,
      "entry.jsx",
      'import { Widget } from "icon-package"; export default Widget;',
    );
    const renderer = await createStaticRenderer({
      rootDirectory,
      externalPackageAllowList: ["icon-package"],
    });

    const result = await renderer.renderComponent(entryPath);

    expect(result.stats.unknownCount).toBe(0);
    expect(result.diagnostics).toEqual([]);
    expect(renderer.graph.loadedModuleCount).toBe(4);
  } finally {
    rmSync(rootDirectory, { recursive: true, force: true });
  }
});
