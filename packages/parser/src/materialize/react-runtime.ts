import path from "node:path";
import { pathToFileURL } from "node:url";
import { getRDTHook } from "bippy";
import type { ModuleResolver } from "../graph/module-resolver.js";
import { ensureDomGlobals } from "./dom-environment.js";

export type ReactModule = typeof import("react");
export type ReactDomClientModule = typeof import("react-dom/client");
export type ReactDomModule = typeof import("react-dom");

/**
 * The React installation the static tree is materialized with: the app's own
 * `react`/`react-dom` when they resolve from the analyzed root, so the fibers
 * React constructs carry the same work tags and naming as the app's runtime.
 */
export interface ReactRuntime {
  react: ReactModule;
  domClient: ReactDomClientModule;
  dom: ReactDomModule;
  act: <T>(callback: () => T | Promise<T>) => Promise<T>;
  version: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isReactModule = (value: unknown): value is ReactModule =>
  isRecord(value) &&
  typeof value.createElement === "function" &&
  typeof value.createContext === "function" &&
  typeof value.Component === "function";

const isReactDomClientModule = (value: unknown): value is ReactDomClientModule =>
  isRecord(value) && typeof value.createRoot === "function";

const isReactDomModule = (value: unknown): value is ReactDomModule =>
  isRecord(value) && typeof value.createPortal === "function";

const unwrapModule = (loaded: unknown): unknown =>
  isRecord(loaded) && "default" in loaded && isRecord(loaded.default) ? loaded.default : loaded;

const REACT_SPECIFIERS = ["react", "react-dom/client", "react-dom"];

interface ReactModules {
  react: unknown;
  domClient: unknown;
  dom: unknown;
}

const resolveAppFile = (
  resolver: ModuleResolver | null,
  specifier: string,
  fromDirectory: string | null,
): string | null => {
  if (!resolver || !fromDirectory) return null;
  const resolution = resolver.resolve(specifier, `${fromDirectory}/index.js`);
  return resolution.kind === "external" ? resolution.filePath : null;
};

const importModule = async (specifier: string, filePath: string | null): Promise<unknown> =>
  unwrapModule(await import(filePath === null ? specifier : pathToFileURL(filePath).href));

const getPackageDirectory = (filePath: string, packageName: string): string | null => {
  const marker = `${path.sep}node_modules${path.sep}${packageName}${path.sep}`;
  const index = filePath.lastIndexOf(marker);
  return index === -1 ? null : filePath.slice(0, index + marker.length);
};

const isInsidePackage = (
  filePath: string,
  packageFilePath: string,
  packageName: string,
): boolean => {
  const packageDirectory = getPackageDirectory(packageFilePath, packageName);
  return packageDirectory !== null && filePath.startsWith(packageDirectory);
};

/**
 * React rejects elements created by another copy of itself, so the app's
 * installation is only used when `react-dom/client` resolves inside the same
 * `react-dom` package as `react-dom` and both report `react`'s version. A React 17
 * app (no `react-dom/client`) or one whose `react-dom/client` resolves to an
 * ancestor workspace's newer React otherwise falls back to the harness's pair.
 */
const resolveAppReactFiles = (
  resolver: ModuleResolver | null,
  fromDirectory: string | null,
): string[] | null => {
  const [reactFilePath, domClientFilePath, domFilePath] = REACT_SPECIFIERS.map((specifier) =>
    resolveAppFile(resolver, specifier, fromDirectory),
  );
  if (reactFilePath === null || domClientFilePath === null || domFilePath === null) return null;
  return isInsidePackage(domClientFilePath, domFilePath, "react-dom")
    ? [reactFilePath, domClientFilePath, domFilePath]
    : null;
};

const importReactModules = async (filePaths: (string | null)[]): Promise<ReactModules> => {
  const [react, domClient, dom] = await Promise.all(
    filePaths.map((filePath, index) => importModule(REACT_SPECIFIERS[index], filePath)),
  );
  return { react, domClient, dom };
};

const hasMatchingVersions = ({ react, dom }: ReactModules): boolean =>
  isRecord(react) && isRecord(dom) && react.version === dom.version;

const loadReactModules = async (
  resolver: ModuleResolver | null,
  rootDirectory: string | null,
): Promise<ReactModules> => {
  const appFilePaths = resolveAppReactFiles(resolver, rootDirectory);
  const appModules = appFilePaths === null ? null : await importReactModules(appFilePaths);
  return appModules !== null && hasMatchingVersions(appModules)
    ? appModules
    : importReactModules(REACT_SPECIFIERS.map(() => null));
};

const hasAct = (
  value: unknown,
): value is { act: <T>(callback: () => T | Promise<T>) => Promise<T> } =>
  isRecord(value) && typeof value.act === "function";

const loadAct = async (
  react: ReactModule,
  resolver: ModuleResolver | null,
  fromDirectory: string | null,
): Promise<ReactRuntime["act"]> => {
  if (hasAct(react)) return react.act;
  const testUtils = await importModule(
    "react-dom/test-utils",
    resolveAppFile(resolver, "react-dom/test-utils", fromDirectory),
  );
  if (hasAct(testUtils)) return testUtils.act;
  throw new Error("neither React.act nor react-dom/test-utils act is available");
};

export interface LoadReactRuntimeOptions {
  /** Resolves `react`/`react-dom` the way the analyzed app does; falls back to the harness's own copy. */
  resolver?: ModuleResolver;
  rootDirectory?: string;
}

const runtimeCache = new Map<string, Promise<ReactRuntime>>();

export const loadReactRuntime = ({
  resolver,
  rootDirectory,
}: LoadReactRuntimeOptions = {}): Promise<ReactRuntime> => {
  const cacheKey = rootDirectory ?? "";
  let pending = runtimeCache.get(cacheKey);
  if (!pending) {
    pending = load(resolver ?? null, rootDirectory ?? null);
    runtimeCache.set(cacheKey, pending);
  }
  return pending;
};

const load = async (
  resolver: ModuleResolver | null,
  rootDirectory: string | null,
): Promise<ReactRuntime> => {
  ensureDomGlobals();
  getRDTHook();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const { react, domClient, dom } = await loadReactModules(resolver, rootDirectory);
  if (!isReactModule(react)) throw new Error("could not load react");
  if (!isReactDomClientModule(domClient)) throw new Error("could not load react-dom/client");
  if (!isReactDomModule(dom)) throw new Error("could not load react-dom");
  return {
    react,
    domClient,
    dom,
    act: await loadAct(react, resolver, rootDirectory),
    version: react.version,
  };
};
