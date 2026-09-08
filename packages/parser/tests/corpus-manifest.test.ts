import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { readCorpusManifest } from "../src/corpus/manifest.js";

const MANIFEST_PATH = path.resolve(import.meta.dirname, "../corpus/manifest.json");

const writeManifest = (entries: unknown[]): string => {
  const manifestPath = path.join(mkdtempSync(path.join(tmpdir(), "bippy-manifest-")), "m.json");
  writeFileSync(manifestPath, JSON.stringify({ entries }));
  return manifestPath;
};

describe("corpus manifest", () => {
  it("reads the checked-in manifest", () => {
    const { entries } = readCorpusManifest(MANIFEST_PATH);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((entry) => entry.static.rootDirectory.length > 0)).toBe(true);
  });

  it("names the offending field of a malformed entry", () => {
    const [entry] = readCorpusManifest(MANIFEST_PATH).entries;
    expect(() => readCorpusManifest(writeManifest([{ ...entry, framework: "gatsby" }]))).toThrow(
      /entries\[0\]\.framework/,
    );
    expect(() =>
      readCorpusManifest(
        writeManifest([{ ...entry, static: { ...entry?.static, globals: ["ENV"] } }]),
      ),
    ).toThrow(/entries\[0\]\.static\.globals/);
  });
});
