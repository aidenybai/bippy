import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { buildSync } from "esbuild";
import { expect, it } from "vite-plus/test";
import { ModuleGraph } from "../src/graph/module-graph.js";
import { ModuleResolver } from "../src/graph/module-resolver.js";

const requireDependency = createRequire(join(import.meta.dirname, "../package.json"));

interface ExportCase {
  name: string;
  files: Record<string, string>;
  ambiguous: boolean;
  nativeAmbiguous?: boolean;
  bundlerAmbiguous?: boolean;
  origin?: string;
  binding?: string;
  namespace?: boolean;
}

const exportCases: ExportCase[] = [
  {
    name: "different bindings with equal values",
    files: {
      "entry.ts": 'export * from "./left"; export * from "./right";',
      "left.ts": "export const value = 1;",
      "right.ts": "export const value = 1;",
    },
    ambiguous: true,
  },
  {
    name: "different bindings from one defining module",
    files: {
      "entry.ts": 'export * from "./left"; export * from "./right";',
      "left.ts": 'export { first as value } from "./origin";',
      "right.ts": 'export { second as value } from "./origin";',
      "origin.ts": "export const first = 1; export const second = 1;",
    },
    ambiguous: true,
  },
  {
    name: "diamond aliases of one binding",
    files: {
      "entry.ts": 'export * from "./left"; export * from "./right";',
      "left.ts": 'export { original as value } from "./origin";',
      "right.ts": 'import { original as local } from "./origin"; export { local as value };',
      "origin.ts": "export const original = 1;",
    },
    ambiguous: false,
    origin: "origin.ts",
    binding: "original",
  },
  {
    name: "a direct export overriding both stars",
    files: {
      "entry.ts": 'export * from "./left"; export * from "./right"; export const value = 3;',
      "left.ts": "export const value = 1;",
      "right.ts": "export const value = 2;",
    },
    ambiguous: false,
    origin: "entry.ts",
    binding: "value",
  },
  {
    name: "an explicit re-export overriding both stars",
    files: {
      "entry.ts":
        'export * from "./left"; export * from "./right"; export { value } from "./right";',
      "left.ts": "export const value = 1;",
      "right.ts": "export const value = 2;",
    },
    ambiguous: false,
    origin: "right.ts",
    binding: "value",
  },
  {
    name: "nested ambiguity despite another valid source",
    files: {
      "entry.ts": 'export * from "./conflict"; export * from "./origin";',
      "conflict.ts": 'export * from "./left"; export * from "./right";',
      "left.ts": "export const value = 1;",
      "right.ts": "export const value = 2;",
      "origin.ts": "export const value = 3;",
    },
    ambiguous: true,
  },
  {
    name: "an explicit re-export of an ambiguous name",
    files: {
      "entry.ts": 'export { value } from "./conflict";',
      "conflict.ts": 'export * from "./left"; export * from "./right";',
      "left.ts": "export const value = 1;",
      "right.ts": "export const value = 2;",
    },
    ambiguous: true,
  },
  {
    name: "a cycle with a noncyclic source",
    bundlerAmbiguous: true,
    files: {
      "entry.ts": 'export * from "./cycle"; export * from "./origin";',
      "cycle.ts": 'export { value } from "./entry";',
      "origin.ts": "export const value = 1;",
    },
    ambiguous: false,
    origin: "origin.ts",
    binding: "value",
  },
  {
    name: "two namespaces of the same module",
    nativeAmbiguous: true,
    files: {
      "entry.ts": 'export * from "./left"; export * from "./right";',
      "left.ts": 'export * as value from "./origin";',
      "right.ts": 'export * as value from "./origin";',
      "origin.ts": "export const original = 1;",
    },
    ambiguous: false,
    origin: "origin.ts",
    namespace: true,
  },
  {
    name: "namespaces of different modules",
    files: {
      "entry.ts": 'export * from "./left"; export * from "./right";',
      "left.ts": 'export * as value from "./first";',
      "right.ts": 'export * as value from "./second";',
      "first.ts": "export const original = 1;",
      "second.ts": "export const original = 1;",
    },
    ambiguous: true,
  },
];

it.each(exportCases.flatMap((entry) => [false, true].map((reverse) => ({ ...entry, reverse }))))(
  "$name (reverse: $reverse)",
  ({
    files,
    ambiguous,
    nativeAmbiguous = ambiguous,
    bundlerAmbiguous = ambiguous,
    origin,
    binding,
    namespace,
    reverse,
  }) => {
    const directory = mkdtempSync(join(tmpdir(), "bippy-module-exports-"));
    try {
      for (const [filename, original] of Object.entries(files)) {
        const source =
          reverse && filename === "entry.ts"
            ? original.split(";").filter(Boolean).reverse().join(";") + ";"
            : original;
        const filePath = join(directory, filename);
        mkdirSync(dirname(filePath), { recursive: true });
        writeFileSync(filePath, source);
      }
      const graph = new ModuleGraph({ resolver: new ModuleResolver({ rootDirectory: directory }) });
      const entry = graph.getModule(join(directory, "entry.ts"));
      if (!entry) throw new Error("Missing entry module");
      const result = graph.resolveExport(entry, "value");
      const consumer = join(directory, "consumer.ts");
      writeFileSync(consumer, 'export { value } from "./entry";');
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
      if (bundlerAmbiguous) expect(bundle).toThrow(/ambiguous/i);
      else expect(bundle).not.toThrow();
      if (ambiguous) {
        expect(result).toMatchObject({ kind: "unresolved", isAmbiguous: true });
      } else {
        expect(result).toMatchObject({
          kind: namespace ? "namespace" : "binding",
          module: { filePath: join(directory, origin ?? "") },
          ...(binding ? { binding: { name: binding } } : {}),
        });
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
