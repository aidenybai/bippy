import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { readCorpusManifest } from "../src/corpus/manifest.js";
import { readSavedCapture } from "../src/corpus/run-entry.js";
import { SchemaError, StaleCaptureError } from "../src/errors.js";

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
      SchemaError,
    );
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

describe("saved captures", () => {
  const [entry] = readCorpusManifest(MANIFEST_PATH).entries;
  if (entry === undefined) throw new Error("the checked-in manifest has no entries");
  const writeCapture = (capture: unknown): string => {
    const outputDirectory = mkdtempSync(path.join(tmpdir(), "bippy-capture-"));
    writeFileSync(path.join(outputDirectory, `${entry.id}.capture.json`), JSON.stringify(capture));
    return outputDirectory;
  };

  it("has nothing to replay without a capture", () => {
    expect(readSavedCapture(mkdtempSync(path.join(tmpdir(), "bippy-capture-")), entry)).toBeNull();
  });

  it("rejects a capture that does not match its schema", () => {
    expect(() => readSavedCapture(writeCapture({ revision: entry.revision }), entry)).toThrow(
      SchemaError,
    );
  });

  it("refuses to replay a capture from another revision", () => {
    const stale = writeCapture({
      revision: "0000000000000000000000000000000000000000",
      snapshot: { roots: [] },
      commits: 1,
      pageErrors: [],
      title: "",
    });
    expect(() => readSavedCapture(stale, entry)).toThrow(StaleCaptureError);
  });
});
