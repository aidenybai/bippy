import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { version as harnessReactVersion } from "react";
import { describe, expect, it } from "vite-plus/test";
import { ModuleResolver } from "../src/graph/module-resolver.js";
import { loadReactRuntime } from "../src/materialize/react-runtime.js";

const STUB_REACT_VERSION = "17.0.2-stub";

const REACT_STUB = `
module.exports = {
  version: ${JSON.stringify(STUB_REACT_VERSION)},
  createElement: () => null,
  createContext: () => ({}),
  Component: class Component {},
  act: (callback) => callback(),
};
`;

const REACT_DOM_STUB = `module.exports = { version: ${JSON.stringify(STUB_REACT_VERSION)}, createPortal: () => null };`;

const REACT_DOM_CLIENT_STUB =
  "module.exports = { createRoot: () => ({ render() {}, unmount() {} }) };";

const harnessRequire = createRequire(import.meta.url);

const reexport = (specifier: string, version?: string): string =>
  `module.exports = { ...require(${JSON.stringify(harnessRequire.resolve(specifier))})${
    version === undefined ? "" : `, version: ${JSON.stringify(version)}`
  } };`;

const VENDORED_REACT_VERSION = "19.0.0-vendored";

const VENDORED_PACKAGES = {
  react: "bundler/vendored/react",
  dom: "bundler/vendored/react-dom",
  domClient: "bundler/vendored/react-dom/client",
};

/** A bundled React build whose three modules share the harness's React internals. */
const writeVendoredReact = (rootDirectory: string, clientSource: string): void => {
  writePackage(rootDirectory, VENDORED_PACKAGES.react, reexport("react", VENDORED_REACT_VERSION));
  writePackage(rootDirectory, VENDORED_PACKAGES.dom, reexport("react-dom"), {
    "client.js": clientSource,
  });
};

const writePackage = (
  rootDirectory: string,
  name: string,
  source: string,
  extraFiles: Record<string, string> = {},
): void => {
  const packageDirectory = join(rootDirectory, "node_modules", name);
  mkdirSync(packageDirectory, { recursive: true });
  writeFileSync(join(packageDirectory, "package.json"), JSON.stringify({ name, main: "index.js" }));
  writeFileSync(join(packageDirectory, "index.js"), source);
  for (const [fileName, fileSource] of Object.entries(extraFiles)) {
    writeFileSync(join(packageDirectory, fileName), fileSource);
  }
};

const writeReactPair = (rootDirectory: string, hasClientEntry: boolean): void => {
  writePackage(rootDirectory, "react", REACT_STUB);
  writePackage(
    rootDirectory,
    "react-dom",
    REACT_DOM_STUB,
    hasClientEntry ? { "client.js": REACT_DOM_CLIENT_STUB } : {},
  );
};

const createRootDirectory = (): string =>
  mkdtempSync(join(tmpdir(), "bippy-parser-react-runtime-"));

describe("loadReactRuntime", () => {
  it("uses the harness's React when the app's react-dom has no client entry", async () => {
    const rootDirectory = mkdtempSync(join(tmpdir(), "bippy-parser-legacy-react-"));
    writePackage(rootDirectory, "react", "module.exports = { version: '16.14.0' };");
    writePackage(rootDirectory, "react-dom", "module.exports = { version: '16.14.0' };");
    const resolver = new ModuleResolver({ rootDirectory });
    expect(resolver.resolve("react", join(rootDirectory, "index.js"))).toMatchObject({
      kind: "external",
      filePath: join(rootDirectory, "node_modules", "react", "index.js"),
    });
    const runtime = await loadReactRuntime({ resolver, rootDirectory });
    expect(runtime.version).toBe(harnessReactVersion);
  });

  it("materializes with the app's React when react, react-dom and react-dom/client all resolve from it", async () => {
    const rootDirectory = createRootDirectory();
    writeReactPair(rootDirectory, true);
    const runtime = await loadReactRuntime({
      resolver: new ModuleResolver({ rootDirectory }),
      rootDirectory,
    });
    expect(runtime.version).toBe(STUB_REACT_VERSION);
  });

  it("loads the build a framework bundles in place of react when its packages resolve from the app", async () => {
    const rootDirectory = createRootDirectory();
    writeReactPair(rootDirectory, true);
    writeVendoredReact(rootDirectory, reexport("react-dom/client"));
    const runtime = await loadReactRuntime({
      resolver: new ModuleResolver({ rootDirectory }),
      rootDirectory,
      packages: VENDORED_PACKAGES,
    });
    expect(runtime.version).toBe(VENDORED_REACT_VERSION);
  });

  it("falls back to the app's own react when the bundled build does not resolve", async () => {
    const rootDirectory = createRootDirectory();
    writeReactPair(rootDirectory, true);
    const runtime = await loadReactRuntime({
      resolver: new ModuleResolver({ rootDirectory }),
      rootDirectory,
      packages: VENDORED_PACKAGES,
    });
    expect(runtime.version).toBe(STUB_REACT_VERSION);
  });

  it("falls back to the app's own react when the bundled client entry mounts through another react-dom", async () => {
    const rootDirectory = createRootDirectory();
    writeReactPair(rootDirectory, true);
    writeVendoredReact(rootDirectory, REACT_DOM_CLIENT_STUB);
    const runtime = await loadReactRuntime({
      resolver: new ModuleResolver({ rootDirectory }),
      rootDirectory,
      packages: VENDORED_PACKAGES,
    });
    expect(runtime.version).toBe(STUB_REACT_VERSION);
  });

  it("falls back when react-dom/client only resolves from an ancestor's newer react-dom", async () => {
    const workspaceDirectory = createRootDirectory();
    const rootDirectory = join(workspaceDirectory, "apps/site");
    writeReactPair(workspaceDirectory, true);
    writeReactPair(rootDirectory, false);
    const runtime = await loadReactRuntime({
      resolver: new ModuleResolver({ rootDirectory }),
      rootDirectory,
    });
    expect(runtime.version).toBe(harnessReactVersion);
  });
});
