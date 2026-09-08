import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import type { CorpusEntry } from "../src/corpus/manifest.js";
import { readProcessEnvironment } from "../src/corpus/process-environment.js";

const createApp = (dependencies: Record<string, string>, files: Record<string, string>): string => {
  const rootDirectory = mkdtempSync(join(tmpdir(), "bippy-parser-env-"));
  writeFileSync(join(rootDirectory, "package.json"), JSON.stringify({ dependencies }));
  for (const [file, source] of Object.entries(files)) {
    writeFileSync(join(rootDirectory, file), source);
  }
  return rootDirectory;
};

const createEntry = (framework: CorpusEntry["framework"], envFiles: string[]): CorpusEntry => ({
  id: "app",
  repository: "https://example.invalid/app",
  revision: "0",
  description: "",
  framework,
  workingDirectory: ".",
  install: "",
  dev: "",
  env: { BROWSER: "none" },
  url: "http://localhost:3000/",
  static: { rootDirectory: ".", envFiles },
});

describe("process environment", () => {
  it("inlines `REACT_APP_*` for create-react-app, giving the first env file precedence", () => {
    const rootDirectory = createApp(
      { "react-scripts": "5.0.1" },
      {
        ".env": "REACT_APP_API_URL=https://api.example\nREACT_APP_AUTH_URL=https://auth.example\n",
        ".env.development":
          "DISABLE_NEW_JSX_TRANSFORM=true\nREACT_APP_API_URL=http://localhost:8989/api\n",
      },
    );
    const entry = createEntry("react-router", [".env.development", ".env"]);
    expect(readProcessEnvironment(entry, rootDirectory)).toEqual({
      variables: {
        BROWSER: "none",
        DISABLE_NEW_JSX_TRANSFORM: "true",
        REACT_APP_API_URL: "http://localhost:8989/api",
        REACT_APP_AUTH_URL: "https://auth.example",
      },
      clientPrefix: "REACT_APP_",
    });
  });

  it("inlines `VITE_*` for other single-page apps and `NEXT_PUBLIC_*` for Next", () => {
    const rootDirectory = createApp({ vite: "6.0.0" }, { ".env": "VITE_TITLE='Hello' # title\n" });
    expect(readProcessEnvironment(createEntry("spa", [".env"]), rootDirectory)).toEqual({
      variables: { BROWSER: "none", VITE_TITLE: "Hello" },
      clientPrefix: "VITE_",
    });
    expect(
      readProcessEnvironment(createEntry("next-app", [".env"]), rootDirectory)?.clientPrefix,
    ).toBe("NEXT_PUBLIC_");
  });
});
