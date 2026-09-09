import path from "node:path";
import { pathToFileURL } from "node:url";
import { getRDTHook } from "bippy";
import { ReactRuntimeError } from "../errors.js";
import type { ModuleResolver } from "../graph/module-resolver.js";
import { ensureDomGlobals } from "./dom-environment.js";

export type ReactModule = typeof import("react");
export type ReactDomClientModule = typeof import("react-dom/client");
export type ReactDomModule = typeof import("react-dom");

/** Module specifiers of the React build the analyzed app is served with. */
export interface ReactPackageSpecifiers {
  react: string;
  dom: string;
  domClient: string;
}

export const DEFAULT_REACT_PACKAGES: ReactPackageSpecifiers = {
  react: "react",
  dom: "react-dom",
  domClient: "react-dom/client",
};

/**
 * The React installation the static tree is materialized with: the app's own
 * `react`/`react-dom` (or the build its framework bundles in their place) when
 * they resolve from the analyzed root, so the fibers React constructs carry the
 * same work tags and naming as the app's runtime. An app whose `react-dom` has
 * no `client` entry (React 17) is mounted with the harness's copy of all three
 * modules; mixing its `react` with a newer `react-dom` cannot render.
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

const resolveFromApp = (
  resolver: ModuleResolver | null,
  specifier: string,
  fromDirectory: string | null,
): string | null => {
  if (!resolver || !fromDirectory) return null;
  const resolution = resolver.resolve(specifier, `${fromDirectory}/index.js`);
  return resolution.kind === "external" && resolution.filePath ? resolution.filePath : null;
};

const importResolved = async (
  resolver: ModuleResolver | null,
  specifier: string,
  fromDirectory: string | null,
): Promise<unknown> => {
  const filePath = resolveFromApp(resolver, specifier, fromDirectory);
  return unwrapModule(
    await (filePath === null ? import(specifier) : import(pathToFileURL(filePath).href)),
  );
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
  const testUtils = await importResolved(resolver, "react-dom/test-utils", fromDirectory);
  if (hasAct(testUtils)) return testUtils.act;
  throw new ReactRuntimeError("neither React.act nor react-dom/test-utils act is available");
};

export interface LoadReactRuntimeOptions {
  /** Resolves `react`/`react-dom` the way the analyzed app does; falls back to the harness's own copy. */
  resolver?: ModuleResolver;
  rootDirectory?: string;
  /** The build to resolve from the app; `react`/`react-dom` themselves by default. */
  packages?: ReactPackageSpecifiers;
}

const runtimeCache = new Map<string, Promise<ReactRuntime>>();

export const loadReactRuntime = ({
  resolver,
  rootDirectory,
  packages = DEFAULT_REACT_PACKAGES,
}: LoadReactRuntimeOptions = {}): Promise<ReactRuntime> => {
  const cacheKey = `${rootDirectory ?? ""}\n${packages.react}\n${packages.dom}\n${packages.domClient}`;
  let pending = runtimeCache.get(cacheKey);
  if (!pending) {
    pending = load(resolver ?? null, rootDirectory ?? null, packages);
    runtimeCache.set(cacheKey, pending);
  }
  return pending;
};

/** React < 18 has no `react-dom/client`; a clone nested under another project would resolve that project's. */
const hasClientEntry = (
  resolver: ModuleResolver | null,
  rootDirectory: string | null,
  packages: ReactPackageSpecifiers,
): boolean => {
  const domPath = resolveFromApp(resolver, packages.dom, rootDirectory);
  const clientPath = resolveFromApp(resolver, packages.domClient, rootDirectory);
  return (
    domPath !== null && clientPath !== null && path.dirname(domPath) === path.dirname(clientPath)
  );
};

const load = async (
  resolver: ModuleResolver | null,
  rootDirectory: string | null,
  packages: ReactPackageSpecifiers,
): Promise<ReactRuntime> => {
  ensureDomGlobals();
  getRDTHook();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const appPackages = [packages, DEFAULT_REACT_PACKAGES].find((candidate) =>
    hasClientEntry(resolver, rootDirectory, candidate),
  );
  const appResolver = appPackages ? resolver : null;
  const loadedPackages = appPackages ?? DEFAULT_REACT_PACKAGES;
  const [react, domClient, dom] = await Promise.all([
    importResolved(appResolver, loadedPackages.react, rootDirectory),
    importResolved(appResolver, loadedPackages.domClient, rootDirectory),
    importResolved(appResolver, loadedPackages.dom, rootDirectory),
  ]);
  if (!isReactModule(react)) throw new ReactRuntimeError("could not load react");
  if (!isReactDomClientModule(domClient)) {
    throw new ReactRuntimeError("could not load react-dom/client");
  }
  if (!isReactDomModule(dom)) throw new ReactRuntimeError("could not load react-dom");
  return {
    react,
    domClient,
    dom,
    act: await loadAct(react, appResolver, rootDirectory),
    version: react.version,
  };
};
