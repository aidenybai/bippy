import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { detectModuleBundler, readDocumentShell } from "../src/graph/module-transpiler.js";
import { getReactScriptsClientEnvironment } from "../src/graph/react-scripts.js";
import type { ProcessEnvironment } from "../src/types.js";

const createApp = (manifest: Record<string, unknown>, indexHtml: string | null): string => {
  const rootDirectory = mkdtempSync(path.join(tmpdir(), "react-scripts-"));
  writeFileSync(path.join(rootDirectory, "package.json"), JSON.stringify(manifest));
  if (indexHtml !== null) {
    mkdirSync(path.join(rootDirectory, "public"));
    writeFileSync(path.join(rootDirectory, "public", "index.html"), indexHtml);
  }
  return rootDirectory;
};

const createEnvironment = (variables: Record<string, string>): ProcessEnvironment => ({
  variables,
  clientPrefix: "REACT_APP_",
});

const CRA_MANIFEST = { dependencies: { "react-scripts": "5.0.1" } };

describe("react-scripts", () => {
  it("is the bundler of an app declaring `react-scripts` and serves `public/index.html` as the page", () => {
    const rootDirectory = createApp(
      CRA_MANIFEST,
      '<link href="%PUBLIC_URL%/favicon.ico" /><div id="root"></div>',
    );
    expect(detectModuleBundler(rootDirectory)).toBe("react-scripts");
    expect(readDocumentShell(rootDirectory, "react-scripts", null)).toBe(
      '<link href="/favicon.ico" /><div id="root"></div>',
    );
  });

  it("has no page when the app declares no `react-scripts` or ships no template", () => {
    expect(detectModuleBundler(createApp({ dependencies: { react: "18" } }, "<div />"))).toBe(
      "unknown",
    );
    expect(readDocumentShell(createApp(CRA_MANIFEST, null), "react-scripts", null)).toBeNull();
  });

  it("inlines the development client environment of `react-scripts start`", () => {
    const rootDirectory = createApp({ ...CRA_MANIFEST, homepage: "https://acme.dev/app" }, null);
    expect(getReactScriptsClientEnvironment(rootDirectory, null)).toEqual({
      NODE_ENV: "development",
      PUBLIC_URL: "/app",
      WDS_SOCKET_HOST: undefined,
      WDS_SOCKET_PATH: undefined,
      WDS_SOCKET_PORT: undefined,
      FAST_REFRESH: true,
    });
  });

  it("prefers `PUBLIC_URL` over `homepage`, keeps only `REACT_APP_*` variables and reads `FAST_REFRESH=false`", () => {
    const rootDirectory = createApp({ ...CRA_MANIFEST, homepage: "." }, null);
    const environment = createEnvironment({
      PUBLIC_URL: "https://cdn.acme.dev/static/",
      REACT_APP_API: "https://api.acme.dev",
      react_app_lower: "kept",
      SECRET_TOKEN: "hidden",
      WDS_SOCKET_PORT: "4000",
      FAST_REFRESH: "false",
    });
    expect(getReactScriptsClientEnvironment(rootDirectory, environment)).toEqual({
      NODE_ENV: "development",
      PUBLIC_URL: "/static",
      WDS_SOCKET_HOST: undefined,
      WDS_SOCKET_PATH: undefined,
      WDS_SOCKET_PORT: "4000",
      FAST_REFRESH: false,
      REACT_APP_API: "https://api.acme.dev",
      react_app_lower: "kept",
    });
    expect(getReactScriptsClientEnvironment(rootDirectory, createEnvironment({})).PUBLIC_URL).toBe(
      "",
    );
  });
});
