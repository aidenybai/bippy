import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export interface ReactVersionFixture {
  label: string;
  major: number;
  reactDOMPackageName: string;
  reactPackageName: string;
}

export interface IsolatedReactRuntime {
  bippyEntryUrl: string;
  directory: string;
  reactDOMClientUrl: string;
  reactDOMProfilingUrl: string;
  reactDOMServerUrl: string;
  reactDOMUrl: string;
  reactUrl: string;
}

export type ReactBuildMode = "development" | "production" | "profiling";

const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../../../bippy");
const packageRequire = createRequire(import.meta.url);
const runtimeDirectories: string[] = [];
const runtimeCache = new Map<string, IsolatedReactRuntime>();

export const reactVersionFixtures: ReactVersionFixture[] = [
  {
    label: "16.14",
    major: 16,
    reactPackageName: "react-16-14",
    reactDOMPackageName: "react-dom-16-14",
  },
  { label: "17", major: 17, reactPackageName: "react-17", reactDOMPackageName: "react-dom-17" },
  { label: "18", major: 18, reactPackageName: "react-18", reactDOMPackageName: "react-dom-18" },
  { label: "19", major: 19, reactPackageName: "react", reactDOMPackageName: "react-dom" },
  {
    label: "canary",
    major: 19,
    reactPackageName: "react-canary",
    reactDOMPackageName: "react-dom-canary",
  },
  {
    label: "experimental",
    major: 19,
    reactPackageName: "react-experimental",
    reactDOMPackageName: "react-dom-experimental",
  },
];

const copyPackage = (
  sourcePackageJsonPath: string,
  targetPackageName: string,
  runtimeNodeModules: string,
  copiedPackages: Set<string>,
): void => {
  if (copiedPackages.has(targetPackageName)) return;
  copiedPackages.add(targetPackageName);

  const targetDirectory = join(runtimeNodeModules, ...targetPackageName.split("/"));
  mkdirSync(dirname(targetDirectory), { recursive: true });
  cpSync(dirname(realpathSync(sourcePackageJsonPath)), targetDirectory, {
    dereference: true,
    recursive: true,
  });

  const packageJson = JSON.parse(readFileSync(sourcePackageJsonPath, "utf8"));
  const sourceRequire = createRequire(sourcePackageJsonPath);
  for (const dependencyName of Object.keys(packageJson.dependencies ?? {})) {
    if (dependencyName === "react" && copiedPackages.has("react")) continue;
    const dependencyPackageJsonPath = sourceRequire.resolve(`${dependencyName}/package.json`);
    copyPackage(dependencyPackageJsonPath, dependencyName, runtimeNodeModules, copiedPackages);
  }
};

// Runtimes are read-only copies, so one per fixture per worker keeps parallel test files from
// spending their subprocess timeouts copying node_modules trees.
export const createIsolatedReactRuntime = (fixture: ReactVersionFixture): IsolatedReactRuntime => {
  const cachedRuntime = runtimeCache.get(fixture.label);
  if (cachedRuntime) return cachedRuntime;
  const directory = mkdtempSync(join(tmpdir(), `bippy-react-${fixture.label}-`));
  runtimeDirectories.push(directory);
  const runtimeNodeModules = join(directory, "node_modules");
  mkdirSync(runtimeNodeModules, { recursive: true });
  const copiedPackages = new Set<string>();

  copyPackage(
    packageRequire.resolve(`${fixture.reactPackageName}/package.json`),
    "react",
    runtimeNodeModules,
    copiedPackages,
  );
  copyPackage(
    packageRequire.resolve(`${fixture.reactDOMPackageName}/package.json`),
    "react-dom",
    runtimeNodeModules,
    copiedPackages,
  );

  // Profiling builds before React 18 require the profiling scheduler tracing entry, which
  // bundlers normally alias for the profiling build.
  for (const schedulerDirectory of [
    join(runtimeNodeModules, "scheduler"),
    join(runtimeNodeModules, "react-dom/node_modules/scheduler"),
  ]) {
    if (!existsSync(join(schedulerDirectory, "tracing-profiling.js"))) continue;
    writeFileSync(
      join(schedulerDirectory, "tracing.js"),
      "module.exports = require('./tracing-profiling.js');\n",
    );
  }

  const bippyDirectory = join(runtimeNodeModules, "bippy");
  mkdirSync(bippyDirectory, { recursive: true });
  cpSync(resolve(packageDirectory, "src"), join(bippyDirectory, "src"), { recursive: true });
  writeFileSync(
    join(bippyDirectory, "package.json"),
    JSON.stringify({ name: "bippy", type: "module" }),
  );

  const runtime: IsolatedReactRuntime = {
    bippyEntryUrl: pathToFileURL(join(bippyDirectory, "src/index.ts")).href,
    directory,
    reactDOMClientUrl: pathToFileURL(join(runtimeNodeModules, "react-dom/client.js")).href,
    reactDOMProfilingUrl: pathToFileURL(join(runtimeNodeModules, "react-dom/profiling.js")).href,
    reactDOMServerUrl: pathToFileURL(join(runtimeNodeModules, "react-dom/server.js")).href,
    reactDOMUrl: pathToFileURL(join(runtimeNodeModules, "react-dom/index.js")).href,
    reactUrl: pathToFileURL(join(runtimeNodeModules, "react/index.js")).href,
  };
  runtimeCache.set(fixture.label, runtime);
  return runtime;
};

export const removeIsolatedReactRuntimes = (): void => {
  runtimeCache.clear();
  for (const directory of runtimeDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
};

export const createBrowserBootstrapScript = (): string => `
  import { Window } from "happy-dom";
  const browserWindow = new Window({ url: "http://localhost" });
  globalThis.window = browserWindow;
  globalThis.document = browserWindow.document;
  globalThis.Node = browserWindow.Node;
  globalThis.HTMLElement = browserWindow.HTMLElement;
  globalThis.Element = browserWindow.Element;
  globalThis.requestAnimationFrame = browserWindow.requestAnimationFrame.bind(browserWindow);
  globalThis.cancelAnimationFrame = browserWindow.cancelAnimationFrame.bind(browserWindow);
`;

export const createReactImportScript = (
  runtime: IsolatedReactRuntime,
  fixture: ReactVersionFixture,
  mode: ReactBuildMode,
): string => `
  const Bippy = await import(${JSON.stringify(runtime.bippyEntryUrl)});
  globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE = () => {};
  const ReactModule = await import(${JSON.stringify(runtime.reactUrl)});
  const React = ReactModule.default ?? ReactModule;
  const ReactDOMModule = await import(${JSON.stringify(mode === "profiling" ? runtime.reactDOMProfilingUrl : runtime.reactDOMUrl)});
  const ReactDOM = ReactDOMModule.default ?? ReactDOMModule;
  const ReactDOMServerModule = await import(${JSON.stringify(runtime.reactDOMServerUrl)});
  const ReactDOMServer = ReactDOMServerModule.default ?? ReactDOMServerModule;
  const ReactDOMClientModule = ${
    fixture.major >= 18
      ? mode === "profiling"
        ? "ReactDOMModule"
        : `await import(${JSON.stringify(runtime.reactDOMClientUrl)})`
      : "null"
  };
  const ReactDOMClient = ReactDOMClientModule?.default ?? ReactDOMClientModule;
`;
