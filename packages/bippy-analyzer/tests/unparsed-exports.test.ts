import { buildSync } from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire, wrap } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Script } from "node:vm";
import { parseSync } from "oxc-parser";
import { describe, expect, it } from "vite-plus/test";
import { ModuleGraph } from "../src/graph/module-graph.js";
import { ModuleResolver } from "../src/graph/module-resolver.js";
import { parseSourceText, SourceFileCache } from "../src/parse/parse-source-file.js";
import type { SourceTransform } from "../src/parse/source-types.js";

interface ParserCase {
  name: string;
  extension: "mjs" | "cjs";
  source: string;
  hasErrors: boolean;
  hasStatements: boolean;
  isNativeValid: boolean;
}
interface UnparsedExportCase {
  name: string;
  entry: string;
  nested?: string;
  expected: "uncertain" | "binding" | "ambiguous" | "missing";
  complete: boolean;
  exportedName?: string;
}

const requireDependency = createRequire(join(import.meta.dirname, "../package.json"));
const parseCases: ParserCase[] = [
  {
    name: "valid empty source",
    extension: "mjs",
    source: "",
    hasErrors: false,
    hasStatements: false,
    isNativeValid: true,
  },
  {
    name: "empty module",
    extension: "mjs",
    source: "export {};",
    hasErrors: false,
    hasStatements: true,
    isNativeValid: true,
  },
  {
    name: "valid declaration",
    extension: "mjs",
    source: "export const value = 1;",
    hasErrors: false,
    hasStatements: true,
    isNativeValid: true,
  },
  {
    name: "missing initializer",
    extension: "mjs",
    source: "export const value = ;",
    hasErrors: true,
    hasStatements: false,
    isNativeValid: false,
  },
  {
    name: "discarded declaration prefix",
    extension: "mjs",
    source: "export const value = 1; const unfinished = ;",
    hasErrors: true,
    hasStatements: false,
    isNativeValid: false,
  },
  {
    name: "unreported duplicate binding",
    extension: "mjs",
    source: "export const value = 1; const value = 2;",
    hasErrors: false,
    hasStatements: true,
    isNativeValid: false,
  },
  {
    name: "unreported missing local export",
    extension: "mjs",
    source: "export { absent as value };",
    hasErrors: false,
    hasStatements: true,
    isNativeValid: false,
  },
  {
    name: "reported duplicate default",
    extension: "mjs",
    source: "export default 1; export default 2;",
    hasErrors: true,
    hasStatements: true,
    isNativeValid: false,
  },
  {
    name: "valid CommonJS with",
    extension: "cjs",
    source: "with ({}) {} exports.value = 1;",
    hasErrors: false,
    hasStatements: true,
    isNativeValid: true,
  },
  {
    name: "reported valid CommonJS return",
    extension: "cjs",
    source: "exports.value = 1; return;",
    hasErrors: true,
    hasStatements: true,
    isNativeValid: true,
  },
  {
    name: "valid CommonJS octal",
    extension: "cjs",
    source: "exports.value = 010;",
    hasErrors: false,
    hasStatements: true,
    isNativeValid: true,
  },
  {
    name: "unreported strict CommonJS with",
    extension: "cjs",
    source: '"use strict"; with ({}) {} exports.value = 1;',
    hasErrors: false,
    hasStatements: true,
    isNativeValid: false,
  },
  {
    name: "unreported module with",
    extension: "mjs",
    source: "with ({}) {} exports.value = 1;",
    hasErrors: false,
    hasStatements: true,
    isNativeValid: false,
  },
  {
    name: "unreported CommonJS static import",
    extension: "cjs",
    source: 'import value from "missing"; exports.value = value;',
    hasErrors: false,
    hasStatements: true,
    isNativeValid: false,
  },
];
const exportCases: UnparsedExportCase[] = [
  {
    name: "one unparsed star",
    entry: 'export * from "SOURCE";',
    expected: "uncertain",
    complete: false,
  },
  {
    name: "an unparsed star beside a known binding",
    entry: 'export * from "SOURCE"; export * from "./local";',
    expected: "uncertain",
    complete: false,
  },
  {
    name: "nested unparsed stars",
    entry: 'export * from "./nested"; export * from "./local";',
    nested: 'export * from "SOURCE";',
    expected: "uncertain",
    complete: false,
  },
  {
    name: "a named re-export from an unparsed module",
    entry: 'export * from "./nested"; export * from "./local";',
    nested: 'export { value } from "SOURCE";',
    expected: "uncertain",
    complete: true,
  },
  {
    name: "a local re-export from an unparsed module",
    entry: 'export * from "./nested"; export * from "./local";',
    nested: 'import { value } from "SOURCE"; export { value };',
    expected: "uncertain",
    complete: true,
  },
  {
    name: "an unparsed module without a matching known sibling",
    entry: 'export * from "SOURCE"; export * from "./empty";',
    expected: "uncertain",
    complete: false,
  },
  {
    name: "explicit declarations do not prove successful parsing of dependencies",
    entry: 'export * from "SOURCE"; export const value = 3;',
    expected: "binding",
    complete: false,
  },
  {
    name: "known conflicts survive an unparsed source",
    entry: 'export * from "SOURCE"; export * from "./local"; export * from "./other";',
    expected: "ambiguous",
    complete: false,
  },
  {
    name: "default exclusion is distinct from dependency parsing",
    entry: 'export * from "SOURCE";',
    exportedName: "default",
    expected: "missing",
    complete: false,
  },
];
const brokenSource = "export const value = 1; const unfinished = ;";
const withDirectory = (check: (directory: string) => void): void => {
  const directory = mkdtempSync(join(tmpdir(), "bippy-unparsed-exports-"));
  try {
    check(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};
const setSources = (directory: string, sources: Record<string, string>): void => {
  for (const [filename, source] of Object.entries(sources)) {
    const filePath = join(directory, filename);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, source);
  }
};
const getNativeLink = (filename: string) =>
  spawnSync(
    process.execPath,
    [
      "--experimental-vm-modules",
      "--experimental-import-meta-resolve",
      "--import",
      requireDependency.resolve("tsx"),
      join(import.meta.dirname, "helpers/link-module-graph.ts"),
      filename,
    ],
    { encoding: "utf8" },
  );

describe("parser diagnostics are not full validity or format checks", () => {
  it.each(parseCases)("$name", ({ extension, source, hasErrors, hasStatements, isNativeValid }) =>
    withDirectory((directory) => {
      const filename = join(directory, `entry.${extension}`);
      writeFileSync(filename, source);
      const parsed = parseSourceText(filename, source, "js");
      expect(parsed.errors.length > 0).toBe(hasErrors);
      expect(parsed.program.body.length > 0).toBe(hasStatements);
      const graph = new ModuleGraph({ resolver: new ModuleResolver({ rootDirectory: directory }) });
      const module = graph.getModule(filename);
      expect(module?.file.errors).toEqual(parsed.errors);
      if (!hasErrors && !hasStatements && module) {
        expect(graph.resolveExport(module, "value")).not.toHaveProperty("isUncertain");
        expect(graph.collectExportNames(module)).toEqual({ names: [], complete: true });
      }
      if (hasErrors && !hasStatements && module) {
        expect(graph.resolveExport(module, "value")).toMatchObject({
          kind: "unresolved",
          isUncertain: true,
        });
        expect(graph.collectExportNames(module)).toEqual({ names: [], complete: false });
      }
      const virtual = graph.addVirtualModule(join(directory, `virtual.${extension}`), source);
      expect(virtual === null).toBe(hasErrors);
      const contextual = parseSync(filename, source, {
        lang: "js",
        sourceType: extension === "cjs" ? "commonjs" : "module",
        showSemanticErrors: true,
      });
      expect(contextual.errors.length === 0).toBe(isNativeValid);
      if (extension === "cjs") {
        const compile = () => new Script(wrap(source));
        if (isNativeValid) expect(compile).not.toThrow();
        else expect(compile).toThrow(SyntaxError);
      } else {
        const linked = getNativeLink(filename);
        expect(linked.error).toBeUndefined();
        expect(linked.status, linked.stderr).toBe(isNativeValid ? 0 : 1);
        if (!isNativeValid) expect(linked.stderr).toMatch(/SyntaxError/);
      }
    }),
  );
});

it.each(
  exportCases.flatMap((entry) =>
    ["disk", "query", "virtual"].map((input) => ({ ...entry, input })),
  ),
)(
  "$name ($input)",
  ({ entry, nested = "export {};", input, expected, complete, exportedName = "value" }) =>
    withDirectory((directory) => {
      const request = input === "query" ? "./bad.ts?broken" : "./bad.ts";
      const getSources = (specifier: string, badSource: string): Record<string, string> => ({
        "entry.ts": entry.replaceAll("SOURCE", specifier),
        "nested.ts": nested.replaceAll("SOURCE", specifier),
        "local.ts": "export const value = 1;",
        "other.ts": "export const value = 1;",
        "empty.ts": "export {};",
        "bad.ts": badSource,
      });
      setSources(
        directory,
        getSources(request, input === "disk" ? brokenSource : "export const value = 1;"),
      );
      const transform: SourceTransform = {
        appliesTo: (_extension, _language, query) => query === "broken",
        transform: () => ({ sourceText: brokenSource, lang: "ts" }),
      };
      const graph = new ModuleGraph({
        resolver: new ModuleResolver({ rootDirectory: directory }),
        sourceFileCache: new SourceFileCache(input === "query" ? [transform] : []),
      });
      const badFile = join(directory, "bad.ts");
      if (input === "virtual") expect(graph.addVirtualModule(badFile, brokenSource)).toBeNull();
      const module = graph.getModule(join(directory, "entry.ts"));
      if (!module) throw new Error("Missing entry");
      const result = graph.resolveExport(module, exportedName);
      if (expected === "uncertain") {
        expect(result).toMatchObject({ kind: "unresolved", isUncertain: true });
        expect(result).not.toHaveProperty("isAmbiguous");
      } else if (expected === "ambiguous")
        expect(result).toMatchObject({ kind: "unresolved", isAmbiguous: true });
      else if (expected === "missing") {
        expect(result.kind).toBe("unresolved");
        expect(result).not.toHaveProperty("isUncertain");
      } else expect(result.kind).toBe("binding");
      expect(graph.collectExportNames(module).complete).toBe(complete);
      if (input === "query") {
        const target = graph.resolveImportedModule(request, module);
        if (!("file" in target)) throw new Error("Missing transformed record");
        expect(target.file.errors.length).toBeGreaterThan(0);
        expect(target.file.sourceText).toBe(brokenSource);
        expect(graph.getModule(badFile)?.file.errors).toEqual([]);
      }
      const nativeDirectory = join(directory, "native");
      setSources(nativeDirectory, getSources("./bad.ts", brokenSource));
      const consumer = join(nativeDirectory, "consumer.ts");
      writeFileSync(
        consumer,
        `import { ${exportedName} as importedValue } from "./entry"; export const result = importedValue; throw new Error("Linking must not evaluate applications");`,
      );
      const linked = getNativeLink(consumer);
      expect(linked.error).toBeUndefined();
      expect(linked.status).toBe(1);
      expect(linked.stderr).toMatch(/SyntaxError/);
      expect(() =>
        buildSync({
          entryPoints: [consumer],
          bundle: true,
          write: false,
          format: "esm",
          logLevel: "silent",
        }),
      ).toThrow(/Unexpected/);
    }),
);
