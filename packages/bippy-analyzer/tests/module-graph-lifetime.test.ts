import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { createStaticRenderer } from "../src/index.js";
import { ModuleGraph } from "../src/graph/module-graph.js";
import { ModuleResolver } from "../src/graph/module-resolver.js";
import { SourceFileCache } from "../src/parse/parse-source-file.js";
import type { SourceTransform } from "../src/types.js";

const withProject = async (check: (directory: string) => void | Promise<void>): Promise<void> => {
  const directory = mkdtempSync(join(tmpdir(), "bippy-graph-lifetime-"));
  try {
    await check(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

const setSource = (directory: string, filename: string, source: string): string => {
  const filePath = join(directory, filename);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, source);
  return filePath;
};

const getGraph = (directory: string, sourceFileCache = new SourceFileCache()): ModuleGraph =>
  new ModuleGraph({ resolver: new ModuleResolver({ rootDirectory: directory }), sourceFileCache });

const beforeSource = "export const before = 1;";
const afterSource = "export const afterChange = 2;";

describe("current graph lifetime boundaries", () => {
  it("reuses unchanged records without treating each access as a new module", () =>
    withProject((directory) => {
      const filename = setSource(directory, "entry.ts", beforeSource);
      const graph = getGraph(directory);
      const original = graph.getModule(filename);
      expect(original?.file.sourceText).toBe(beforeSource);
      expect(graph.getModule(filename)).toBe(original);
      expect(graph.sourceFileCache.read(filename)).toBe(original?.file);
      expect(graph.loadedModuleCount).toBe(1);
    }));

  it("does not replace a graph record when its source cache sees changed bytes", () =>
    withProject((directory) => {
      const filename = setSource(directory, "entry.ts", beforeSource);
      const sourceFileCache = new SourceFileCache();
      const graph = getGraph(directory, sourceFileCache);
      const original = graph.getModule(filename);
      setSource(directory, "entry.ts", afterSource);
      expect(sourceFileCache.read(filename)?.sourceText).toBe(afterSource);
      expect(graph.getModule(filename)).toBe(original);
      expect(graph.getModule(filename)?.file.sourceText).toBe(beforeSource);
      expect(getGraph(directory, sourceFileCache).getModule(filename)?.file.sourceText).toBe(
        afterSource,
      );
    }));

  it("retains a cached missing module after the file is created", () =>
    withProject((directory) => {
      const filename = join(directory, "entry.ts");
      const graph = getGraph(directory);
      expect(graph.getModule(filename)).toBeNull();
      setSource(directory, "entry.ts", afterSource);
      expect(graph.sourceFileCache.read(filename)?.sourceText).toBe(afterSource);
      expect(graph.getModule(filename)).toBeNull();
      expect(getGraph(directory).getModule(filename)?.file.sourceText).toBe(afterSource);
    }));

  it("retains a loaded record after its file is deleted", () =>
    withProject((directory) => {
      const filename = setSource(directory, "entry.ts", beforeSource);
      const graph = getGraph(directory);
      const original = graph.getModule(filename);
      expect(original?.file.sourceText).toBe(beforeSource);
      rmSync(filename);
      expect(graph.sourceFileCache.read(filename)).toBeNull();
      expect(graph.getModule(filename)).toBe(original);
      expect(getGraph(directory).getModule(filename)).toBeNull();
    }));

  it("keeps the first virtual module registered at a path", () =>
    withProject((directory) => {
      const filename = join(directory, "virtual.ts");
      const graph = getGraph(directory);
      const original = graph.addVirtualModule(filename, beforeSource);
      expect(original?.file.sourceText).toBe(beforeSource);
      expect(graph.addVirtualModule(filename, afterSource)).toBe(original);
      expect(getGraph(directory).addVirtualModule(filename, afterSource)?.file.sourceText).toBe(
        afterSource,
      );
    }));

  it("retains a missing resolution even when only the graph is replaced", () =>
    withProject((directory) => {
      const importer = setSource(directory, "entry.ts", 'export * from "./missing";');
      const resolver = new ModuleResolver({ rootDirectory: directory });
      expect(resolver.resolve("./missing", importer).kind).toBe("unresolved");
      const target = setSource(directory, "missing.ts", afterSource);
      const graph = new ModuleGraph({ resolver });
      const module = graph.getModule(importer);
      if (!module) throw new Error("Missing importer");
      expect(graph.resolveSpecifier("./missing", module).kind).toBe("unresolved");
      expect(
        new ModuleResolver({ rootDirectory: directory }).resolve("./missing", importer),
      ).toMatchObject({ kind: "internal", filePath: target });
    }));

  it("retains a resolution when a higher-priority extension becomes available", () =>
    withProject((directory) => {
      const importer = setSource(directory, "entry.ts", "export {};");
      const original = setSource(directory, "target.ts", beforeSource);
      const resolver = new ModuleResolver({ rootDirectory: directory });
      expect(resolver.resolve("./target", importer)).toMatchObject({ filePath: original });
      const replacement = setSource(directory, "target.tsx", afterSource);
      expect(resolver.resolve("./target", importer)).toMatchObject({ filePath: original });
      expect(
        new ModuleResolver({ rootDirectory: directory }).resolve("./target", importer),
      ).toMatchObject({ filePath: replacement });
    }));

  it("retains package exports until the resolver is recreated", () =>
    withProject((directory) => {
      const importer = setSource(directory, "entry.ts", "export {};");
      const original = setSource(directory, "node_modules/lifetime-kit/first.ts", beforeSource);
      const replacement = setSource(directory, "node_modules/lifetime-kit/second.ts", afterSource);
      const setManifest = (target: string) =>
        setSource(
          directory,
          "node_modules/lifetime-kit/package.json",
          JSON.stringify({ name: "lifetime-kit", type: "module", exports: target }),
        );
      setManifest("./first.ts");
      const resolver = new ModuleResolver({ rootDirectory: directory });
      expect(resolver.resolve("lifetime-kit", importer)).toMatchObject({ filePath: original });
      setManifest("./second.ts");
      expect(resolver.resolve("lifetime-kit", importer)).toMatchObject({ filePath: original });
      expect(
        new ModuleResolver({ rootDirectory: directory }).resolve("lifetime-kit", importer),
      ).toMatchObject({ filePath: replacement });
    }));

  it("retains tsconfig paths until the resolver is recreated", () =>
    withProject((directory) => {
      const importer = setSource(directory, "entry.ts", "export {};");
      const original = setSource(directory, "first.ts", beforeSource);
      const replacement = setSource(directory, "second.ts", afterSource);
      const setConfig = (target: string) =>
        setSource(
          directory,
          "tsconfig.json",
          JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@target": [target] } } }),
        );
      const tsconfigPath = setConfig("./first.ts");
      const options = { rootDirectory: directory, tsconfigPath };
      const resolver = new ModuleResolver(options);
      expect(resolver.resolve("@target", importer)).toMatchObject({ filePath: original });
      setConfig("./second.ts");
      expect(resolver.resolve("@target", importer)).toMatchObject({ filePath: original });
      expect(new ModuleResolver(options).resolve("@target", importer)).toMatchObject({
        filePath: replacement,
      });
    }));

  it.each([null, "generated"])("does not track transform dependencies for query %s", (query) =>
    withProject((directory) => {
      const filename = setSource(directory, "entry.ts", "export {};");
      const dependency = setSource(directory, "generated.txt", beforeSource);
      const transform: SourceTransform = {
        appliesTo: (extension) => extension === ".ts",
        transform: () => ({ sourceText: readFileSync(dependency, "utf8"), lang: "ts" }),
      };
      const sourceFileCache = new SourceFileCache([transform]);
      const getSource = (cache: SourceFileCache) =>
        query === null ? cache.read(filename) : cache.readQueried(filename, query);
      expect(getSource(sourceFileCache)?.sourceText).toBe(beforeSource);
      setSource(directory, "generated.txt", afterSource);
      expect(getSource(sourceFileCache)?.sourceText).toBe(beforeSource);
      expect(getSource(new SourceFileCache([transform]))?.sourceText).toBe(afterSource);
      if (query === null) {
        expect(getGraph(directory, sourceFileCache).getModule(filename)?.file.sourceText).toBe(
          beforeSource,
        );
        expect(
          getGraph(directory, new SourceFileCache([transform])).getModule(filename)?.file
            .sourceText,
        ).toBe(afterSource);
      }
    }),
  );

  it("cannot distinguish changed bytes with identical size and modification time", () =>
    withProject((directory) => {
      const filename = setSource(directory, "entry.ts", beforeSource);
      const replacement = "export const after_ = 2;";
      expect(Buffer.byteLength(replacement)).toBe(Buffer.byteLength(beforeSource));
      const timestamp = new Date(1_700_000_000_000);
      utimesSync(filename, timestamp, timestamp);
      const sourceFileCache = new SourceFileCache();
      expect(sourceFileCache.read(filename)?.sourceText).toBe(beforeSource);
      const original = statSync(filename);
      setSource(directory, "entry.ts", replacement);
      utimesSync(filename, timestamp, timestamp);
      const current = statSync(filename);
      expect([current.size, current.mtimeMs]).toEqual([original.size, original.mtimeMs]);
      expect(readFileSync(filename, "utf8")).toBe(replacement);
      expect(sourceFileCache.read(filename)?.sourceText).toBe(beforeSource);
      expect(new SourceFileCache().read(filename)?.sourceText).toBe(replacement);
    }));

  it("can combine old loaded records with new lazily loaded records", () =>
    withProject((directory) => {
      const first = setSource(directory, "first.ts", beforeSource);
      const second = setSource(directory, "second.ts", beforeSource);
      const graph = getGraph(directory);
      expect(graph.getModule(first)?.file.sourceText).toBe(beforeSource);
      setSource(directory, "first.ts", afterSource);
      setSource(directory, "second.ts", afterSource);
      expect(graph.getModule(first)?.file.sourceText).toBe(beforeSource);
      expect(graph.getModule(second)?.file.sourceText).toBe(afterSource);
      const fresh = getGraph(directory);
      expect([first, second].map((filename) => fresh.getModule(filename)?.file.sourceText)).toEqual(
        [afterSource, afterSource],
      );
    }));

  it("shares loaded records through derive without reloading the project", () =>
    withProject(async (directory) => {
      const filename = setSource(directory, "entry.ts", beforeSource);
      const renderer = await createStaticRenderer({ rootDirectory: directory });
      const original = renderer.loadModule(filename);
      expect(original?.file.sourceText).toBe(beforeSource);
      setSource(directory, "entry.ts", afterSource);
      const derived = renderer.derive({});
      expect(derived.loadModule(filename)).toBe(original);
      const fresh = await createStaticRenderer({ rootDirectory: directory });
      expect(fresh.loadModule(filename)?.file.sourceText).toBe(afterSource);
    }));
});
