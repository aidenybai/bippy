import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { version as harnessReactVersion } from "react";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { ModuleResolver } from "../src/graph/module-resolver.js";
import { loadReactRuntime } from "../src/materialize/react-runtime.js";

const STUB_REACT_VERSION = "17.0.2-stub";

const REACT_STUB = `
exports.version = ${JSON.stringify(STUB_REACT_VERSION)};
exports.createElement = () => null;
exports.createContext = () => ({});
exports.Component = class Component {};
exports.act = (callback) => callback();
`;

const REACT_DOM_STUB = `
exports.version = ${JSON.stringify(STUB_REACT_VERSION)};
exports.createPortal = () => null;
`;
const REACT_DOM_CLIENT_STUB = "exports.createRoot = () => ({ render() {}, unmount() {} });";

interface StubReactInstallation {
  rootDirectory: string;
  hasClientEntry: boolean;
}

const writePackage = (directory: string, name: string, files: Record<string, string>): void => {
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, "package.json"),
    JSON.stringify({ name, version: "0.0.0", main: "index.js" }),
  );
  for (const [fileName, source] of Object.entries(files)) {
    writeFileSync(join(directory, fileName), source);
  }
};

const createStubInstallation = ({ rootDirectory, hasClientEntry }: StubReactInstallation): void => {
  writePackage(join(rootDirectory, "node_modules/react"), "react", { "index.js": REACT_STUB });
  writePackage(join(rootDirectory, "node_modules/react-dom"), "react-dom", {
    "index.js": REACT_DOM_STUB,
    ...(hasClientEntry ? { "client.js": REACT_DOM_CLIENT_STUB } : {}),
  });
};

const temporaryDirectories: string[] = [];

const createRootDirectory = (): string => {
  const rootDirectory = mkdtempSync(join(tmpdir(), "bippy-react-runtime-"));
  temporaryDirectories.push(rootDirectory);
  return rootDirectory;
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true });
});

describe("react runtime selection", () => {
  it("materializes with the app's React when react, react-dom and react-dom/client all resolve from it", async () => {
    const rootDirectory = createRootDirectory();
    createStubInstallation({ rootDirectory, hasClientEntry: true });
    const runtime = await loadReactRuntime({
      resolver: new ModuleResolver({ rootDirectory }),
      rootDirectory,
    });
    expect(runtime.version).toBe(STUB_REACT_VERSION);
  });

  it("falls back to the harness's React pair when the app's react-dom has no client entry", async () => {
    const rootDirectory = createRootDirectory();
    createStubInstallation({ rootDirectory, hasClientEntry: false });
    const runtime = await loadReactRuntime({
      resolver: new ModuleResolver({ rootDirectory }),
      rootDirectory,
    });
    expect(runtime.version).toBe(harnessReactVersion);
  });

  it("falls back when react-dom/client only resolves from an ancestor's newer react-dom", async () => {
    const workspaceDirectory = createRootDirectory();
    const rootDirectory = join(workspaceDirectory, "apps/site");
    createStubInstallation({ rootDirectory: workspaceDirectory, hasClientEntry: true });
    createStubInstallation({ rootDirectory, hasClientEntry: false });
    const runtime = await loadReactRuntime({
      resolver: new ModuleResolver({ rootDirectory }),
      rootDirectory,
    });
    expect(runtime.version).toBe(harnessReactVersion);
  });
});
