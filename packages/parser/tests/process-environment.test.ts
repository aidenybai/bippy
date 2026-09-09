import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import type { CorpusEntry } from "../src/corpus/manifest.js";
import { parseDotenv, readProcessEnvironment } from "../src/corpus/process-environment.js";

const createEntry = (overrides: Partial<CorpusEntry["static"]>): CorpusEntry => ({
  id: "fixture",
  repository: "https://example.invalid/fixture",
  revision: "0",
  description: "fixture",
  framework: "spa",
  workingDirectory: ".",
  install: "true",
  dev: "true",
  env: { REACT_APP_REVIEW_ID: "42" },
  url: "http://localhost/",
  static: { rootDirectory: ".", envFiles: [], ...overrides },
});

describe("process environment", () => {
  it("is absent until the manifest declares the dotenv files the server loads", () => {
    const entry = createEntry({ envFiles: undefined });
    expect(readProcessEnvironment(entry, tmpdir())).toBeUndefined();
  });

  it("uses the framework's client prefix by default", () => {
    expect(readProcessEnvironment(createEntry({}), tmpdir())).toEqual({
      variables: { REACT_APP_REVIEW_ID: "42" },
      clientPrefix: "VITE_",
    });
  });

  it("takes the bundler's configured envPrefix over the framework default", () => {
    expect(readProcessEnvironment(createEntry({ envPrefix: "REACT_APP_" }), tmpdir())).toEqual({
      variables: { REACT_APP_REVIEW_ID: "42" },
      clientPrefix: "REACT_APP_",
    });
  });

  it("layers dotenv files under the manifest env", () => {
    const rootDirectory = mkdtempSync(path.join(tmpdir(), "bippy-parser-env-"));
    writeFileSync(
      path.join(rootDirectory, ".env"),
      [
        'REACT_APP_REVIEW_ID="7"',
        "export REACT_APP_BRANCH='main' # comment",
        "PLAIN=value # note",
      ].join("\n"),
    );
    expect(readProcessEnvironment(createEntry({ envFiles: [".env"] }), rootDirectory)).toEqual({
      variables: { REACT_APP_REVIEW_ID: "42", REACT_APP_BRANCH: "main", PLAIN: "value" },
      clientPrefix: "VITE_",
    });
  });

  it("parses like dotenv: multi-line quotes, comments, last assignment wins", () => {
    const parsed = parseDotenv(
      [
        "# leading comment",
        'MODE="development"',
        "export URL=http://localhost:3002 # trailing comment",
        "EMPTY=",
        "KEY='line one",
        "line two'",
        'ESCAPED="a\\nb"',
        "SINGLE='a\\nb'",
        "COLON: spaced value",
        "URL=http://localhost:3003",
      ].join("\r\n"),
    );
    expect(parsed).toEqual({
      MODE: "development",
      URL: "http://localhost:3003",
      EMPTY: "",
      KEY: "line one\nline two",
      ESCAPED: "a\nb",
      SINGLE: "a\\nb",
      COLON: "spaced value",
    });
  });
});
