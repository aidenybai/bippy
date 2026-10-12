import { existsSync, readdirSync, readFileSync } from "node:fs";
import { builtinModules, createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import MagicString from "magic-string";
import { createServer, loadEnv, parseAst } from "vite";
import type { DepOptimizationConfig, Plugin, Rollup } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { PROVIDERS_PATH, SETUP_PATH, WRAPPER_PATH } from "./types.js";
import type { ProbeMode } from "./types.js";

export interface Probe {
  id: string;
  file: string;
  start: number;
  end: number;
  mode: ProbeMode;
}

/**
 * What a repo needs before its components can mount, from its `verify` directory:
 * `setup.tsx` runs before any component loads and may export default providers to wrap
 * every component in, and `harness.json` adds environment variables and module aliases.
 */
interface HarnessSetup {
  file: string | null;
  env: Record<string, string>;
  alias: Record<string, string>;
}

type HarnessConfig = Partial<Pick<HarnessSetup, "env" | "alias">>;

type OptimizerPlugin = NonNullable<
  NonNullable<DepOptimizationConfig["esbuildOptions"]>["plugins"]
>[number];

/**
 * A running harness. `getDependencyHash` changes whenever Vite pre-bundles dependencies again,
 * after which a page that already loaded them holds a stale copy of React.
 */
export interface Harness {
  url: string;
  exportIndex: Map<string, string[]>;
  getModuleUrl: (file: string) => string;
  getDependencyHash: () => string;
  close: () => Promise<void>;
}

/**
 * A provider the harness mounts every component in when its package is installed. `modules`
 * are what it imports, pre-bundled before any component mounts, and default to the package.
 */
interface ProviderSpec {
  packageName: string;
  modules?: string[];
  imports: string;
  wrap: (children: string) => string;
}

const HARNESS_PATH = "/__bippy_verify";
const ENTRY_PATH = "/__bippy_verify_entry.ts";

const SETUP_FILE = "setup.tsx";
const HARNESS_CONFIG_FILE = "harness.json";
/**
 * Mounts inside a data router where the package has one, since hooks like `useNavigation`
 * throw outside it, and inside a `MemoryRouter` before React Router 6.4.
 */
const createRouterSpec = (packageName: string): ProviderSpec => ({
  packageName,
  imports: [
    `import * as ReactRouter from ${JSON.stringify(packageName)};`,
    "const DataRouter = ({ children }) => {",
    '  const [router] = useState(() => ReactRouter.createMemoryRouter([{ path: "*", element: children }]));',
    "  return createElement(ReactRouter.RouterProvider, { router });",
    "};",
  ].join("\n"),
  wrap: (children) =>
    `(isRouterless ? ${children} : createElement(ReactRouter.createMemoryRouter ? DataRouter : ReactRouter.MemoryRouter, null, ${children}))`,
});

const PROVIDER_SPECS: ProviderSpec[] = [
  {
    packageName: "@tanstack/react-query",
    imports: 'import { QueryClient, QueryClientProvider } from "@tanstack/react-query";',
    wrap: (children) =>
      `createElement(QueryClientProvider, { client: useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }))[0] }, ${children})`,
  },
  createRouterSpec("react-router"),
  createRouterSpec("react-router-dom"),
  {
    packageName: "@tanstack/react-router",
    imports: [
      'import * as TanStackRouter from "@tanstack/react-router";',
      "const TanStackRouterProvider = ({ children }) => {",
      "  const [router] = useState(() => TanStackRouter.createRouter({ routeTree: TanStackRouter.createRootRoute(), history: TanStackRouter.createMemoryHistory() }));",
      "  return createElement(TanStackRouter.RouterContextProvider, { router }, children);",
      "};",
    ].join("\n"),
    wrap: (children) => `createElement(TanStackRouterProvider, null, ${children})`,
  },
  {
    packageName: "next-auth",
    modules: ["next-auth/react"],
    imports: [
      'import { SessionProvider } from "next-auth/react";',
      'const SESSION = { user: { name: "Ada Lovelace", email: "ada@example.com" }, expires: "2100-01-01T00:00:00.000Z" };',
    ].join("\n"),
    wrap: (children) =>
      `createElement(SessionProvider, { session: SESSION, refetchOnWindowFocus: false }, ${children})`,
  },
  {
    packageName: "nuqs",
    modules: ["nuqs", "nuqs/adapters/testing"],
    imports: 'import { NuqsTestingAdapter } from "nuqs/adapters/testing";',
    wrap: (children) => `createElement(NuqsTestingAdapter, { hasMemory: true }, ${children})`,
  },
  ...["@xyflow/react", "reactflow"].map((packageName): ProviderSpec => ({
    packageName,
    imports: `import { ReactFlowProvider } from ${JSON.stringify(packageName)};`,
    wrap: (children) => `createElement(ReactFlowProvider, null, ${children})`,
  })),
  {
    packageName: "next-intl",
    imports: 'import { NextIntlClientProvider } from "next-intl";',
    wrap: (children) =>
      `createElement(NextIntlClientProvider, { locale: "en", messages: {}, onError: () => {} }, ${children})`,
  },
  {
    packageName: "react-hook-form",
    imports: 'import { FormProvider, useForm } from "react-hook-form";',
    wrap: (children) => `createElement(FormProvider, useForm(), ${children})`,
  },
];
const NEXT_FONT_ID = "\0bippy-verify-next-font";
const NEXT_FONT_MODULES = new Set(["next/font/google", "next/font/local"]);
const NEXT_NAVIGATION_STUB = join(import.meta.dirname, "stubs/next-navigation.ts");
const NEXT_ROUTER_STUB = join(import.meta.dirname, "stubs/next-router.ts");
const NEXT_STUBS = new Map([
  ["next/navigation", NEXT_NAVIGATION_STUB],
  ["next/document", join(import.meta.dirname, "stubs/next-document.ts")],
  ["next/router", NEXT_ROUTER_STUB],
  ["next/headers", join(import.meta.dirname, "stubs/next-headers.ts")],
  ["next/cache", join(import.meta.dirname, "stubs/next-cache.ts")],
  ["server-only", join(import.meta.dirname, "stubs/server-only.ts")],
]);
const T3_ENV_STUB = join(import.meta.dirname, "stubs/t3-env.ts");
const STUBS = new Map([
  ["@t3-oss/env-nextjs", T3_ENV_STUB],
  ["@t3-oss/env-core", T3_ENV_STUB],
  ["next-intl/server", join(import.meta.dirname, "stubs/next-intl-server.ts")],
]);
/**
 * The browser polyfills Next bundles for Node's modules in client code, which a package like
 * `@apidevtools/json-schema-ref-parser` needs as it calls `path.join` when it loads.
 */
const NEXT_NODE_POLYFILLS: Record<string, string> = {
  assert: "assert",
  buffer: "buffer",
  constants: "constants-browserify",
  crypto: "crypto-browserify",
  domain: "domain-browser",
  events: "events",
  http: "stream-http",
  https: "https-browserify",
  os: "os-browserify",
  path: "path-browserify",
  punycode: "punycode",
  querystring: "querystring-es3",
  stream: "stream-browserify",
  string_decoder: "string_decoder",
  sys: "util",
  timers: "timers-browserify",
  tty: "tty-browserify",
  util: "util",
  vm: "vm-browserify",
  zlib: "browserify-zlib",
};
const NEXT_CONTEXT_MODULES = ["app-router-context", "hooks-client-context", "router-context"];
const ENV_PLACEHOLDER = "https://example.com";
const SOURCE_FILE_PATTERN = /\.[cm]?[jt]sx?$/;
const IMAGE_FILE_PATTERN = /\.(?:png|jpe?g|gif|webp|avif|svg|ico)$/;
const STYLESHEET_PATTERN = /\.(?:css|scss|sass|less|styl|pcss)(?:\?(?!.*\b(?:raw|url)\b)|$)/;
const ENV_REFERENCE_PATTERN = /\b(process\.env|import\.meta\.env)\.([A-Z_][A-Z0-9_]*)/g;
const SERVER_SDK_PATTERN =
  /^(?:@prisma\/client(?:\/.+)?|stripe|nodemailer|resend|pg|postgres|mysql2|mongodb|mongoose|ioredis|@upstash\/redis|@vercel\/(?:postgres|kv|blob)|@neondatabase\/serverless|@planetscale\/database|firebase-admin(?:\/.+)?|@aws-sdk\/.+|bcrypt|next-auth|next-auth\/(?:next|providers\/.+)|@auth\/.+-adapter|@next-auth\/.+-adapter|drizzle-orm\/(?:node-postgres|postgres-js|neon-http|neon-serverless|pglite|mysql2|libsql|better-sqlite3|vercel-postgres|planetscale-serverless)|@clerk\/nextjs\/server|@clerk\/backend|@arcjet\/.+|dotenv(?:\/config)?|execa|cross-spawn|npm-run-path|node:.+)$/;
const SERVER_SDK_PREFIX = "\0bippy-verify-server-sdk:";
/** An SVG imported as a component, as `vite-plugin-svgr` does for `logo.svg?react`. */
const SVG_COMPONENT_PATTERN = /\.svg\?react$/;
const SVG_COMPONENT_SOURCE = [
  'import { createElement } from "react";',
  "export default function SvgComponent({ title, titleId, ...props }) {",
  '  return createElement("svg", props);',
  "}",
].join("\n");
/** An image a build step generates, like an icon sprite, which isn't on disk yet. */
const MISSING_ASSET_PREFIX = "\0bippy-verify-missing-asset:";
const NUQS_SERVER_ID = "\0bippy-verify-nuqs-server";
const NUQS_CACHE_STUB = join(import.meta.dirname, "stubs/nuqs-cache.ts");
const STAND_IN_SOURCE = join(import.meta.dirname, "stubs/stand-in.ts");
const PACKAGE_IMPORT_PATTERN = /import\s+(?!type\b)([^;]*?)\s*from\s*["']([^"'.][^"']*)["']/g;
const NAMED_IMPORTS_PATTERN = /\{([^}]*)\}/;
const NEXT_FONT_IMPORT_PATTERN =
  /import\s+(?:\w+\s*,?\s*)?(?:\{([^}]*)\})?\s*from\s*["']next\/font\/(?:google|local)["']/g;
const EXPORT_DECLARATION_PATTERN =
  /export\s+(?:default\s+)?(?:async\s+)?(?:const|let|var|function|class)\s+([A-Z]\w*)/g;
const EXPORT_LIST_PATTERN = /export\s*\{([^}]*)\}/g;
const ENTRY_SOURCE = join(import.meta.dirname, "browser-entry.ts");
const BIPPY_SOURCE = join(import.meta.dirname, "../../../bippy/src/index.ts");

const SERVER_DIRECTIVE = "use server";
const MISSING_MODULE_NAMESPACE = "bippy-missing-module";
const RELATIVE_SPECIFIER_PATTERN = /^\.{0,2}\//;

const isRequirable = (specifier: string, importer: string): boolean => {
  try {
    createRequire(importer).resolve(specifier);
    return true;
  } catch {
    return false;
  }
};

/**
 * Dependencies pre-bundle in one batch, and one `require` of a module that isn't installed,
 * like Next's server requiring `critters` or an ungenerated `.prisma/client`, fails the whole
 * batch and so every component. It becomes a module that throws as Node would, so only code
 * that runs it fails, and a `try` around it, like Next's for `@opentelemetry/api`, still
 * falls back.
 */
const createMissingRequirePlugin = (): OptimizerPlugin => ({
  name: MISSING_MODULE_NAMESPACE,
  setup: (build) => {
    build.onResolve({ filter: /.*/ }, ({ path, importer, kind }) =>
      kind === "require-call" &&
      importer &&
      !RELATIVE_SPECIFIER_PATTERN.test(path) &&
      !isRequirable(path, importer)
        ? { path, namespace: MISSING_MODULE_NAMESPACE }
        : undefined,
    );
    build.onLoad({ filter: /.*/, namespace: MISSING_MODULE_NAMESPACE }, ({ path }) => ({
      contents: `throw new Error(${JSON.stringify(`Cannot find module '${path}'`)});`,
      loader: "js",
    }));
  },
});

const NODE_BUILTIN_NAMESPACE = "bippy-verify-node-builtin";
const NODE_BUILTINS = new Set(builtinModules);

/**
 * Gives a pre-bundled package's Node module or server SDK, like `os` in `os.hostname()` at
 * import time or `execa`, a stand-in for any value, as a browser has no Node.
 */
/** The Node modules an app's bundler polyfills for the browser, Next's own. */
const getPolyfilledModules = (appDirectory: string): Set<string> =>
  new Set(isInstalled(appDirectory, "next") ? Object.keys(NEXT_NODE_POLYFILLS) : []);

/**
 * Whether a module is Node's own with nothing to run in a browser: any `node:` module, and a
 * bare name like `crypto` unless the app installs a package by it, like `events`, or its
 * bundler polyfills it.
 */
const isNodeOnlyModule = (
  specifier: string,
  importer: string | undefined,
  polyfilled: Set<string>,
): boolean => {
  const name = specifier.replace(/^node:/, "").split("/")[0] ?? "";
  if (!NODE_BUILTINS.has(name) || polyfilled.has(name)) return false;
  return (
    specifier.startsWith("node:") ||
    importer === undefined ||
    !isRequirable(`${name}/package.json`, importer)
  );
};

const createNodeBuiltinPlugin = (polyfilled: Set<string>): OptimizerPlugin => ({
  name: NODE_BUILTIN_NAMESPACE,
  setup: (build) => {
    build.onResolve({ filter: /.*/ }, ({ path, importer }) =>
      SERVER_SDK_PATTERN.test(path) || isNodeOnlyModule(path, importer, polyfilled)
        ? { path, namespace: NODE_BUILTIN_NAMESPACE }
        : undefined,
    );
    build.onLoad({ filter: /.*/, namespace: NODE_BUILTIN_NAMESPACE }, () => ({
      contents: `module.exports = require(${JSON.stringify(STAND_IN_SOURCE)}).STAND_IN;`,
      loader: "js",
      resolveDir: dirname(STAND_IN_SOURCE),
    }));
  },
});

const getExportNames = (program: Rollup.ProgramNode): string[] =>
  program.body.flatMap((statement) => {
    if (statement.type === "ExportDefaultDeclaration") return ["default"];
    if (statement.type !== "ExportNamedDeclaration") return [];
    const { declaration, specifiers } = statement;
    const declared =
      declaration?.type === "VariableDeclaration"
        ? declaration.declarations.flatMap((declarator) =>
            declarator.id.type === "Identifier" ? [declarator.id.name] : [],
          )
        : declaration && "id" in declaration && declaration.id
          ? [declaration.id.name]
          : [];
    return [
      ...declared,
      ...specifiers.map((specifier) =>
        specifier.exported.type === "Identifier"
          ? specifier.exported.name
          : String(specifier.exported.value),
      ),
    ];
  });

/**
 * A `"use server"` module runs on the server, and a client bundle only gets functions that
 * call it, so its exports become async functions that do nothing instead of database code
 * a browser can't load.
 */
/**
 * Gives an imported image the shape Next's bundler does, `{ src, width, height }`, which
 * `next/image` reads, where Vite gives only its URL.
 */
const createNextImagePlugin = (): Plugin => ({
  name: "bippy-verify-next-image",
  enforce: "post",
  transform: (code, id) => {
    if (!IMAGE_FILE_PATTERN.test(id)) return null;
    const match = /^export default (.+);?$/m.exec(code);
    return match
      ? code.replace(
          match[0],
          `export default { src: ${match[1]}, width: 1, height: 1, blurDataURL: ${match[1]} };`,
        )
      : null;
  },
});

const createServerActionPlugin = (): Plugin => ({
  name: "bippy-verify-server-actions",
  transform: (code) => {
    if (!code.includes(SERVER_DIRECTIVE)) return null;
    const program = parseAst(code);
    const [firstStatement] = program.body;
    if (
      firstStatement?.type !== "ExpressionStatement" ||
      !("directive" in firstStatement) ||
      firstStatement.directive !== SERVER_DIRECTIVE
    )
      return null;
    return getExportNames(program)
      .map((name) =>
        name === "default"
          ? "export default async () => undefined;"
          : `export const ${name} = async () => undefined;`,
      )
      .join("\n");
  },
});

interface RequireCall {
  start: number;
  end: number;
  specifier: string;
}

const getRequireCall = (node: object): RequireCall | null => {
  const callee: unknown = Reflect.get(node, "callee");
  const args: unknown = Reflect.get(node, "arguments");
  if (Reflect.get(node, "type") !== "CallExpression" || !Array.isArray(args)) return null;
  const [specifierNode]: unknown[] = args;
  const specifier: unknown =
    args.length === 1 && typeof specifierNode === "object" && specifierNode !== null
      ? Reflect.get(specifierNode, "value")
      : null;
  const start: unknown = Reflect.get(node, "start");
  const end: unknown = Reflect.get(node, "end");
  const isRequire =
    typeof callee === "object" && callee !== null && Reflect.get(callee, "name") === "require";
  return isRequire &&
    typeof specifier === "string" &&
    typeof start === "number" &&
    typeof end === "number"
    ? { start, end, specifier }
    : null;
};

const findRequireCalls = (program: Rollup.ProgramNode): RequireCall[] => {
  const calls: RequireCall[] = [];
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (typeof node !== "object" || node === null) return;
    const call = getRequireCall(node);
    if (call) calls.push(call);
    else Object.values(node).forEach(visit);
  };
  visit(program);
  return calls;
};

const isAppSourceModule = (id: string): boolean =>
  !id.includes("/node_modules/") && SOURCE_FILE_PATTERN.test(id.split("?")[0] ?? id);

const isModuleStatement = (statement: Rollup.ProgramNode["body"][number]): boolean =>
  statement.type === "ImportDeclaration" ||
  statement.type === "ExportNamedDeclaration" ||
  statement.type === "ExportDefaultDeclaration" ||
  statement.type === "ExportAllDeclaration";

/**
 * Makes an app's own CommonJS module, like a Next config that sets `module.exports`,
 * importable: what it exports becomes its default export.
 */
const createCommonJsPlugin = (): Plugin => ({
  name: "bippy-verify-commonjs",
  transform: (code, id) => {
    if (!isAppSourceModule(id) || !code.includes("module.exports")) return null;
    if (parseAst(code).body.some(isModuleStatement)) return null;
    return [
      "const module = { exports: {} };",
      "const exports = module.exports;",
      code,
      "export default module.exports;",
    ].join("\n");
  },
});

/**
 * Turns `require("highlight.js")` in an app's own modules into an import. Next's bundler
 * lets ES modules call `require`, while a browser has no `require` at all.
 */
const createRequirePlugin = (): Plugin => ({
  name: "bippy-verify-require",
  transform: (code, id) => {
    if (!isAppSourceModule(id) || !code.includes("require(")) return null;
    const calls = findRequireCalls(parseAst(code));
    if (calls.length === 0) return null;
    const specifiers = [...new Set(calls.map((call) => call.specifier))];
    const source = new MagicString(code);
    for (const call of calls) {
      const name = `__bippyRequire${specifiers.indexOf(call.specifier)}`;
      source.overwrite(call.start, call.end, `(${name}.default ?? ${name})`);
    }
    source.prepend(
      specifiers
        .map(
          (specifier, index) =>
            `import * as __bippyRequire${index} from ${JSON.stringify(specifier)};\n`,
        )
        .join(""),
    );
    return { code: source.toString(), map: source.generateMap({ hires: true }) };
  },
});

const createProbePlugin = (probes: Probe[]): Plugin => {
  const probesByFile = Map.groupBy(probes, (probe) => probe.file);
  return {
    name: "bippy-verify-probes",
    enforce: "pre",
    transform: (code, id) => {
      const fileProbes = probesByFile.get(id.split("?")[0] ?? id);
      if (!fileProbes) return null;
      const source = new MagicString(code);
      const innermostFirst = [...fileProbes].sort(
        (left, right) => left.end - left.start - (right.end - right.start),
      );
      for (const probe of innermostFirst) {
        source.prependRight(
          probe.start,
          `__bippyProbe(${JSON.stringify(probe.id)}, ${JSON.stringify(probe.mode)}, (`,
        );
        source.appendLeft(probe.end, "))");
      }
      return { code: source.toString(), map: source.generateMap({ hires: true }) };
    },
  };
};

interface PackageManifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

/**
 * Whether the app declares a package. Resolving it isn't enough: Node looks in every
 * enclosing `node_modules`, where a monorepo installs packages its other apps use.
 */
const isDeclared = (appDirectory: string, packageName: string): boolean => {
  const manifestPath = join(appDirectory, "package.json");
  if (!existsSync(manifestPath)) return true;
  const manifest: PackageManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  return [manifest.dependencies, manifest.devDependencies, manifest.peerDependencies].some(
    (dependencies) => dependencies !== undefined && packageName in dependencies,
  );
};

/**
 * The package's directory in the `node_modules` nearest the app, found by name, since a
 * package's `exports` may not include its `package.json`, like next-intl's.
 */
const findInstalledDirectory = (appDirectory: string, packageName: string): string | null => {
  for (let directory = appDirectory; ; directory = dirname(directory)) {
    const packageDirectory = join(directory, "node_modules", packageName);
    if (existsSync(join(packageDirectory, "package.json"))) return packageDirectory;
    if (dirname(directory) === directory) return null;
  }
};

const resolvePackageDirectory = (appDirectory: string, packageName: string): string | null => {
  if (!isDeclared(appDirectory, packageName)) return null;
  try {
    return dirname(
      createRequire(join(appDirectory, "package.json")).resolve(`${packageName}/package.json`),
    );
  } catch {
    return findInstalledDirectory(appDirectory, packageName);
  }
};

const isInstalled = (appDirectory: string, packageName: string): boolean =>
  resolvePackageDirectory(appDirectory, packageName) !== null;

const listSourceFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith(".") || entry.name === "node_modules") return [];
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return listSourceFiles(path);
    return SOURCE_FILE_PATTERN.test(entry.name) ? [path] : [];
  });

interface ExportedValue {
  file: string;
  exportName: string;
}

interface SourceReferences {
  processEnv: Set<string>;
  importMetaEnv: Set<string>;
  nextFonts: Set<string>;
  serverSdkImports: Map<string, Set<string>>;
  exports: Map<string, string[]>;
  reduxStore: ExportedValue | null;
}

const STORE_DECLARATION_PATTERN =
  /\b(?:const|let)\s+(\w+)\s*=\s*(?:configureStore|createStore|legacy_createStore)\(/;
const TEST_FILE_PATTERN = /\.(?:test|spec|stories)\.[jt]sx?$/;

/** The Redux store a file creates and exports, like `export const store = configureStore(…)`. */
const findReduxStore = (file: string, text: string): ExportedValue | null => {
  const name = STORE_DECLARATION_PATTERN.exec(text)?.[1];
  if (!name) return null;
  if (new RegExp(`export\\s+default\\s+${name}\\b`).test(text))
    return { file, exportName: "default" };
  return new RegExp(`export\\s+(?:const|let)\\s+${name}\\b|export\\s*\\{[^}]*\\b${name}\\b`).test(
    text,
  )
    ? { file, exportName: name }
    : null;
};

/**
 * Mounts every component in the app's own Redux store, as its root does, since a component
 * reading it throws outside a `Provider`.
 */
const createReduxSpec = ({ file, exportName }: ExportedValue): ProviderSpec => ({
  packageName: "react-redux",
  imports: [
    'import { Provider as ReduxProvider } from "react-redux";',
    `import { ${exportName} as reduxStore } from ${JSON.stringify(file)};`,
  ].join("\n"),
  wrap: (children) => `createElement(ReduxProvider, { store: reduxStore }, ${children})`,
});

/**
 * What the harness needs to know about an app's source: the environment variables,
 * `next/font` names and server SDK exports it reads at import time, which the harness
 * supplies so modules load, and where each capitalized name is exported, to find a
 * provider a component asks for.
 */
const collectSourceReferences = (appDirectory: string): SourceReferences => {
  const references: SourceReferences = {
    processEnv: new Set(),
    importMetaEnv: new Set(),
    nextFonts: new Set(),
    serverSdkImports: new Map(),
    exports: new Map(),
    reduxStore: null,
  };
  const addExport = (name: string, file: string): void => {
    references.exports.set(name, [...(references.exports.get(name) ?? []), file]);
  };
  for (const file of listSourceFiles(appDirectory)) {
    const text = readFileSync(file, "utf8");
    if (!references.reduxStore && !TEST_FILE_PATTERN.test(file))
      references.reduxStore = findReduxStore(file, text);
    for (const [, name = ""] of text.matchAll(EXPORT_DECLARATION_PATTERN)) addExport(name, file);
    for (const [, names = ""] of text.matchAll(EXPORT_LIST_PATTERN))
      for (const specifier of names.split(",")) {
        const exported = specifier
          .split(/\s+as\s+/)
          .pop()
          ?.trim();
        if (exported && /^[A-Z]/.test(exported)) addExport(exported, file);
      }
    for (const [, source = "", name = ""] of text.matchAll(ENV_REFERENCE_PATTERN))
      (source === "process.env" ? references.processEnv : references.importMetaEnv).add(name);
    for (const [, clause = "", specifier = ""] of text.matchAll(PACKAGE_IMPORT_PATTERN)) {
      const moduleName = specifier.replace(/^node:/, "").split("/")[0] ?? "";
      if (!SERVER_SDK_PATTERN.test(specifier) && !NODE_BUILTINS.has(moduleName)) continue;
      const names = references.serverSdkImports.get(specifier) ?? new Set();
      for (const namedImport of NAMED_IMPORTS_PATTERN.exec(clause)?.[1]?.split(",") ?? []) {
        const name = namedImport
          .replace(/^\s*type\s+/, "")
          .split(/\s+as\s+/)[0]
          ?.trim();
        if (name) names.add(name);
      }
      references.serverSdkImports.set(specifier, names);
    }
    for (const [, names = ""] of text.matchAll(NEXT_FONT_IMPORT_PATTERN))
      for (const name of names.split(",")) {
        const localName = name.split(/\s+as\s+/)[0]?.trim();
        if (localName) references.nextFonts.add(localName);
      }
  }
  return references;
};

/**
 * Stands in for a server SDK, like a database or payments client, which can't run in a
 * browser and has no backend there to reach: its exports are stand-ins for any value, so
 * a server component that awaits a query renders around what it gets.
 */
const createServerSdkSource = (names: Set<string>): string =>
  [
    `import { STAND_IN } from ${JSON.stringify(STAND_IN_SOURCE)};`,
    "export default STAND_IN;",
    ...[...names].map((name) => `export const ${name} = STAND_IN;`),
  ].join("\n");

const createNextFontSource = (fontNames: Set<string>): string =>
  [
    'const font = () => ({ className: "", style: { fontFamily: "sans-serif" }, variable: "" });',
    "export default font;",
    ...[...fontNames].map((name) => `export const ${name} = font;`),
  ].join("\n");

/**
 * The module that defines one of Next's router contexts, named with `.shared-runtime` since
 * Next 13.5.
 */
const resolveNextContextModule = (nextDirectory: string, name: string): string | null => {
  const fileName = [`${name}.shared-runtime`, name].find((candidate) =>
    existsSync(join(nextDirectory, "dist/shared/lib", `${candidate}.js`)),
  );
  return fileName ? `next/dist/shared/lib/${fileName}` : null;
};

const getNextPolyfillAliases = (
  appDirectory: string,
): Array<{ find: RegExp; replacement: string }> => {
  const nextDirectory = resolvePackageDirectory(appDirectory, "next");
  if (!nextDirectory) return [];
  return Object.entries(NEXT_NODE_POLYFILLS).flatMap(([name, polyfill]) => {
    const directory = join(nextDirectory, "dist/compiled", polyfill);
    return existsSync(directory)
      ? [{ find: new RegExp(`^(?:node:)?${name}/?$`), replacement: `${directory}/` }]
      : [];
  });
};

/**
 * Provides Next's own router contexts with the stub routers, so `next/navigation` and
 * `next/router` work when a package imports them, like `@clerk/nextjs` does, where the stubs
 * for the app's own imports don't reach.
 */
const createNextContextSpec = (appDirectory: string): ProviderSpec | null => {
  const nextDirectory = resolvePackageDirectory(appDirectory, "next");
  if (!nextDirectory) return null;
  const [appRouterModule, hooksModule, routerModule] = NEXT_CONTEXT_MODULES.map((name) =>
    resolveNextContextModule(nextDirectory, name),
  );
  if (!appRouterModule || !hooksModule || !routerModule) return null;
  return {
    packageName: "next",
    modules: [appRouterModule, hooksModule, routerModule],
    imports: [
      `import * as AppRouterContexts from ${JSON.stringify(appRouterModule)};`,
      `import * as HookContexts from ${JSON.stringify(hooksModule)};`,
      `import * as RouterContexts from ${JSON.stringify(routerModule)};`,
      `import { appRouter } from ${JSON.stringify(NEXT_NAVIGATION_STUB)};`,
      `import pagesRouter from ${JSON.stringify(NEXT_ROUTER_STUB)};`,
      "const provide = (context, value, children) => context ? createElement(context.Provider, { value }, children) : children;",
    ].join("\n"),
    wrap: (children) =>
      [
        "provide(AppRouterContexts.AppRouterContext, appRouter,",
        'provide(HookContexts.PathnameContext, "/",',
        "provide(HookContexts.SearchParamsContext, new URLSearchParams(),",
        "provide(HookContexts.PathParamsContext ?? HookContexts.ParamsContext, {},",
        `provide(RouterContexts.RouterContext, pagesRouter, ${children})))))`,
      ].join(" "),
  };
};

/**
 * The image config Next gives client code, its defaults without optimizing, since the
 * harness has no `/_next/image` route and doesn't read the app's `next.config` for the hosts
 * it allows.
 */
const getNextImageOptions = (appDirectory: string): Record<string, unknown> => {
  const nextDirectory = resolvePackageDirectory(appDirectory, "next");
  const configFile = nextDirectory && join(nextDirectory, "dist/shared/lib/image-config.js");
  if (!configFile || !existsSync(configFile)) return {};
  const { imageConfigDefault }: { imageConfigDefault: object } =
    createRequire(configFile)(configFile);
  return { __NEXT_IMAGE_OPTS: { ...imageConfigDefault, unoptimized: true } };
};

const getInstalledProviders = (appDirectory: string): ProviderSpec[] => {
  const installed = PROVIDER_SPECS.filter((spec) => isInstalled(appDirectory, spec.packageName));
  const nextContextSpec = createNextContextSpec(appDirectory);
  const providers = nextContextSpec ? [nextContextSpec, ...installed] : installed;
  return providers.some((spec) => spec.packageName === "react-router")
    ? providers.filter((spec) => spec.packageName !== "react-router-dom")
    : providers;
};

export const readHarnessSetup = (directory: string | null): HarnessSetup => {
  if (!directory) return { file: null, env: {}, alias: {} };
  const setupFile = join(directory, SETUP_FILE);
  const configFile = join(directory, HARNESS_CONFIG_FILE);
  const config: HarnessConfig = existsSync(configFile)
    ? JSON.parse(readFileSync(configFile, "utf8"))
    : {};
  return {
    file: existsSync(setupFile) ? setupFile : null,
    env: config.env ?? {},
    alias: Object.fromEntries(
      Object.entries(config.alias ?? {}).map(([source, target]) => [
        source,
        target.startsWith(".") ? resolve(directory, target) : target,
      ]),
    ),
  };
};

const createProvidersSource = (providers: ProviderSpec[], setup: HarnessSetup): string => {
  const wrapped = providers.reduceRight(
    (children, provider) => provider.wrap(children),
    setup.file ? "createElement(SetupProviders, null, children)" : "children",
  );
  return [
    'import { createElement, useState } from "react";',
    ...providers.map((provider) => provider.imports),
    ...(setup.file
      ? [
          `import * as setup from ${JSON.stringify(SETUP_PATH)};`,
          "const SetupProviders = setup.default ?? (({ children }) => children);",
        ]
      : []),
    `export default function Providers({ children, isRouterless }) { return ${wrapped}; }`,
  ].join("\n");
};

/**
 * Serves the harness page, its entry, the providers every component mounts in, and the
 * repo's setup. The setup lives outside the app, so its imports resolve as if from a file
 * of the app, where path aliases such as `@/` apply.
 */
const createHarnessPlugin = (
  appDirectory: string,
  providers: ProviderSpec[],
  setup: HarnessSetup,
  appImporter: string,
  references: SourceReferences,
): Plugin => {
  const isNextApp = isInstalled(appDirectory, "next");
  const polyfilled = getPolyfilledModules(appDirectory);
  const entryId = join(appDirectory, ENTRY_PATH);
  const providersId = join(appDirectory, PROVIDERS_PATH);
  const setupId = join(appDirectory, SETUP_PATH);
  const wrapperId = join(appDirectory, WRAPPER_PATH);
  const getWrapperQuery = (id: string): URLSearchParams =>
    new URLSearchParams(id.slice(id.indexOf("?") + 1));
  const providersSource = createProvidersSource(providers, setup);
  return {
    name: "bippy-verify-harness",
    enforce: "pre",
    async resolveId(source, importer) {
      if (isNextApp && NEXT_FONT_MODULES.has(source)) return NEXT_FONT_ID;
      if (isNextApp && NEXT_STUBS.has(source)) return NEXT_STUBS.get(source);
      if (SERVER_SDK_PATTERN.test(source) || isNodeOnlyModule(source, importer, polyfilled))
        return `${SERVER_SDK_PREFIX}${source}`;
      if (STUBS.has(source)) return STUBS.get(source);
      const assetPath = source.split("?")[0] ?? source;
      if (
        importer &&
        assetPath.startsWith(".") &&
        IMAGE_FILE_PATTERN.test(assetPath) &&
        !existsSync(resolve(dirname(importer.split("?")[0] ?? importer), assetPath))
      )
        return `${MISSING_ASSET_PREFIX}${assetPath}`;
      if (source === "nuqs/server")
        return importer === NUQS_SERVER_ID
          ? this.resolve(source, appImporter, { skipSelf: true })
          : NUQS_SERVER_ID;
      if (source === ENTRY_PATH || source === entryId) return entryId;
      if (importer === entryId && source.startsWith("./"))
        return join(import.meta.dirname, source.replace(/\.js$/, ".ts"));
      if (source === PROVIDERS_PATH || source === providersId) return providersId;
      if (source === SETUP_PATH || source === setupId) return setupId;
      if (source.startsWith(`${WRAPPER_PATH}?`))
        return `${wrapperId}${source.slice(WRAPPER_PATH.length)}`;
      if (importer?.startsWith(`${wrapperId}?`))
        return this.resolve(source, getWrapperQuery(importer).get("importer") ?? appImporter, {
          skipSelf: true,
        });
      if (importer === setupId && !source.startsWith("."))
        return this.resolve(source, appImporter, { skipSelf: true });
      if (importer === setupId && setup.file)
        return this.resolve(source, setup.file, { skipSelf: true });
      return null;
    },
    load: (id) => {
      if (STYLESHEET_PATTERN.test(id)) return "";
      if (SVG_COMPONENT_PATTERN.test(id)) return SVG_COMPONENT_SOURCE;
      if (id.startsWith(MISSING_ASSET_PREFIX))
        return `export default ${JSON.stringify(id.slice(MISSING_ASSET_PREFIX.length))};`;
      if (id === NEXT_FONT_ID) return createNextFontSource(references.nextFonts);
      if (id.startsWith(SERVER_SDK_PREFIX))
        return createServerSdkSource(
          references.serverSdkImports.get(id.slice(SERVER_SDK_PREFIX.length)) ?? new Set(),
        );
      if (id === NUQS_SERVER_ID)
        return `export * from "nuqs/server";\nexport { createSearchParamsCache } from ${JSON.stringify(NUQS_CACHE_STUB)};`;
      if (id === entryId) return readFileSync(ENTRY_SOURCE, "utf8");
      if (id === providersId) return providersSource;
      if (id === setupId) return setup.file ? readFileSync(setup.file, "utf8") : "";
      if (id.startsWith(`${wrapperId}?`))
        return `export * from ${JSON.stringify(getWrapperQuery(id).get("specifier"))};`;
      return null;
    },
    configureServer: (server) => {
      server.middlewares.use((request, response, next) => {
        if (request.url !== HARNESS_PATH) return next();
        response.setHeader("content-type", "text/html");
        response.end(
          `<!doctype html><html><head><meta charset="utf-8"></head><body><script type="module" src="${ENTRY_PATH}"></script></body></html>`,
        );
      });
    },
  };
};

export const startHarness = async (
  appDirectory: string,
  probes: Probe[],
  componentFiles: string[],
  setup: HarnessSetup,
): Promise<Harness> => {
  const installedProviders = getInstalledProviders(appDirectory);
  const appImporter = componentFiles[0] ?? join(appDirectory, "index.ts");
  const references = collectSourceReferences(appDirectory);
  const providers =
    references.reduxStore && isInstalled(appDirectory, "react-redux")
      ? [...installedProviders, createReduxSpec(references.reduxStore)]
      : installedProviders;
  const loadedEnv = loadEnv("development", appDirectory, "");
  const getPlaceholders = (names: Set<string>): Record<string, string> =>
    Object.fromEntries(
      [...names].filter((name) => !(name in loadedEnv)).map((name) => [name, ENV_PLACEHOLDER]),
    );
  const processEnv = {
    ...getPlaceholders(references.processEnv),
    ...loadedEnv,
    ...setup.env,
    NODE_ENV: "development",
    ...getNextImageOptions(appDirectory),
  };
  const importMetaEnv = { ...getPlaceholders(references.importMetaEnv), ...setup.env };
  const server = await createServer({
    configFile: false,
    root: appDirectory,
    logLevel: "error",
    appType: "custom",
    plugins: [
      createHarnessPlugin(appDirectory, providers, setup, appImporter, references),
      createProbePlugin(probes),
      ...(isInstalled(appDirectory, "next") ? [createNextImagePlugin()] : []),
      createServerActionPlugin(),
      createCommonJsPlugin(),
      createRequirePlugin(),
      tsconfigPaths({ root: appDirectory }),
    ],
    resolve: {
      alias: [
        { find: /^bippy$/, replacement: BIPPY_SOURCE },
        ...getNextPolyfillAliases(appDirectory),
        ...Object.entries(setup.alias).map(([source, target]) => ({
          find: new RegExp(`^${RegExp.escape(source)}$`),
          replacement: target,
        })),
      ],
      dedupe: ["react", "react-dom"],
    },
    // Fibers don't depend on styles, so stylesheets load empty, and with no PostCSS
    // config to find, an app's Tailwind or Sass setup can't fail its imports.
    css: { postcss: {} },
    esbuild: { jsx: "automatic", jsxDev: true },
    define: {
      "process.env": JSON.stringify(processEnv),
      ...Object.fromEntries(
        Object.entries(importMetaEnv).map(([name, value]) => [
          `import.meta.env.${name}`,
          JSON.stringify(value),
        ]),
      ),
    },
    optimizeDeps: {
      entries: componentFiles.map((file) => relative(appDirectory, file)),
      include: [
        "react",
        "react-dom",
        "react-dom/client",
        "react/jsx-dev-runtime",
        "react/jsx-runtime",
        ...providers.flatMap((provider) => provider.modules ?? [provider.packageName]),
      ],
      esbuildOptions: {
        plugins: [
          createMissingRequirePlugin(),
          createNodeBuiltinPlugin(getPolyfilledModules(appDirectory)),
        ],
        loader: { ".node": "empty" },
        // Webpack, which Next bundles client code with, makes `__dirname` the root.
        ...(isInstalled(appDirectory, "next") ? { define: { __dirname: '"/"' } } : {}),
      },
    },
    server: { port: 0, strictPort: false, hmr: false, fs: { strict: false } },
  });
  await server.listen();
  await Promise.all(
    [
      ENTRY_PATH,
      PROVIDERS_PATH,
      ...componentFiles.map((file) => `/${relative(appDirectory, file)}`),
    ].map((url) => server.warmupRequest(url)),
  );
  await server.waitForRequestsIdle();
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") throw new Error("Harness server has no port");
  return {
    url: `http://localhost:${address.port}${HARNESS_PATH}`,
    exportIndex: references.exports,
    getModuleUrl: (file) => `/${relative(appDirectory, file)}`,
    getDependencyHash: () => server.environments.client.depsOptimizer?.metadata.browserHash ?? "",
    close: () => server.close(),
  };
};
