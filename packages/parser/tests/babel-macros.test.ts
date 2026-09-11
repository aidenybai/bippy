import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { formatPattern, getRenderPattern } from "../src/harness/index.js";
import { createStaticRenderer } from "../src/render/static-renderer.js";
import { createBabelMacrosTransform } from "../src/graph/babel-macros.js";

const APP = join(import.meta.dirname, "fixtures/cra-macros");

describe("CRA Babel macros", () => {
  it("does not enable CRA macros for another bundler", async () => {
    expect(await createBabelMacrosTransform(APP, "vite", undefined)).toBeNull();
  });

  it("restores the process and DOM when a macro fails", async () => {
    const environmentBefore = process.env;
    const directoryBefore = process.cwd();
    const windowBefore = globalThis.window;
    const transform = await createBabelMacrosTransform(APP, "react-scripts", undefined);
    expect(transform).not.toBeNull();
    if (!transform) return;
    expect(() =>
      transform.transform(
        join(APP, "src/missing.tsx"),
        'import value from "missing-bippy.macro"; export default value;',
        null,
      ),
    ).toThrow();
    expect(process.env).toBe(environmentBefore);
    expect(process.cwd()).toBe(directoryBefore);
    expect(globalThis.window).toBe(windowBefore);
    expect(transform.transform(join(APP, "node_modules/dependency/index.js"), "", null)).toBeNull();
  });

  it("resolves macros from a symlinked dev directory", async () => {
    const directory = mkdtempSync(join(tmpdir(), "bippy-macros-"));
    const alias = join(directory, "app");
    symlinkSync(APP, alias, "dir");
    try {
      const renderer = await createStaticRenderer({ rootDirectory: APP, devDirectory: alias });
      const rendered = await renderer.renderComponent(join(APP, "src/app.tsx"));
      expect(formatPattern(getRenderPattern(rendered))).toContain('"configured"');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("runs the installed macro in Node without executing the application", async () => {
    const windowBefore = globalThis.window;
    Reflect.deleteProperty(globalThis, "__bippyMacroApplicationRan");
    const renderer = await createStaticRenderer({ rootDirectory: APP });
    const rendered = await renderer.renderComponent(join(APP, "src/app.tsx"));
    expect(formatPattern(getRenderPattern(rendered))).toContain('"configured"');
    expect(Reflect.get(globalThis, "__bippyMacroApplicationRan")).toBeUndefined();
    expect(globalThis.window).toBe(windowBefore);
    expect(rendered.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual(
      [],
    );
  });
});
