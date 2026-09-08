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

const importResolved = async (
  resolver: ModuleResolver | null,
  specifier: string,
  fromDirectory: string | null,
): Promise<unknown> => {
  if (resolver && fromDirectory) {
    const resolution = resolver.resolve(specifier, `${fromDirectory}/index.js`);
    if (resolution.kind === "external" && resolution.filePath) {
      return unwrapModule(await import(pathToFileURL(resolution.filePath).href));
    }
  }
  return unwrapModule(await import(specifier));
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
  const [react, domClient, dom] = await Promise.all([
    importResolved(resolver, "react", rootDirectory),
    importResolved(resolver, "react-dom/client", rootDirectory),
    importResolved(resolver, "react-dom", rootDirectory),
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
    act: await loadAct(react, resolver, rootDirectory),
    version: react.version,
  };
};
