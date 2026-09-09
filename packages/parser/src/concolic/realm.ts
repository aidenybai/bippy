import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import vm from "node:vm";
import { transformSync } from "esbuild";
import { Window } from "happy-dom";
import { getRDTHook } from "bippy";
import { ConcolicLoadError } from "../errors.js";
import { DEFAULT_BROWSER_ENVIRONMENT } from "../evaluate/media-query.js";
import { readAssetModuleSource } from "../graph/asset-modules.js";
import { isAssetImport } from "../graph/asset-module.js";
import { isCssModulePath } from "../graph/css-module.js";
import {
  hasEsmSyntax,
  isInsideNodeModules,
  type ImporterKind,
  type ModuleResolver,
} from "../graph/module-resolver.js";
import { getSourceLanguage } from "../parse/parse-source-file.js";
import type { JsonValue, ProcessEnvironment } from "../types.js";
import { DecisionLog, type PinnedDecision } from "./decisions.js";
import { createHooks, type ConcolicHooks, type RealmIntrinsics } from "./hooks.js";
import { instrumentSource, SiteTable } from "./instrument.js";
import { SymbolicSpace } from "./symbolic.js";

// One realm per explored path: a fresh happy-dom window (which is itself a
// node:vm context), fresh module instances, a fresh React, and a fresh symbolic
// space. Only the transformed sources are shared between paths.

export interface RealmEnvironment {
  /** Variables the dev server runs with; null when unknown, making every undeclared variable symbolic. */
  declared: ProcessEnvironment | null;
  /** Bundler `define` replacements keyed by source text (`process.env.FOO`, `__DEV__`). */
  defines: Record<string, JsonValue>;
}

export interface TransformedModule {
  code: string;
  isInstrumented: boolean;
  importer: ImporterKind;
  directives: string[];
}

/** Transformed sources, shared across the paths of one exploration. */
export class TransformCache {
  readonly modules = new Map<string, TransformedModule>();
  readonly sites = new SiteTable();
  skippedOperations = 0;
  instrumentedFiles = 0;
  externalFiles = 0;
}

export interface ConcolicRealmOptions {
  rootDirectory: string;
  /** Files are served at `/` relative to this directory (Vite `root`). */
  servedDirectory: string;
  url: string;
  resolver: ModuleResolver;
  /** Application code is instrumented; everything else runs as written. */
  isApplicationFile: (filePath: string) => boolean;
  environment: RealmEnvironment;
  cache: TransformCache;
  pinned: PinnedDecision[];
  /** `window` properties the served page defines before any module runs. */
  globals: Record<string, JsonValue>;
}

interface ModuleRecord {
  exports: unknown;
  id: string;
  filename: string;
  loaded: boolean;
}

const STYLE_EXTENSIONS = new Set([
  ".css",
  ".scss",
  ".sass",
  ".less",
  ".styl",
  ".stylus",
  ".pcss",
  ".postcss",
]);
const DEV_SERVER_MODE = "development";
const VITE_ENVIRONMENT: Record<string, string | boolean> = {
  MODE: DEV_SERVER_MODE,
  DEV: true,
  PROD: false,
  SSR: false,
  BASE_URL: "/",
};
const REACT_JSX_RUNTIME_FILES =
  /[\\/]react[\\/](?:cjs[\\/])?(?:react-)?jsx-(?:dev-)?runtime(?:\.development|\.production(?:\.min)?)?\.js$/;
const REACT_INDEX_FILES =
  /[\\/]react[\\/](?:index\.js|cjs[\\/]react\.development\.js|cjs[\\/]react\.production(?:\.min)?\.js)$/;

const hostRequire = createRequire(import.meta.url);

const getEsbuildLoader = (filePath: string): "js" | "jsx" | "ts" | "tsx" | "json" => {
  const lang = getSourceLanguage(filePath);
  switch (lang) {
    case "ts":
      return "ts";
    case "tsx":
      return "tsx";
    case "json":
      return "json";
    case "jsx":
      return "jsx";
    default:
      return "js";
  }
};

const toDefineValue = (value: JsonValue): string => JSON.stringify(value);

// HACK: esbuild applies Node's ESM-from-CJS interop (`default` = module.exports)
// to `.mjs`/`.mts` importers; bundlers serving a browser do not, so the loader
// extension is appended to hide the real one.

const transformModule = (
  filePath: string,
  sourceText: string,
  isApplication: boolean,
  cache: TransformCache,
  displayPath: string,
  defines: Record<string, JsonValue>,
  tsconfigRaw: string | undefined,
): TransformedModule => {
  const lang = getSourceLanguage(filePath);
  let code = sourceText;
  let directives: string[] = [];
  if (isApplication && lang !== null && lang !== "json") {
    const instrumented = instrumentSource({
      filePath,
      displayPath,
      sourceText,
      lang,
      sites: cache.sites,
    });
    cache.skippedOperations += instrumented.skipped;
    cache.instrumentedFiles++;
    code = instrumented.code;
    directives = instrumented.directives;
  } else {
    cache.externalFiles++;
  }
  const define: Record<string, string> = {
    "import.meta": "__concolic_import_meta",
    "process.env.NODE_ENV": JSON.stringify(DEV_SERVER_MODE),
  };
  if (isApplication) {
    for (const [name, value] of Object.entries(defines)) define[name] = toDefineValue(value);
  }
  const result = transformSync(code, {
    loader: getEsbuildLoader(filePath),
    format: "cjs",
    target: "esnext",
    jsx: "automatic",
    sourcefile: `${filePath}.${getEsbuildLoader(filePath)}`,
    keepNames: true,
    define,
    supported: { "dynamic-import": false },
    tsconfigRaw: isApplication ? tsconfigRaw : undefined,
    legalComments: "inline",
    logLevel: "silent",
  });
  const importer: ImporterKind = hasEsmSyntax(sourceText) ? "esm" : "commonjs";
  return { code: result.code, isInstrumented: isApplication, importer, directives };
};

const USE_SERVER_DIRECTIVE = "use server";

/** What the client bundle holds for a `"use server"` module: references whose results arrive from the server. */
const createServerReferenceModule = (space: SymbolicSpace, displayPath: string): unknown =>
  new Proxy<Record<string, unknown>>(
    { __esModule: true },
    {
      get: (target, property) => {
        if (typeof property !== "string" || property in target) return target[String(property)];
        target[property] = (): Promise<unknown> =>
          Promise.resolve(space.source("server-action", `${displayPath}#${property}`, "unknown"));
        return target[property];
      },
    },
  );

export interface ConcolicRealm {
  window: Window;
  space: SymbolicSpace;
  decisions: DecisionLog;
  hooks: ConcolicHooks;
  require: (specifier: string, fromFile: string) => unknown;
  /** Uncaught exceptions the page raised from timers, listeners and rejected promises. */
  pageErrors: string[];
  /** Runs a module with a fresh instance even when it is already cached; used for the entry. */
  load: (filePath: string) => unknown;
  dispose: () => Promise<void>;
}

const MODULE_PARAMETERS = [
  "exports",
  "require",
  "module",
  "__filename",
  "__dirname",
  "J$",
  "__concolic_import_meta",
];

export const createConcolicRealm = (options: ConcolicRealmOptions): ConcolicRealm => {
  const window = new Window({
    url: options.url,
    width: DEFAULT_BROWSER_ENVIRONMENT.viewportWidth,
    height: DEFAULT_BROWSER_ENVIRONMENT.viewportHeight,
    settings: {
      disableCSSFileLoading: true,
      disableJavaScriptFileLoading: true,
      handleDisabledFileLoadingAsSuccess: true,
    },
  });
  const pageErrors: string[] = [];
  window.addEventListener("error", (event) => {
    const detail: unknown = "error" in event ? event.error : null;
    pageErrors.push(
      detail instanceof Error
        ? (detail.stack ?? detail.message)
        : "message" in event
          ? String(event.message)
          : String(detail),
    );
  });
  const context: vm.Context = window;
  const intrinsics: RealmIntrinsics = vm.runInContext(
    "({ Object, Array, Function, String, Number, Boolean, Symbol, JSON, Math, Date, RegExp, Promise, Map, Set, Reflect, Error })",
    context,
  );
  const decisions = new DecisionLog(options.pinned);
  const space = new SymbolicSpace(decisions);
  const hooks = createHooks(space, options.cache.sites.locations, intrinsics, [
    { native: intrinsics.Math.random, kind: "random", name: "Math.random", type: "number" },
    { native: window.crypto.randomUUID, kind: "random", name: "crypto.randomUUID", type: "string" },
    { native: intrinsics.Date.now, kind: "clock", name: "Date.now", type: "number" },
    { native: intrinsics.Date, kind: "clock", name: "new Date", type: "object" },
    { native: window.performance.now, kind: "clock", name: "performance.now", type: "number" },
  ]);
  const environmentProxy = createEnvironmentProxy(space, options.environment);
  installHostGlobals(window, space, options, environmentProxy);

  const modules = new Map<string, ModuleRecord>();
  const tsconfigRaw = readTsconfigRaw(options.rootDirectory);

  const evaluate = (
    moduleKey: string,
    filePath: string,
    transformed: TransformedModule,
  ): ModuleRecord => {
    const moduleRecord: ModuleRecord = {
      exports: new intrinsics.Object(),
      id: filePath,
      filename: filePath,
      loaded: false,
    };
    modules.set(moduleKey, moduleRecord);
    const compiled = vm.compileFunction(transformed.code, MODULE_PARAMETERS, {
      filename: filePath,
      parsingContext: context,
    });
    const requireFrom = (specifier: string): unknown =>
      requireModule(specifier, filePath, transformed.importer);
    const importMeta = {
      url: pathToFileURL(filePath).href,
      env: environmentProxy,
      hot: undefined,
    };
    compiled.call(
      undefined,
      moduleRecord.exports,
      requireFrom,
      moduleRecord,
      filePath,
      path.dirname(filePath),
      hooks,
      importMeta,
    );
    moduleRecord.loaded = true;
    wrapReactFactories(filePath, moduleRecord.exports, hooks);
    return moduleRecord;
  };

  const loadFile = (filePath: string, specifier: string): unknown => {
    const queryIndex = specifier.indexOf("?");
    const moduleKey = queryIndex === -1 ? filePath : `${filePath}${specifier.slice(queryIndex)}`;
    const cached = modules.get(moduleKey);
    if (cached) return cached.exports;
    const synthetic = loadSyntheticModule(filePath, specifier, options);
    if (synthetic !== null) {
      modules.set(moduleKey, {
        exports: synthetic,
        id: filePath,
        filename: filePath,
        loaded: true,
      });
      return synthetic;
    }
    let transformed = options.cache.modules.get(moduleKey);
    if (!transformed) {
      const isApplication = options.isApplicationFile(filePath) && !isInsideNodeModules(filePath);
      transformed = transformModule(
        filePath,
        readModuleSource(filePath, specifier),
        isApplication,
        options.cache,
        path.relative(options.rootDirectory, filePath),
        options.environment.defines,
        tsconfigRaw,
      );
      options.cache.modules.set(moduleKey, transformed);
    }
    if (transformed.directives.includes(USE_SERVER_DIRECTIVE)) {
      const serverReferences = createServerReferenceModule(
        space,
        path.relative(options.rootDirectory, filePath),
      );
      modules.set(moduleKey, {
        exports: serverReferences,
        id: filePath,
        filename: filePath,
        loaded: true,
      });
      return serverReferences;
    }
    return evaluate(moduleKey, filePath, transformed).exports;
  };

  const requireModule = (specifier: string, fromFile: string, importer: ImporterKind): unknown => {
    const resolution = options.resolver.resolve(specifier, fromFile, importer);
    switch (resolution.kind) {
      case "builtin":
        return hostRequire(resolution.specifier);
      case "internal":
        return loadFile(resolution.filePath, specifier);
      case "external":
        if (resolution.filePath === null) {
          throw new ConcolicLoadError(
            specifier,
            fromFile,
            `package ${resolution.packageName} is not installed`,
          );
        }
        return loadFile(resolution.filePath, specifier);
      case "unresolved":
        // HACK: oxc-resolver reports a `"browser": { "./x.js": false }` mapping as this error string; bundlers substitute an empty module.
        if (resolution.error.startsWith("Path is ignored")) return new intrinsics.Object();
        throw new ConcolicLoadError(specifier, fromFile, resolution.error);
    }
  };

  return {
    window,
    space,
    decisions,
    hooks,
    pageErrors,
    require: (specifier, fromFile) => requireModule(specifier, fromFile, "esm"),
    load: (filePath) => loadFile(filePath, filePath),
    dispose: async () => {
      await window.happyDOM.abort();
      window.close();
    },
  };
};

const readModuleSource = (filePath: string, specifier: string): string => {
  const asset = readAssetModuleSource(filePath, specifier);
  if (asset) return asset.sourceText;
  return readFileSync(filePath, "utf8");
};

const readTsconfigRaw = (rootDirectory: string): string | undefined => {
  const tsconfigPath = path.join(rootDirectory, "tsconfig.json");
  try {
    return readFileSync(tsconfigPath, "utf8");
  } catch {
    return undefined;
  }
};

/** Stylesheets, CSS modules and static assets: what the bundler would hand the importer instead of code. */
const loadSyntheticModule = (
  filePath: string,
  specifier: string,
  options: ConcolicRealmOptions,
): unknown => {
  if (/\?(?:raw|inline)\b/.test(specifier) && readAssetModuleSource(filePath, specifier))
    return null;
  const extension = path.extname(filePath).toLowerCase();
  if (isCssModulePath(filePath)) {
    return {
      __esModule: true,
      default: new Proxy<Record<string, string>>(
        {},
        { get: (_target, property) => (typeof property === "string" ? property : undefined) },
      ),
    };
  }
  if (STYLE_EXTENSIONS.has(extension)) return { __esModule: true, default: {} };
  if (isAssetImport(filePath, specifier)) {
    const url = `/${path.relative(options.servedDirectory, filePath).split(path.sep).join("/")}`;
    return { __esModule: true, default: url };
  }
  return null;
};

const wrapReactFactories = (
  filePath: string,
  exportsRecord: unknown,
  hooks: ConcolicHooks,
): void => {
  if (typeof exportsRecord !== "object" || exportsRecord === null) return;
  const record: Record<string, unknown> = Object(exportsRecord);
  if (REACT_JSX_RUNTIME_FILES.test(filePath)) {
    for (const name of ["jsx", "jsxs", "jsxDEV"]) {
      const factory = record[name];
      if (typeof factory === "function") {
        record[name] = hooks.wrapJsx((type, props, key, ...rest) =>
          Reflect.apply(factory, undefined, [type, props, key, ...rest]),
        );
      }
    }
  } else if (REACT_INDEX_FILES.test(filePath)) {
    const createElement = record.createElement;
    if (typeof createElement === "function") {
      record.createElement = hooks.wrapCreateElement((type, props, ...children) =>
        Reflect.apply(createElement, undefined, [type, props, ...children]),
      );
    }
  }
};

const installHostGlobals = (
  window: Window,
  space: SymbolicSpace,
  options: ConcolicRealmOptions,
  environmentProxy: unknown,
): void => {
  const globalRecord: Record<string, unknown> = Object(window);
  globalRecord.__REACT_DEVTOOLS_GLOBAL_HOOK__ = getRDTHook();
  globalRecord.console = console;
  globalRecord.MessageChannel ??= MessageChannel;
  globalRecord.structuredClone ??= structuredClone;
  globalRecord.TextDecoderStream ??= TextDecoderStream;
  globalRecord.TextEncoderStream ??= TextEncoderStream;
  // HACK: happy-dom exposes Node's legacy stream.Transform/Writable under the WHATWG names.
  globalRecord.TransformStream = TransformStream;
  globalRecord.WritableStream = WritableStream;
  globalRecord.process = {
    env: environmentProxy,
    browser: true,
    platform: "browser",
    cwd: () => "/",
    nextTick: (callback: (...args: unknown[]) => void, ...args: unknown[]) =>
      queueMicrotask(() => callback(...args)),
  };
  globalRecord.global = window;
  globalRecord.fetch = createSymbolicFetch(space);
  const canvasPrototype: Record<string, unknown> = Object(window.HTMLCanvasElement.prototype);
  canvasPrototype.getContext = (contextId: unknown) =>
    space.source("native", `canvas.getContext(${String(contextId)})`, "object");
  for (const [name, value] of Object.entries(options.globals)) {
    globalRecord[name] = vm.runInContext(`(${JSON.stringify(value)})`, window);
  }
};

const createEnvironmentProxy = (space: SymbolicSpace, environment: RealmEnvironment): unknown => {
  const { declared, defines } = environment;
  const definedEnvironment = defines["process.env"] ?? defines["import.meta.env"];
  const definedRecord: Record<string, JsonValue> | null =
    typeof definedEnvironment === "object" &&
    definedEnvironment !== null &&
    !Array.isArray(definedEnvironment)
      ? definedEnvironment
      : null;
  return new Proxy<Record<string, unknown>>(
    {},
    {
      get: (_target, property) => {
        if (typeof property !== "string") return undefined;
        if (property === "NODE_ENV") return DEV_SERVER_MODE;
        if (property in VITE_ENVIRONMENT) return VITE_ENVIRONMENT[property];
        if (definedRecord) return definedRecord[property];
        if (declared) {
          const isInlined =
            declared.clientPrefix !== null && property.startsWith(declared.clientPrefix);
          return isInlined ? declared.variables[property] : undefined;
        }
        return space.source("environment", `env.${property}`, "unknown");
      },
      has: (_target, property) => typeof property === "string",
    },
  );
};

/** Network responses are unknown at analysis time: the body, status and headers are symbolic. */
const createSymbolicFetch = (space: SymbolicSpace): unknown => {
  return (input: unknown, init?: { method?: string }) => {
    const url = typeof input === "string" ? input : String(Object(input).url ?? input);
    const method = (init?.method ?? "GET").toUpperCase();
    const description = `${method} ${url}`;
    const response = space.source("fetch", description, "object");
    const responseNode = space.getNode(response);
    if (!responseNode) throw new TypeError("fetch source is not symbolic");
    const body = space.memberOfNode(responseNode, "body");
    const shell = {
      ok: space.memberOfNode(responseNode, "ok"),
      status: space.memberOfNode(responseNode, "status"),
      statusText: space.memberOfNode(responseNode, "statusText"),
      url,
      redirected: false,
      type: "basic",
      headers: {
        get: (name: string) =>
          space.memberOfNode(responseNode, `headers.${String(name).toLowerCase()}`),
        has: () => false,
        forEach: () => {},
        entries: () => [][Symbol.iterator](),
        [Symbol.iterator]: () => [][Symbol.iterator](),
      },
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(space.derive("text", [body], "string")),
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
      blob: () => Promise.resolve(new Blob()),
      formData: () => Promise.resolve(new FormData()),
      clone: () => shell,
      body: null,
      bodyUsed: false,
    };
    return Promise.resolve(shell);
  };
};
