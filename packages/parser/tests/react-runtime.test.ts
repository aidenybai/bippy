import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { ModuleResolver } from "../src/graph/module-resolver.js";
import { loadReactRuntime } from "../src/materialize/react-runtime.js";

const STUB_REACT_VERSION = "17.0.2-stub";

const REACT_STUB = `
module.exports = {
  version: ${JSON.stringify(STUB_REACT_VERSION)},
  createElement: () => null,
  createContext: (defaultValue) => ({ _currentValue: defaultValue }),
  Component: class Component {},
  act: (callback) => callback(),
  __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED: {
    ReactCurrentDispatcher: { current: { readContext: (context) => context._currentValue } },
  },
};
`;

const REACT_DOM_STUB = `module.exports = { version: ${JSON.stringify(STUB_REACT_VERSION)}, createPortal: () => null };`;

const LEGACY_REACT_DOM_STUB = `
module.exports = {
  version: ${JSON.stringify(STUB_REACT_VERSION)},
  createPortal: () => null,
  render: (element, container) => { container.textContent = "legacy:" + element; },
  unmountComponentAtNode: (container) => { container.textContent = ""; return true; },
};
`;

const REACT_DOM_CLIENT_STUB =
  "module.exports = { createRoot: (container) => ({ render(element) { container.textContent = 'concurrent:' + element; }, unmount() {} }) };";

const noop = (): void => {};

const rootCallbacks = { onUncaughtError: noop, onCaughtError: noop };

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
    hasClientEntry ? REACT_DOM_STUB : LEGACY_REACT_DOM_STUB,
    hasClientEntry ? { "client.js": REACT_DOM_CLIENT_STUB } : {},
  );
};

const createRootDirectory = (): string =>
  mkdtempSync(join(tmpdir(), "bippy-parser-react-runtime-"));

describe("loadReactRuntime", () => {
  it("mounts a legacy ReactDOM.render root when the app's react-dom has no client entry", async () => {
    const rootDirectory = mkdtempSync(join(tmpdir(), "bippy-parser-legacy-react-"));
    writeReactPair(rootDirectory, false);
    const resolver = new ModuleResolver({ rootDirectory });
    expect(resolver.resolve("react", join(rootDirectory, "index.js"))).toMatchObject({
      kind: "external",
      filePath: join(rootDirectory, "node_modules", "react", "index.js"),
    });
    const runtime = await loadReactRuntime({ resolver, rootDirectory });
    expect(runtime.version).toBe(STUB_REACT_VERSION);
    const container = document.createElement("div");
    const root = runtime.createRoot(container, rootCallbacks);
    root.render("tree");
    expect(container.textContent).toBe("legacy:tree");
    root.unmount();
    expect(container.textContent).toBe("");
    expect(runtime.readContext(runtime.react.createContext("provided"))).toBe("provided");
  });

  it("materializes with the app's React when react, react-dom and react-dom/client all resolve from it", async () => {
    const rootDirectory = createRootDirectory();
    writeReactPair(rootDirectory, true);
    const runtime = await loadReactRuntime({
      resolver: new ModuleResolver({ rootDirectory }),
      rootDirectory,
    });
    expect(runtime.version).toBe(STUB_REACT_VERSION);
    const container = document.createElement("div");
    runtime.createRoot(container, rootCallbacks).render("tree");
    expect(container.textContent).toBe("concurrent:tree");
  });

  it("uses the app's own legacy react-dom when react-dom/client only resolves from an ancestor's newer react-dom", async () => {
    const workspaceDirectory = createRootDirectory();
    const rootDirectory = join(workspaceDirectory, "apps/site");
    writeReactPair(workspaceDirectory, true);
    writeReactPair(rootDirectory, false);
    const runtime = await loadReactRuntime({
      resolver: new ModuleResolver({ rootDirectory }),
      rootDirectory,
    });
    expect(runtime.version).toBe(STUB_REACT_VERSION);
    const container = document.createElement("div");
    runtime.createRoot(container, rootCallbacks).render("tree");
    expect(container.textContent).toBe("legacy:tree");
  });
});
