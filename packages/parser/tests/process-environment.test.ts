import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import type { CorpusEntry } from "../src/corpus/manifest.js";
import { readProcessEnvironment } from "../src/corpus/process-environment.js";

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
});
