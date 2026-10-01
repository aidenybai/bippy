import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import type { CorpusEntry } from "../src/corpus/manifest.js";
import { parseDotenv, readProcessEnvironment } from "../src/corpus/process-environment.js";
import { getBundlerGlobal } from "../src/evaluate/bundler-globals.js";
import { primitiveValue, UNDEFINED_VALUE } from "../src/evaluate/values.js";

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
  it("is absent when neither variables nor dotenv files are declared", () => {
    const entry = { ...createEntry({ envFiles: undefined }), env: undefined };
    expect(readProcessEnvironment(entry, tmpdir())).toBeUndefined();
  });

  it("retains declared variables without assuming unlisted dotenv variables are unset", () => {
    const entry = createEntry({ envFiles: undefined, envPrefix: "REACT_APP_" });
    const declared = readProcessEnvironment(entry, tmpdir()) ?? null;
    expect(declared).toEqual({
      variables: { REACT_APP_REVIEW_ID: "42" },
      clientPrefix: "REACT_APP_",
      isPartial: true,
    });
    const environment = { declared, renderEnvironment: null };
    expect(getBundlerGlobal("process.env.REACT_APP_REVIEW_ID", environment)).toEqual(
      primitiveValue("42"),
    );
    expect(getBundlerGlobal("process.env.REACT_APP_UNLISTED", environment)?.kind).toBe("branch");
    expect(getBundlerGlobal("process.env.PRIVATE_UNLISTED", environment)).toEqual(UNDEFINED_VALUE);
  });

  it("keeps unlisted variables unset when the file list is complete", () => {
    const declared =
      readProcessEnvironment(createEntry({ envPrefix: "REACT_APP_" }), tmpdir()) ?? null;
    expect(
      getBundlerGlobal("process.env.REACT_APP_UNLISTED", { declared, renderEnvironment: null }),
    ).toEqual(UNDEFINED_VALUE);
  });

  it("does not assume an unspecified SPA uses Vite", () => {
    const declared = readProcessEnvironment(createEntry({}), tmpdir()) ?? null;
    expect(declared).toEqual({
      variables: { REACT_APP_REVIEW_ID: "42" },
      clientPrefix: undefined,
    });
    expect(
      getBundlerGlobal("process.env.REACT_APP_REVIEW_ID", { declared, renderEnvironment: null })
        ?.kind,
    ).toBe("branch");
    expect(
      getBundlerGlobal("process.env.REACT_APP_REVIEW_ID", {
        declared,
        renderEnvironment: "server",
      }),
    ).toEqual(primitiveValue("42"));
  });

  it("uses Vite's prefix when the app declares Vite", () => {
    const rootDirectory = mkdtempSync(path.join(tmpdir(), "bippy-parser-env-"));
    writeFileSync(
      path.join(rootDirectory, "package.json"),
      JSON.stringify({ devDependencies: { vite: "8.0.0" } }),
    );
    expect(readProcessEnvironment(createEntry({}), rootDirectory)?.clientPrefix).toBe("VITE_");
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
      clientPrefix: undefined,
    });
  });

  it("inlines `REACT_APP_*` for create-react-app, giving the first env file precedence", () => {
    const rootDirectory = mkdtempSync(path.join(tmpdir(), "bippy-parser-env-"));
    writeFileSync(
      path.join(rootDirectory, "package.json"),
      JSON.stringify({ dependencies: { "react-scripts": "5.0.1" } }),
    );
    writeFileSync(
      path.join(rootDirectory, ".env"),
      "REACT_APP_API_URL=https://api.example\nREACT_APP_AUTH_URL=https://auth.example\n",
    );
    writeFileSync(
      path.join(rootDirectory, ".env.development"),
      "DISABLE_NEW_JSX_TRANSFORM=true\nREACT_APP_API_URL=http://localhost:8989/api\n",
    );
    const entry = createEntry({ envFiles: [".env.development", ".env"] });
    expect(readProcessEnvironment(entry, rootDirectory)).toEqual({
      variables: {
        REACT_APP_REVIEW_ID: "42",
        DISABLE_NEW_JSX_TRANSFORM: "true",
        REACT_APP_API_URL: "http://localhost:8989/api",
        REACT_APP_AUTH_URL: "https://auth.example",
      },
      clientPrefix: "REACT_APP_",
    });
  });

  it("inlines `NEXT_PUBLIC_*` for Next", () => {
    const entry: CorpusEntry = { ...createEntry({}), framework: "next-app" };
    expect(readProcessEnvironment(entry, tmpdir())?.clientPrefix).toBe("NEXT_PUBLIC_");
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
