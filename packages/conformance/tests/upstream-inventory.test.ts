import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import {
  conformanceDirectory,
  devtoolsDirectory,
  getPortTitles,
  getTestDefinitions,
  readUpstreamManifest,
  repositoryDirectory,
} from "../scripts/test-inventory.js";

const manifest = readUpstreamManifest();
const conformanceFiles = readdirSync(resolve(conformanceDirectory, "tests"))
  .filter((file) => /\.tsx?$/.test(file))
  .map((file) => resolve(conformanceDirectory, "tests", file));
const devtoolsFiles = [
  ...readdirSync(resolve(devtoolsDirectory, "tests"))
    .filter((file) => /\.test\.tsx?$/.test(file))
    .map((file) => resolve(devtoolsDirectory, "tests", file)),
  ...manifest.ports
    .filter((port) => port.scope === "complete-development-suite")
    .map((port) => resolve(conformanceDirectory, port.local)),
];
const portDefinitions = new Map(
  [...new Set([...conformanceFiles, ...devtoolsFiles])].map((path) => [
    path,
    getTestDefinitions(path),
  ]),
);
const upstreamDefinitions = manifest.devtools.testFiles.flatMap((file) => file.definitions);

const getLocalTitles = (path: string): string[] => {
  const definitions = portDefinitions.get(path);
  if (!definitions) throw new Error(`Test file is not registered in conformance: ${path}`);
  return definitions
    .filter((definition) => definition.kind !== "describe")
    .map((definition) => definition.title);
};

describe("canonical upstream inventory", () => {
  it("pins both reviewed revisions and source hashes", () => {
    expect(manifest.repository).toBe("https://github.com/facebook/react.git");
    expect(manifest.revision).toMatch(/^[a-f\d]{40}$/);
    expect(manifest.devtools.revision).toMatch(/^[a-f\d]{40}$/);
    expect(Object.keys(manifest.sources).length).toBeGreaterThan(0);
    for (const hash of Object.values(manifest.sources)) expect(hash).toMatch(/^[a-f\d]{64}$/);
    const sourcePaths = manifest.devtools.testFiles.map((file) => file.path);
    expect(new Set(sourcePaths).size).toBe(sourcePaths.length);
  });

  it("keeps every direct port present exactly once", () => {
    for (const port of manifest.ports) {
      expect(Object.keys(manifest.sources)).toContain(port.upstream);
      const titles = getLocalTitles(resolve(conformanceDirectory, port.local));
      for (const title of getPortTitles(manifest, port)) {
        expect(
          titles.filter((localTitle) => localTitle === title),
          title,
        ).toHaveLength(1);
      }
    }
  });

  it("accounts for all 675 DevTools definitions without duplicate ports", () => {
    expect(upstreamDefinitions).toHaveLength(675);
    const localTitleCounts = new Map<string, number>();
    for (const path of devtoolsFiles) {
      for (const title of getLocalTitles(path))
        localTitleCounts.set(title, (localTitleCounts.get(title) ?? 0) + 1);
    }
    for (const definition of upstreamDefinitions) {
      const count = localTitleCounts.get(definition.title) ?? 0;
      expect(count, `Missing port: ${definition.title}`).toBeGreaterThan(0);
      localTitleCounts.set(definition.title, count - 1);
    }
    for (const title of new Set(upstreamDefinitions.map((definition) => definition.title))) {
      expect(localTitleCounts.get(title), `Duplicate port: ${title}`).toBe(0);
    }
  });

  it("runs all ten cases disabled by upstream from their recorded local files", () => {
    const disabledDefinitions = upstreamDefinitions.filter((definition) => definition.disabled);
    expect(disabledDefinitions).toHaveLength(10);
    const availableTitles = new Map<string, string[]>();
    for (const definition of disabledDefinitions) {
      expect(definition.local, definition.title).toBeTypeOf("string");
      if (!definition.local) throw new Error(`Missing disabled-case port: ${definition.title}`);
      const path = resolve(repositoryDirectory, definition.local);
      const titles = availableTitles.get(path) ?? [...getLocalTitles(path)];
      const titleIndex = titles.indexOf(definition.title);
      expect(titleIndex, `${definition.local}: ${definition.title}`).toBeGreaterThanOrEqual(0);
      titles.splice(titleIndex, 1);
      availableTitles.set(path, titles);
    }
  });

  it("keeps local ports executable and new tests type checked", () => {
    for (const [path, definitions] of portDefinitions) {
      for (const definition of definitions) {
        expect(
          definition.modifiers.filter((modifier) =>
            ["skip", "skipIf", "todo", "only", "runIf"].includes(modifier),
          ),
          `${path}: ${definition.title}`,
        ).toEqual([]);
      }
    }
    for (const path of conformanceFiles)
      expect(readFileSync(path, "utf8"), path).not.toMatch(/^\s*\/\/\s*@ts-nocheck/m);
  });
});
