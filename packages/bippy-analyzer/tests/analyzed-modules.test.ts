import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vite-plus/test";
import { isModuleRecord, ModuleGraph } from "../src/graph/module-graph.js";
import { ModuleResolver } from "../src/graph/module-resolver.js";

it("analyzes an explicit framework module and its relative dependencies only", () => {
  const directory = mkdtempSync(join(tmpdir(), "bippy-analyzed-modules-"));
  try {
    const packageDirectory = join(directory, "node_modules/framework-kit");
    mkdirSync(packageDirectory, { recursive: true });
    writeFileSync(
      join(packageDirectory, "package.json"),
      JSON.stringify({ name: "framework-kit", main: "entry.ts" }),
    );
    writeFileSync(
      join(packageDirectory, "entry.ts"),
      'export { value } from "./helper"; import "another-package";',
    );
    writeFileSync(join(packageDirectory, "helper.ts"), 'export { value } from "./value";');
    writeFileSync(join(packageDirectory, "value.ts"), "export const value = 42;");
    writeFileSync(join(packageDirectory, "unrelated.ts"), "export const unrelated = 1;");
    const dependencyDirectory = join(directory, "node_modules/another-package");
    mkdirSync(dependencyDirectory, { recursive: true });
    writeFileSync(
      join(dependencyDirectory, "package.json"),
      JSON.stringify({ name: "another-package", main: "index.ts" }),
    );
    writeFileSync(join(dependencyDirectory, "index.ts"), "export const dependency = 1;");
    const graph = new ModuleGraph({ resolver: new ModuleResolver({ rootDirectory: directory }) });
    const application = graph.addVirtualModule(
      join(directory, "app.ts"),
      'export { value } from "framework-kit";',
    );
    expect(application).not.toBeNull();
    if (!application) throw new Error("Missing application module");
    expect(isModuleRecord(graph.resolveImportedModule("framework-kit", application))).toBe(false);
    const entry = graph.analyzeModule(join(packageDirectory, "entry.ts"));
    expect(entry).not.toBeNull();
    if (!entry) throw new Error("Missing framework entry");
    expect(graph.resolveImportedModule("framework-kit", application)).toBe(entry);
    expect(graph.resolveExport(application, "value").kind).toBe("binding");
    const helper = graph.resolveImportedModule("./helper", entry);
    expect(isModuleRecord(helper)).toBe(true);
    if (!isModuleRecord(helper)) throw new Error("Missing relative dependency");
    expect(isModuleRecord(graph.resolveImportedModule("./value", helper))).toBe(true);
    expect(isModuleRecord(graph.resolveImportedModule("another-package", entry))).toBe(false);
    expect(
      isModuleRecord(graph.resolveImportedModule("framework-kit/unrelated", application)),
    ).toBe(false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
