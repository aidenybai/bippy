import { buildSync } from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, it } from "vite-plus/test";
import { ModuleGraph } from "../src/graph/module-graph.js";
import { ModuleResolver } from "../src/graph/module-resolver.js";
import type { ResolvedSymbol } from "../src/graph/module-types.js";

interface ExternalStarCase {
  name: string;
  entry: string;
  packageSource: string;
  files?: Record<string, string>;
  opaque: "uncertain" | "binding" | "ambiguous" | "missing" | "external";
  analyzed: "binding" | "ambiguous" | "missing";
  exportedName?: string;
}

const cases: ExternalStarCase[] = [
  {
    name: "one unknown star with a matching export",
    entry: 'export * from "opaque-kit";',
    packageSource: "export const value = 1;",
    opaque: "uncertain",
    analyzed: "binding",
  },
  {
    name: "one unknown star without a matching export",
    entry: 'export * from "opaque-kit";',
    packageSource: "export const other = 1;",
    opaque: "uncertain",
    analyzed: "missing",
  },
  {
    name: "a local star and a conflicting unknown star",
    entry: 'export * from "./local"; export * from "opaque-kit";',
    packageSource: "export const value = 1;",
    opaque: "uncertain",
    analyzed: "ambiguous",
  },
  {
    name: "a local star and a nonmatching unknown star",
    entry: 'export * from "./local"; export * from "opaque-kit";',
    packageSource: "export const other = 1;",
    opaque: "uncertain",
    analyzed: "binding",
  },
  {
    name: "nested uncertainty with a conflicting binding",
    entry: 'export * from "./nested"; export * from "./local";',
    files: { "nested.ts": 'export * from "opaque-kit";' },
    packageSource: "export const value = 1;",
    opaque: "uncertain",
    analyzed: "ambiguous",
  },
  {
    name: "nested uncertainty without a conflicting binding",
    entry: 'export * from "./nested"; export * from "./local";',
    files: { "nested.ts": 'export * from "opaque-kit";' },
    packageSource: "export const other = 1;",
    opaque: "uncertain",
    analyzed: "binding",
  },
  {
    name: "two opaque sources nested before a known binding",
    entry: 'export * from "./nested"; export * from "./local";',
    files: { "nested.ts": 'export * from "opaque-kit"; export * from "other-kit";' },
    packageSource: "export const other = 1;",
    opaque: "uncertain",
    analyzed: "binding",
  },
  {
    name: "explicit re-export propagates star uncertainty",
    entry: 'export { value } from "./nested";',
    files: { "nested.ts": 'export * from "opaque-kit";' },
    packageSource: "export const value = 1;",
    opaque: "uncertain",
    analyzed: "binding",
  },
  {
    name: "known conflict dominates nested uncertainty",
    entry: 'export * from "./nested"; export * from "./local"; export * from "./other";',
    files: { "nested.ts": 'export * from "opaque-kit";' },
    packageSource: "export const unrelated = 1;",
    opaque: "ambiguous",
    analyzed: "ambiguous",
  },
  {
    name: "explicit binding overrides opaque stars",
    entry: 'export * from "opaque-kit"; export const value = 3;',
    packageSource: "export const value = 1;",
    opaque: "binding",
    analyzed: "binding",
  },
  {
    name: "explicit re-export overrides opaque stars",
    entry: 'export * from "opaque-kit"; export { value } from "./local";',
    packageSource: "export const value = 1;",
    opaque: "binding",
    analyzed: "binding",
  },
  {
    name: "default is never supplied by stars",
    entry: 'export * from "opaque-kit";',
    packageSource: "export default 1;",
    exportedName: "default",
    opaque: "missing",
    analyzed: "missing",
  },
  {
    name: "known conflict remains definite despite an opaque star",
    entry: 'export * from "./local"; export * from "opaque-kit"; export * from "./other";',
    packageSource: "export const other = 1;",
    opaque: "ambiguous",
    analyzed: "ambiguous",
  },
  {
    name: "explicit external re-export retains its named reference",
    entry: 'export { value } from "opaque-kit";',
    packageSource: "export const value = 1;",
    opaque: "external",
    analyzed: "binding",
  },
];

const requireDependency = createRequire(join(import.meta.dirname, "../package.json"));
const checkResolution = (result: ResolvedSymbol, expected: ExternalStarCase["opaque"]): void => {
  if (expected === "uncertain") {
    expect(result).toMatchObject({ kind: "unresolved", isUncertain: true });
    expect(result).not.toHaveProperty("isAmbiguous");
  } else if (expected === "ambiguous") {
    expect(result).toMatchObject({ kind: "unresolved", isAmbiguous: true });
    expect(result).not.toHaveProperty("isUncertain");
  } else if (expected === "missing") {
    expect(result).toMatchObject({ kind: "unresolved" });
    expect(result).not.toHaveProperty("isUncertain");
    expect(result).not.toHaveProperty("isAmbiguous");
  } else expect(result.kind).toBe(expected);
};

it.each(cases.flatMap((entry) => [false, true].map((reverse) => ({ ...entry, reverse }))))(
  "$name (reverse: $reverse)",
  ({ entry, packageSource, files, opaque, analyzed, exportedName = "value", reverse }) => {
    const directory = mkdtempSync(join(tmpdir(), "bippy-external-stars-"));
    try {
      const sources = {
        "entry.ts": reverse ? entry.split(";").filter(Boolean).reverse().join(";") + ";" : entry,
        "local.ts": "export const value = 1;",
        "other.ts": "export const value = 1;",
        "node_modules/opaque-kit/package.json": JSON.stringify({
          name: "opaque-kit",
          type: "module",
          main: "index.ts",
        }),
        "node_modules/opaque-kit/index.ts": packageSource,
        "node_modules/other-kit/package.json": JSON.stringify({
          name: "other-kit",
          type: "module",
          main: "index.ts",
        }),
        "node_modules/other-kit/index.ts": "export const unrelated = 1;",
        ...files,
      };
      for (const [filename, source] of Object.entries(sources)) {
        const filePath = join(directory, filename);
        mkdirSync(dirname(filePath), { recursive: true });
        writeFileSync(filePath, source);
      }
      for (const isAnalyzed of [false, true]) {
        const graph = new ModuleGraph({
          resolver: new ModuleResolver({ rootDirectory: directory }),
          externalPackageAllowList: isAnalyzed ? ["opaque-kit", "other-kit"] : [],
        });
        const module = graph.getModule(join(directory, "entry.ts"));
        if (!module) throw new Error("Missing entry");
        checkResolution(graph.resolveExport(module, exportedName), isAnalyzed ? analyzed : opaque);
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
      expect(linked.status, linked.stderr).toBe(analyzed === "binding" ? 0 : 1);
      if (analyzed !== "binding") expect(linked.stderr).toMatch(/SyntaxError/);
      const bundle = () =>
        buildSync({
          entryPoints: [consumer],
          bundle: true,
          write: false,
          format: "esm",
          logLevel: "silent",
        });
      if (analyzed === "binding") expect(bundle).not.toThrow();
      else expect(bundle).toThrow(analyzed === "ambiguous" ? /ambiguous/i : /No matching export/i);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
