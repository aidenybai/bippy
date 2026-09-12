import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vite-plus/test";
import { getInstalledModules } from "../src/libraries/installed-modules.js";
import { formatPattern, getRenderPattern } from "../src/harness/index.js";
import { createStaticRenderer } from "../src/render/static-renderer.js";
import { createBabelMacrosTransform } from "../src/graph/babel-macros.js";

interface BabelTransformOptions {
  parserOpts: { plugins: string[] };
}

const APP = join(import.meta.dirname, "fixtures/cra-macros");

describe("CRA Babel macros", () => {
  it("does not enable CRA macros for another bundler", async () => {
    expect(await createBabelMacrosTransform(APP, "vite", undefined)).toBeNull();
  });

  it.each(["js", "jsx", "ts", "tsx"])(
    "explicitly enables class field parsing before macro expansion: %s",
    async (extension) => {
      const installed = getInstalledModules(APP);
      const load = installed.load.bind(installed);
      const spy = vi.spyOn(installed, "load").mockImplementation((specifier, dependencies) => {
        const loaded = load(specifier, dependencies);
        if (specifier !== "@babel/core") return loaded;
        if (!loaded || !("transformSync" in loaded) || typeof loaded.transformSync !== "function") {
          throw new Error("Missing Babel transform");
        }
        const transformSync = loaded.transformSync;
        return {
          ...loaded,
          transformSync: (sourceText: string, options: BabelTransformOptions) => {
            expect(options.parserOpts.plugins).toContain("classProperties");
            return transformSync(sourceText, options);
          },
        };
      });
      try {
        const transform = await createBabelMacrosTransform(APP, "react-scripts", undefined);
        expect(transform).not.toBeNull();
        const result = transform?.transform(
          join(APP, `src/class-fields.${extension}`),
          'import greeting from "greeting.macro"; export class Greeting { message = greeting; }',
          null,
        );
        expect(result?.sourceText).toContain('"configured"');
        expect(result?.sourceText).toContain("message =");
      } finally {
        spy.mockRestore();
      }
    },
  );

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

  it.each([true, false])("respects partial environment declarations: %s", async (isPartial) => {
    const environmentBefore = process.env;
    process.env = { ...environmentBefore, BIPPY_INHERITED: "inherited", BIPPY_DECLARED: "parent" };
    try {
      const transform = await createBabelMacrosTransform(APP, "react-scripts", {
        variables: { BIPPY_DECLARED: "declared" },
        clientPrefix: "REACT_APP_",
        isPartial,
      });
      expect(transform).not.toBeNull();
      const transformed = transform?.transform(
        join(APP, "src/environment.ts"),
        'import { environment } from "greeting.macro"; export default environment;',
        null,
      );
      expect(transformed?.sourceText).toContain(
        JSON.stringify(`${isPartial ? "inherited" : "unset"}:declared`),
      );
      expect(process.env.BIPPY_DECLARED).toBe("parent");
    } finally {
      process.env = environmentBefore;
    }
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
