import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { buildSync } from "esbuild";
import { expect, it } from "vite-plus/test";
import { ModuleGraph } from "../src/graph/module-graph.js";
import { ModuleResolver } from "../src/graph/module-resolver.js";

interface ModeledStarCase {
  name: string;
  entry: string;
  files?: Record<string, string>;
  expected: "external" | "binding" | "uncertain" | "ambiguous";
  nativeAmbiguous: boolean;
}

const requireDependency = createRequire(join(import.meta.dirname, "../package.json"));
const reduxManifest = requireDependency.resolve("redux/package.json");
const reduxDirectory = dirname(reduxManifest);
const reduxSource = join(reduxDirectory, "dist/redux.mjs");
const hash = (filename: string): string =>
  createHash("sha256").update(readFileSync(filename)).digest("hex");
const reduxHash = hash(reduxSource);
const cases: ModeledStarCase[] = [
  {
    name: "a single modeled star",
    entry: 'export * from "redux";',
    expected: "external",
    nativeAmbiguous: false,
  },
  {
    name: "a modeled star and a local binding",
    entry: 'export * from "redux"; export * from "./local";',
    expected: "uncertain",
    nativeAmbiguous: true,
  },
  {
    name: "a diamond of the same modeled reference",
    entry: 'export * from "redux"; export * from "./alias";',
    files: { "alias.ts": 'export { combineReducers } from "redux";' },
    expected: "external",
    nativeAmbiguous: false,
  },
  {
    name: "a modeled reference and its parsed source binding",
    entry: `export * from "redux"; export * from ${JSON.stringify(reduxSource)};`,
    expected: "uncertain",
    nativeAmbiguous: false,
  },
  {
    name: "an explicit binding overrides the modeled star",
    entry: 'export * from "redux"; export const combineReducers = 3;',
    expected: "binding",
    nativeAmbiguous: false,
  },
  {
    name: "an explicit re-export overrides the modeled star",
    entry: 'export * from "redux"; export { combineReducers } from "./local";',
    expected: "binding",
    nativeAmbiguous: false,
  },
  {
    name: "an opaque star without a matching export",
    entry: 'export * from "redux"; export * from "opaque-kit";',
    expected: "uncertain",
    nativeAmbiguous: false,
  },
  {
    name: "an opaque star with a matching export",
    entry: 'export * from "redux"; export * from "opaque-kit";',
    files: { "node_modules/opaque-kit/index.ts": "export const combineReducers = 1;" },
    expected: "uncertain",
    nativeAmbiguous: true,
  },
  {
    name: "nested opaque uncertainty",
    entry: 'export * from "redux"; export * from "./nested";',
    files: { "nested.ts": 'export * from "opaque-kit";' },
    expected: "uncertain",
    nativeAmbiguous: false,
  },
  {
    name: "two known conflicting bindings despite a modeled star",
    entry: 'export * from "redux"; export * from "./local"; export * from "./other";',
    expected: "ambiguous",
    nativeAmbiguous: true,
  },
  {
    name: "nested known conflict despite a modeled star",
    entry: 'export * from "redux"; export * from "./nested";',
    files: { "nested.ts": 'export * from "./local"; export * from "./other";' },
    expected: "ambiguous",
    nativeAmbiguous: true,
  },
  {
    name: "repeated modeled stars",
    entry: 'export * from "redux"; export * from "redux";',
    expected: "external",
    nativeAmbiguous: false,
  },
  {
    name: "two modeled export names through stars",
    entry: 'export * from "redux"; export * from "./alias";',
    files: { "alias.ts": 'export { compose as combineReducers } from "redux";' },
    expected: "uncertain",
    nativeAmbiguous: true,
  },
  {
    name: "two modeled export names through explicit re-export barrels",
    entry: 'export * from "./first"; export * from "./second";',
    files: {
      "first.ts": 'export { combineReducers } from "redux";',
      "second.ts": 'export { compose as combineReducers } from "redux";',
    },
    expected: "uncertain",
    nativeAmbiguous: true,
  },
];

it.each(cases.flatMap((entry) => [false, true].map((reverse) => ({ ...entry, reverse }))))(
  "$name (reverse: $reverse)",
  ({ entry, files, expected, nativeAmbiguous, reverse }) => {
    expect(JSON.parse(readFileSync(reduxManifest, "utf8")).version).toBe("5.0.1");
    const directory = mkdtempSync(join(tmpdir(), "bippy-modeled-stars-"));
    try {
      mkdirSync(join(directory, "node_modules"));
      symlinkSync(reduxDirectory, join(directory, "node_modules/redux"));
      const sources = {
        "entry.ts": reverse ? entry.split(";").filter(Boolean).reverse().join(";") + ";" : entry,
        "local.ts": "export const combineReducers = 1;",
        "other.ts": "export const combineReducers = 1;",
        "node_modules/opaque-kit/package.json": JSON.stringify({
          name: "opaque-kit",
          type: "module",
          main: "index.ts",
        }),
        "node_modules/opaque-kit/index.ts": "export const unrelated = 1;",
        ...files,
      };
      for (const [filename, source] of Object.entries(sources)) {
        const filePath = join(directory, filename);
        mkdirSync(dirname(filePath), { recursive: true });
        writeFileSync(filePath, source);
      }
      const graph = new ModuleGraph({
        resolver: new ModuleResolver({ rootDirectory: directory }),
        externalPackageAllowList: ["redux"],
      });
      const module = graph.getModule(join(directory, "entry.ts"));
      if (!module) throw new Error("Missing entry");
      expect(graph.resolveSpecifier("redux", module)).toMatchObject({
        kind: "external",
        filePath: reduxSource,
      });
      const result = graph.resolveExport(module, "combineReducers");
      if (expected === "uncertain") {
        expect(result).toMatchObject({ kind: "unresolved", isUncertain: true });
        expect(result).not.toHaveProperty("isAmbiguous");
      } else if (expected === "ambiguous") {
        expect(result).toMatchObject({ kind: "unresolved", isAmbiguous: true });
        expect(result).not.toHaveProperty("isUncertain");
      } else expect(result.kind).toBe(expected);
      const consumer = join(directory, "consumer.ts");
      writeFileSync(
        consumer,
        'import { combineReducers } from "./entry"; export const result = combineReducers; throw new Error("Linking must not evaluate applications");',
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
      expect(linked.status, linked.stderr).toBe(nativeAmbiguous ? 1 : 0);
      if (nativeAmbiguous) expect(linked.stderr).toMatch(/SyntaxError/);
      const bundle = () =>
        buildSync({
          entryPoints: [consumer],
          bundle: true,
          write: false,
          format: "esm",
          logLevel: "silent",
        });
      if (nativeAmbiguous) expect(bundle).toThrow(/ambiguous/i);
      else expect(bundle).not.toThrow();
      expect(hash(reduxSource)).toBe(reduxHash);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
