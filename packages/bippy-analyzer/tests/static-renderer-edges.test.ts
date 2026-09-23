import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { ParserError } from "../src/errors.js";
import { createStaticRenderer, StaticRenderer } from "../src/render/static-renderer.js";

const writeApp = (): string => {
  const root = mkdtempSync(join(import.meta.dirname, "../.tmp-static-renderer-"));
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "static-renderer-edges", private: true }));
  writeFileSync(
    join(root, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: { jsx: "react-jsx", strict: true, module: "esnext", moduleResolution: "bundler" },
    }),
  );
  writeFileSync(join(root, "index.html"), '<div id="root"></div>');
  writeFileSync(
    join(root, "src/register.tsx"),
    'export const register = (value: string) => value;\nexport const unused = 1;\n',
  );
  writeFileSync(join(root, "src/alias-mod.tsx"), 'export const label = "aliased";\n');
  writeFileSync(
    join(root, "src/main.tsx"),
    [
      'import { createRoot } from "react-dom/client";',
      'import { createElement } from "react";',
      'import { label } from "alias-mod";',
      'createRoot(document.getElementById("root")!).render(createElement("main", null, label));',
    ].join("\n"),
  );
  writeFileSync(
    join(root, "src/plain.tsx"),
    'export const value = "no render";\n',
  );
  writeFileSync(
    join(root, "src/twice.tsx"),
    [
      'import { createRoot } from "react-dom/client";',
      'import { createElement } from "react";',
      'const root = document.getElementById("root")!;',
      'createRoot(root).render(createElement("main"));',
      'createRoot(root).render(createElement("section"));',
    ].join("\n"),
  );
  writeFileSync(
    join(root, "src/boom.tsx"),
    [
      'import { createRoot } from "react-dom/client";',
      'import { createElement } from "react";',
      "const Boom = () => {",
      '  throw new Error("boom");',
      "};",
      'createRoot(document.getElementById("root")!).render(createElement(Boom));',
    ].join("\n"),
  );
  writeFileSync(
    join(root, "src/aborted.tsx"),
    [
      'import { createRoot } from "react-dom/client";',
      'import { createElement } from "react";',
      "if (true) {",
      '  throw new Error("stop");',
      '  createRoot(document.getElementById("root")!).render(createElement("main"));',
      "}",
    ].join("\n"),
  );
  writeFileSync(
    join(root, "src/nested.tsx"),
    [
      'import { createRoot } from "react-dom/client";',
      'import { createElement } from "react";',
      "if (true) {",
      "  if (true) {",
      '    createRoot(document.getElementById("root")!).render(createElement("article"));',
      "  }",
      "}",
    ].join("\n"),
  );
  return root;
};

const messages = (diagnostics: { message: string }[]): string[] =>
  diagnostics.map((diagnostic) => diagnostic.message);

describe("static renderer edges", () => {
  it("rejects a non-string Vite NODE_ENV define", () => {
    const root = writeApp();
    try {
      expect(
        () =>
          new StaticRenderer(
            { rootDirectory: root, defines: { "process.env.NODE_ENV": 1 } },
            {
              viteEnvironment: {
                values: {},
                defines: {},
                nodeEnvironment: "development",
              },
            },
          ),
      ).toThrow(ParserError);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports bootstrap calls and root-render shapes", async () => {
    const root = writeApp();
    try {
      const renderer = await createStaticRenderer({
        rootDirectory: root,
        aliases: { "alias-mod": "src/alias-mod.tsx" },
        bootstrap: [
          "not a bootstrap",
          "src/missing.tsx#register",
          "src/register.tsx#register",
          "src/register.tsx#register( , config )",
          "src/register.tsx#missing",
        ],
        globals: { config: "ready" },
      });
      const rendered = await renderer.renderEntry("src/main.tsx");
      expect(messages(rendered.diagnostics)).toEqual(
        expect.arrayContaining([
          'bootstrap "not a bootstrap" is not a parseable path#export(globals)',
          'bootstrap "src/missing.tsx#register" is not a parseable path#export(globals)',
        ]),
      );
      expect(rendered.diagnostics.some((diagnostic) => diagnostic.message.includes("src/register.tsx#register"))).toBe(
        false,
      );
      const plain = await renderer.renderEntry("src/plain.tsx");
      expect(messages(plain.diagnostics).some((message) => message.includes("no createRoot().render"))).toBe(true);
      const twice = await renderer.renderEntry("src/twice.tsx");
      expect(messages(twice.diagnostics).some((message) => message.includes("2 root render calls"))).toBe(true);
      const boom = await renderer.renderEntry("src/boom.tsx");
      expect(messages(boom.diagnostics).some((message) => message.includes("boom"))).toBe(true);
      const aborted = await renderer.renderEntry("src/aborted.tsx");
      expect(aborted.snapshot).toBeDefined();
      const nested = await renderer.renderEntry("src/nested.tsx");
      expect(nested.diagnostics.filter((diagnostic) => diagnostic.code === "multiple-root-renders")).toEqual([]);
      await renderer.transformDocumentShell(async (html) => html);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
