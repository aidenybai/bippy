import path from "node:path";
import { pathToFileURL } from "node:url";
import { getRDTHook } from "bippy";
import { ReactRuntimeError } from "../errors.js";
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

const RUNTIME_SPECIFIERS = ["react", "react-dom/client", "react-dom"];

const resolveExternalFile = (
  resolver: ModuleResolver | null,
  specifier: string,
  fromDirectory: string | null,
): string | null => {
  if (!resolver || !fromDirectory) return null;
  const resolution = resolver.resolve(specifier, `${fromDirectory}/index.js`);
  return resolution.kind === "external" && resolution.filePath ? resolution.filePath : null;
};

/**
 * The app's installation is used only when every runtime module resolves from
 * the package its specifier names: a subpath React 16/17 lacks (`react-dom/client`)
 * otherwise resolves further up the directory tree to the harness's own copy,
 * which would render one React's elements with another's reconciler.
 */
const isAppRuntimeComplete = (
  resolver: ModuleResolver | null,
  fromDirectory: string | null,
): boolean =>
  RUNTIME_SPECIFIERS.every((specifier) => {
    const packageName = specifier.split("/")[0];
    const manifestPath = resolveExternalFile(
      resolver,
      `${packageName}/package.json`,
      fromDirectory,
    );
    const filePath = resolveExternalFile(resolver, specifier, fromDirectory);
    return (
      manifestPath !== null &&
      filePath !== null &&
      filePath.startsWith(`${path.dirname(manifestPath)}${path.sep}`)
    );
  });

const importResolved = async (
  resolver: ModuleResolver | null,
  specifier: string,
  fromDirectory: string | null,
): Promise<unknown> => {
  const filePath = resolveExternalFile(resolver, specifier, fromDirectory);
  return unwrapModule(await import(filePath ? pathToFileURL(filePath).href : specifier));
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
  const appResolver = isAppRuntimeComplete(resolver, rootDirectory) ? resolver : null;
  const [react, domClient, dom] = await Promise.all(
    RUNTIME_SPECIFIERS.map((specifier) => importResolved(appResolver, specifier, rootDirectory)),
  );
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
