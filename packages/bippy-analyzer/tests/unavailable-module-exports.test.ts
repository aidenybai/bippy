import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { buildSync } from "esbuild";
import { expect, it } from "vite-plus/test";
import { ModuleGraph } from "../src/graph/module-graph.js";
import { ModuleResolver } from "../src/graph/module-resolver.js";
import { SourceFileCache } from "../src/parse/parse-source-file.js";
import type { ResolvedSymbol, SourceTransform } from "../src/types.js";

interface UnavailableModuleCase {
  name: string;
  entry: string;
  files?: Record<string, string>;
  expected: "uncertain" | "binding" | "ambiguous" | "missing";
  transformed?: "binding" | "ambiguous";
  nativeError: "load" | "ambiguous" | "missing" | null;
  exportedName?: string;
  removeAfterResolution?: boolean;
}

const cases: UnavailableModuleCase[] = [
  {
    name: "a missing relative star",
    entry: 'export * from "./missing";',
    expected: "uncertain",
    nativeError: "load",
  },
  {
    name: "a missing package star",
    entry: 'export * from "missing-package";',
    expected: "uncertain",
    nativeError: "load",
  },
  {
    name: "a missing star beside a known binding",
    entry: 'export * from "./missing"; export * from "./local";',
    expected: "uncertain",
    nativeError: "load",
  },
  {
    name: "nested missing stars",
    entry: 'export * from "./nested"; export * from "./local";',
    files: { "nested.ts": 'export * from "./missing";' },
    expected: "uncertain",
    nativeError: "load",
  },
  {
    name: "a missing named re-export in a barrel",
    entry: 'export * from "./nested"; export * from "./local";',
    files: { "nested.ts": 'export { value } from "./missing";' },
    expected: "uncertain",
    nativeError: "load",
  },
  {
    name: "a missing import re-exported locally",
    entry: 'export * from "./nested"; export * from "./local";',
    files: { "nested.ts": 'import { value } from "./missing"; export { value };' },
    expected: "uncertain",
    nativeError: "load",
  },
  {
    name: "a missing namespace re-export in a barrel",
    entry: 'export * from "./nested"; export * from "./local";',
    files: { "nested.ts": 'export * as value from "./missing";' },
    expected: "uncertain",
    nativeError: "load",
  },
  {
    name: "a known conflict remains a declaration conflict despite failed loading",
    entry: 'export * from "./missing"; export * from "./local"; export * from "./other";',
    expected: "ambiguous",
    nativeError: "load",
  },
  {
    name: "an explicit declaration does not prove successful module loading",
    entry: 'export * from "./missing"; export const value = 3;',
    expected: "binding",
    nativeError: "load",
  },
  {
    name: "default exclusion does not prove successful module loading",
    entry: 'export * from "./missing";',
    expected: "missing",
    exportedName: "default",
    nativeError: "load",
  },
  {
    name: "an analyzed empty source does not obscure a known binding",
    entry: 'export * from "./empty"; export * from "./local";',
    expected: "binding",
    nativeError: null,
  },
  {
    name: "an analyzed empty source proves absence",
    entry: 'export * from "./empty";',
    expected: "missing",
    nativeError: "missing",
  },
  {
    name: "an unsupported source star",
    entry: 'export * from "./source.fixture";',
    expected: "uncertain",
    transformed: "binding",
    nativeError: null,
  },
  {
    name: "an unsupported source with a conflicting export",
    entry: 'export * from "./source.fixture"; export * from "./local";',
    expected: "uncertain",
    transformed: "ambiguous",
    nativeError: "ambiguous",
  },
  {
    name: "an unsupported source without the requested export",
    entry: 'export * from "./source.fixture"; export * from "./local";',
    files: { "source.fixture": "export const unrelated = 1;" },
    expected: "uncertain",
    transformed: "binding",
    nativeError: null,
  },
  {
    name: "an unsupported named re-export in a barrel",
    entry: 'export * from "./nested"; export * from "./local";',
    files: { "nested.ts": 'export { value } from "./source.fixture";' },
    expected: "uncertain",
    transformed: "ambiguous",
    nativeError: "ambiguous",
  },
  {
    name: "an unsupported namespace re-export in a barrel",
    entry: 'export * from "./nested"; export * from "./local";',
    files: { "nested.ts": 'export * as value from "./source.fixture";' },
    expected: "uncertain",
    transformed: "ambiguous",
    nativeError: "ambiguous",
  },
  {
    name: "a resolved path whose file becomes unavailable",
    entry: 'export * from "./missing"; export * from "./local";',
    files: { "missing.ts": "export const value = 1;" },
    removeAfterResolution: true,
    expected: "uncertain",
    nativeError: "load",
  },
];

const requireDependency = createRequire(join(import.meta.dirname, "../package.json"));
const transform: SourceTransform = {
  appliesTo: (extension) => extension === ".fixture",
  transform: (_filename, sourceText) => ({ sourceText, lang: "js" }),
};
const checkResolution = (
  result: ResolvedSymbol,
  expected: UnavailableModuleCase["expected"],
): void => {
  if (expected === "uncertain") {
    expect(result).toMatchObject({ kind: "unresolved", isUncertain: true });
    expect(result).not.toHaveProperty("isAmbiguous");
  } else if (expected === "ambiguous") {
    expect(result).toMatchObject({ kind: "unresolved", isAmbiguous: true });
    expect(result).not.toHaveProperty("isUncertain");
  } else if (expected === "missing") {
    expect(result.kind).toBe("unresolved");
    expect(result).not.toHaveProperty("isUncertain");
    expect(result).not.toHaveProperty("isAmbiguous");
  } else expect(result.kind).toBe(expected);
};

it.each(cases.flatMap((entry) => [false, true].map((reverse) => ({ ...entry, reverse }))))(
  "$name (reverse: $reverse)",
  ({
    entry,
    files,
    expected,
    transformed,
    nativeError,
    exportedName = "value",
    removeAfterResolution,
    reverse,
  }) => {
    const directory = mkdtempSync(join(tmpdir(), "bippy-unavailable-modules-"));
    try {
      const sources = {
        "entry.ts": reverse ? entry.split(";").filter(Boolean).reverse().join(";") + ";" : entry,
        "local.ts": "export const value = 1;",
        "other.ts": "export const value = 1;",
        "empty.ts": "export {};",
        "source.fixture": "export const value = 1;",
        ...files,
      };
      for (const [filename, source] of Object.entries(sources)) {
        const filePath = join(directory, filename);
        mkdirSync(dirname(filePath), { recursive: true });
        writeFileSync(filePath, source);
      }
      const importer = join(directory, "entry.ts");
      const resolver = new ModuleResolver({ rootDirectory: directory });
      if (removeAfterResolution) {
        const missing = join(directory, "missing.ts");
        expect(resolver.resolve("./missing", importer)).toMatchObject({
          kind: "internal",
          filePath: missing,
        });
        rmSync(missing);
      }
      const graph = new ModuleGraph({ resolver });
      const module = graph.getModule(importer);
      if (!module) throw new Error("Missing entry");
      checkResolution(graph.resolveExport(module, exportedName), expected);
      if (transformed) {
        const transformedGraph = new ModuleGraph({
          resolver: new ModuleResolver({ rootDirectory: directory }),
          sourceFileCache: new SourceFileCache([transform]),
        });
        const transformedModule = transformedGraph.getModule(importer);
        if (!transformedModule) throw new Error("Missing transformed entry");
        checkResolution(
          transformedGraph.resolveExport(transformedModule, exportedName),
          transformed,
        );
      }
      const consumer = join(directory, "consumer.ts");
      writeFileSync(
        consumer,
        `import { ${exportedName} as importedValue } from "./entry"; export const result = importedValue; throw new Error("Linking must not evaluate applications");`,
      );
      const linked = spawnSync(
        process.execPath,
        [
          "--experimental-vm-modules",
          "--experimental-import-meta-resolve",
          "--import",
          requireDependency.resolve("tsx"),
          join(import.meta.dirname, "helpers/link-module-graph.ts"),
          consumer,
        ],
        { encoding: "utf8" },
      );
      expect(linked.error).toBeUndefined();
      expect(linked.status, linked.stderr).toBe(nativeError ? 1 : 0);
      if (nativeError)
        expect(linked.stderr).toMatch(
          nativeError === "load" ? /ENOENT|ERR_MODULE_NOT_FOUND/ : /SyntaxError/,
        );
      const bundle = () =>
        buildSync({
          entryPoints: [consumer],
          bundle: true,
          write: false,
          format: "esm",
          logLevel: "silent",
          loader: { ".fixture": "js" },
        });
      if (!nativeError) expect(bundle).not.toThrow();
      else
        expect(bundle).toThrow(
          nativeError === "load"
            ? /Could not resolve/
            : nativeError === "ambiguous"
              ? /ambiguous/i
              : /No matching export/,
        );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
