import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vite-plus/test";
import { createServer, type ViteDevServer } from "vite-plus";
import ts from "typescript";
import { createBundlerFixtureResolver as createModuleResolver } from "./helpers/bundler-resolver.js";
import { createResolverProject } from "./helpers/resolver-project.js";

interface BrowserCase {
  name: string;
  specifier: string;
  target: string;
  importer?: string;
}

const project = createResolverProject();
const cases: BrowserCase[] = [];
const addPackage = (
  name: string,
  manifest: object,
  files: Record<string, string>,
  target: string,
) => {
  project.write(`node_modules/${name}/package.json`, { name, ...manifest });
  for (const [filePath, contents] of Object.entries(files))
    project.write(`node_modules/${name}/${filePath}`, contents);
  cases.push({ name, specifier: name, target: `node_modules/${name}/${target}` });
};

for (const extension of [".mjs", ".js", ".mts", ".ts", ".jsx", ".tsx", ".json"]) {
  project.write(`src/priority${extension}`, "{}");
  project.write(`src/only-${extension.slice(1)}${extension}`, "{}");
  cases.push({
    name: `extension ${extension}`,
    specifier: `./only-${extension.slice(1)}`,
    target: `src/only-${extension.slice(1)}${extension}`,
  });
}
cases.push({ name: "extension precedence", specifier: "./priority", target: "src/priority.mjs" });
for (const [output, source] of [
  ["js", "ts"],
  ["jsx", "tsx"],
  ["mjs", "mts"],
  ["cjs", "cts"],
]) {
  project.write(`src/compiled-${output}.${source}`, "export {};");
  cases.push({
    name: `${output} to ${source}`,
    specifier: `./compiled-${output}.${output}`,
    target: `src/compiled-${output}.${source}`,
  });
}
project.write("src/collision.js", "export {};");
project.write("src/collision.ts", "export {};");
cases.push({
  name: "existing JS beats TS substitution",
  specifier: "./collision.js",
  target: "src/collision.js",
});

for (const [name, source, target] of [
  ["browser-cjs", "module.exports = {};", "browser.js"],
  ["browser-esm", "export default 1;", "browser.js"],
  ["browser-dynamic-import", "import('./other.js');", "browser.js"],
  ["browser-import-meta", "console.log(import.meta.url);", "browser.js"],
  ["browser-export-in-comment", "/* export default 1; */ module.exports = {};", "browser.js"],
  [
    "browser-export-in-string",
    "const text = ' export default 1;'; module.exports = {};",
    "browser.js",
  ],
])
  addPackage(
    name,
    { browser: "./browser.js", module: "./module.js", main: "./main.js" },
    {
      "browser.js": source,
      "module.js": "export default 2;",
      "main.js": "module.exports = 3;",
    },
    target,
  );

addPackage(
  "exports-win",
  { exports: "./exported.mjs", browser: "./browser.js", module: "./module.js" },
  {
    "exported.mjs": "export {};",
    "browser.js": "module.exports = {};",
    "module.js": "export {};",
  },
  "exported.mjs",
);
addPackage(
  "browser-map",
  {
    main: "./index.js",
    browser: {
      "./index.js": "./browser.js",
      "./platform.js": "./web.js",
      fs: "./shim.js",
      "./disabled.js": false,
    },
  },
  {
    "index.js": "module.exports = {};",
    "browser.js": "export {};",
    "platform.js": "export {};",
    "web.js": "export {};",
    "shim.js": "export {};",
    "disabled.js": "export {};",
  },
  "browser.js",
);
cases.push(
  {
    name: "browser relative mapping",
    specifier: "./platform.js",
    importer: "node_modules/browser-map/browser.js",
    target: "node_modules/browser-map/web.js",
  },
  {
    name: "browser builtin mapping",
    specifier: "fs",
    importer: "node_modules/browser-map/browser.js",
    target: "node_modules/browser-map/shim.js",
  },
  {
    name: "deep import is not the package entry",
    specifier: "browser-cjs/browser.js",
    target: "node_modules/browser-cjs/browser.js",
  },
  {
    name: "package query survives entry selection",
    specifier: "browser-cjs?raw",
    target: "node_modules/browser-cjs/browser.js?raw",
  },
);

project.write("tsconfig.json", {
  compilerOptions: {
    baseUrl: ".",
    paths: { shadow: ["src/should-not-win.ts"], "@app/*": ["src/*"] },
  },
});
project.write("src/should-not-win.ts", "export {};");
project.write("src/alias-target.ts", "export {};");
project.write("package.json", {
  name: "fixture-project",
  type: "module",
  exports: "./src/only-ts.ts",
  imports: { "#local": "./src/only-ts.ts" },
});
const aliases = {
  shadow: join(project.directory, "src/alias-target.ts"),
  short: join(project.directory, "src"),
};
cases.push(
  { name: "alias before tsconfig", specifier: "shadow", target: "src/alias-target.ts" },
  { name: "alias subpath", specifier: "short/only-ts", target: "src/only-ts.ts" },
  { name: "alias query", specifier: "short/only-ts?raw", target: "src/only-ts.ts?raw" },
  { name: "tsconfig path", specifier: "@app/only-ts", target: "src/only-ts.ts" },
  { name: "tsconfig path query", specifier: "@app/only-ts?raw", target: "src/only-ts.ts?raw" },
  { name: "package imports", specifier: "#local", target: "src/only-ts.ts" },
  { name: "package imports query", specifier: "#local?raw", target: "src/only-ts.ts?raw" },
  { name: "package self reference", specifier: "fixture-project", target: "src/only-ts.ts" },
);
const resolver = createModuleResolver({ rootDirectory: project.directory, aliases });
let server: ViteDevServer;
beforeAll(async () => {
  server = await createServer({
    root: project.directory,
    configFile: false,
    envFile: false,
    logLevel: "silent",
    server: { middlewareMode: true, hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
    resolve: {
      conditions: ["browser", "module", "development"],
      alias: aliases,
      tsconfigPaths: true,
    },
  });
});
afterAll(async () => {
  await server?.close();
});

it.each(cases)("matches Vite: $name", async ({ specifier, importer, target }) => {
  const fromFile = importer ? join(project.directory, importer) : project.importer;
  const native = await server.environments.client.pluginContainer.resolveId(specifier, fromFile);
  expect(native?.id).toBe(join(project.directory, target));
  expect(resolver.resolve(specifier, fromFile)).toEqual({ kind: "file", id: native?.id });
});

it("preserves browser:false as an explicit ignored result, not an empty successful module", async () => {
  const importer = join(project.directory, "node_modules/browser-map/browser.js");
  const native = await server.environments.client.pluginContainer.resolveId(
    "./disabled.js",
    importer,
  );
  expect(native?.id).toContain("__vite-browser-external");
  expect(resolver.resolve("./disabled.js", importer)).toEqual({
    kind: "ignored",
    specifier: "./disabled.js",
  });
});

const permutations = (values: string[]): string[][] =>
  values.length === 0
    ? [[]]
    : values.flatMap((value, index) =>
        permutations(values.filter((_, innerIndex) => innerIndex !== index)).map((tail) => [
          value,
          ...tail,
        ]),
      );
const conditionOrders = permutations(["import", "require", "development", "default"]);
const conditionalProject = createResolverProject();
conditionOrders.forEach((order, index) => {
  const name = `conditions-${index}`;
  conditionalProject.write(`node_modules/${name}/package.json`, {
    name,
    type: "module",
    exports: Object.fromEntries(order.map((condition) => [condition, `./${condition}.js`])),
  });
  for (const condition of order)
    conditionalProject.write(`node_modules/${name}/${condition}.js`, "export {};");
});

const nodeResolve = (
  requests: string[],
  importer: string,
  kind: "esm" | "commonjs",
  mode: string,
): unknown =>
  JSON.parse(
    execFileSync(
      process.execPath,
      [
        "--experimental-import-meta-resolve",
        "--conditions=module",
        `--conditions=${mode}`,
        "--input-type=module",
        "--eval",
        `
    import {createRequire, isBuiltin} from 'node:module';
    import {fileURLToPath, pathToFileURL} from 'node:url';
    const importer=${JSON.stringify(importer)};
    const requests=${JSON.stringify(requests)};
    console.log(JSON.stringify(requests.map((specifier)=>{
      try {
        const resolved=${kind === "esm" ? "import.meta.resolve(specifier,pathToFileURL(importer).href)" : "createRequire(importer).resolve(specifier)"};
        if(isBuiltin(resolved)) return {kind:'builtin',id:resolved.startsWith('node:')?resolved:'node:'+resolved};
        return {kind:'file',id:${kind === "esm" ? "fileURLToPath(resolved)" : "resolved"}};
      } catch { return {kind:'unresolved'}; }
    })));
  `,
      ],
      { encoding: "utf8" },
    ),
  );

it.each([
  { kind: "esm", mode: "development" },
  { kind: "commonjs", mode: "development" },
  { kind: "esm", mode: "production" },
  { kind: "commonjs", mode: "production" },
] satisfies Array<{ kind: "esm" | "commonjs"; mode: string }>)(
  "matches Node on all 24 export-condition orders for $kind/$mode",
  ({ kind, mode }) => {
    const requests = conditionOrders.map((_, index) => `conditions-${index}`);
    const conditionalResolver = createModuleResolver({
      rootDirectory: conditionalProject.directory,
      nodeEnvironment: mode,
    });
    const actual = requests.map((request) =>
      conditionalResolver.resolve(request, conditionalProject.importer, kind, "server"),
    );
    const expected = conditionOrders.map((order, index) => {
      const selected = order.find(
        (condition) =>
          condition === "default" ||
          condition === mode ||
          condition === (kind === "esm" ? "import" : "require"),
      );
      return {
        kind: "file",
        id: join(conditionalProject.directory, `node_modules/conditions-${index}/${selected}.js`),
      };
    });
    expect(nodeResolve(requests, conditionalProject.importer, kind, mode)).toEqual(expected);
    expect(actual).toEqual(expected);
  },
);

const exportsProject = createResolverProject();
const exportsPackages = [
  {
    name: "nested",
    exports: { node: { import: "./import.js", require: "./require.js" }, default: "./default.js" },
    request: "nested",
    resolves: true,
  },
  { name: "array", exports: [null, "./default.js"], request: "array", resolves: true },
  {
    name: "invalid-array",
    exports: ["../outside.js", "./default.js"],
    request: "invalid-array",
    resolves: true,
  },
  {
    name: "pattern",
    exports: { "./features/*": "./features/*.js", "./features/private/*": null },
    request: "pattern/features/value",
    resolves: true,
  },
  {
    name: "private",
    exports: { "./features/*": "./features/*.js", "./features/private/*": null },
    request: "private/features/private/secret",
    resolves: false,
  },
  {
    name: "blocked",
    exports: { ".": "./default.js", "./secret": null },
    request: "blocked/secret",
    resolves: false,
  },
  {
    name: "unexported",
    exports: { ".": "./default.js" },
    request: "unexported/secret.js",
    resolves: false,
  },
  { name: "escape", exports: "../outside.js", request: "escape", resolves: false },
  {
    name: "mixed",
    exports: { ".": "./default.js", import: "./import.js" },
    request: "mixed",
    resolves: false,
  },
  {
    name: "missing-first",
    exports: ["./missing.js", "./default.js"],
    request: "missing-first",
    resolves: false,
  },
];
for (const entry of exportsPackages) {
  exportsProject.write(`node_modules/${entry.name}/package.json`, {
    name: entry.name,
    type: "module",
    exports: entry.exports,
    main: "./default.js",
  });
  for (const filePath of [
    "default.js",
    "import.js",
    "require.js",
    "secret.js",
    "features/value.js",
    "features/private/secret.js",
  ])
    exportsProject.write(`node_modules/${entry.name}/${filePath}`, "export {};");
}

it("matches Node require on export patterns, blocked paths, invalid targets, and arrays without fallback leaks", () => {
  const exportsResolver = createModuleResolver({ rootDirectory: exportsProject.directory });
  const actual = exportsPackages.map((entry) => {
    const result = exportsResolver.resolve(
      entry.request,
      exportsProject.importer,
      "commonjs",
      "server",
    );
    expect(result.kind, entry.name).toBe(entry.resolves ? "file" : "unresolved");
    return result.kind === "unresolved" ? { kind: "unresolved" } : result;
  });
  expect(actual).toEqual(
    nodeResolve(
      exportsPackages.map((entry) => entry.request),
      exportsProject.importer,
      "commonjs",
      "development",
    ),
  );
});

it.each(["esm", "commonjs"] satisfies Array<"esm" | "commonjs">)(
  "compares bundler private imports with Node %s, retaining builtin differences",
  (kind) => {
    const mapped = createResolverProject();
    mapped.write("package.json", {
      name: "mapped",
      type: "module",
      imports: {
        "#target": { import: "./import.js", require: "./require.js" },
        "#feature/*": "./features/*.js",
        "#blocked": null,
        "#builtin": "fs",
      },
    });
    for (const filePath of ["import.js", "require.js", "features/value.js"])
      mapped.write(filePath, "export {};");
    const requests = [
      "#target",
      "#feature/value",
      "#builtin",
      "#blocked",
      "#missing",
      "node:not-a-builtin",
    ];
    const mappedResolver = createModuleResolver({ rootDirectory: mapped.directory });
    const actual = requests.map((request) => {
      const result = mappedResolver.resolve(request, mapped.importer, kind, "server");
      return result.kind === "unresolved" ? { kind: "unresolved" } : result;
    });
    expect(actual).toEqual([
      { kind: "file", id: join(mapped.directory, kind === "esm" ? "import.js" : "require.js") },
      { kind: "file", id: join(mapped.directory, "features/value.js") },
      { kind: "builtin", id: "node:fs" },
      { kind: "unresolved" },
      { kind: "unresolved" },
      { kind: "unresolved" },
    ]);
    expect(nodeResolve(requests, mapped.importer, kind, "development")).toEqual(
      actual.map((result, index) =>
        kind === "commonjs" && requests[index] === "#builtin" ? { kind: "unresolved" } : result,
      ),
    );
  },
);

it("follows Vite SSR rather than Node for node:-prefixed private-import targets", async () => {
  const mapped = createResolverProject();
  mapped.write("package.json", { imports: { "#builtin": "node:fs" } });
  const native = await server.environments.ssr.pluginContainer.resolveId(
    "#builtin",
    mapped.importer,
  );
  expect(native).toMatchObject({ id: "node:fs", external: true });
  expect(
    createModuleResolver({ rootDirectory: mapped.directory }).resolve(
      "#builtin",
      mapped.importer,
      "esm",
      "server",
    ),
  ).toEqual({ kind: "builtin", id: "node:fs" });
  expect(nodeResolve(["#builtin"], mapped.importer, "esm", "development")).toEqual([
    { kind: "unresolved" },
  ]);
});

it.each(["exact", "@app/value", "fallback/value"])(
  "matches TypeScript on inherited path mapping %s",
  (specifier) => {
    const configured = createResolverProject();
    const target = configured.write("src/value.ts", "export {};");
    configured.write("config/base.json", {
      compilerOptions: {
        baseUrl: "..",
        paths: {
          exact: ["src/value.ts"],
          "@app/*": ["src/*"],
          "fallback/*": ["absent/*", "src/*"],
        },
      },
    });
    const configFile = configured.write("tsconfig.json", { extends: "./config/base.json" });
    const config = ts.getParsedCommandLineOfConfigFile(
      configFile,
      {},
      {
        ...ts.sys,
        onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
          throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
        },
      },
    );
    if (!config) throw new Error("Missing TypeScript config");
    expect(config.errors).toEqual([]);
    const native = ts.resolveModuleName(
      specifier,
      configured.importer,
      config.options,
      ts.sys,
    ).resolvedModule;
    expect(native?.resolvedFileName).toBe(target);
    expect(
      createModuleResolver({ rootDirectory: configured.directory }).resolve(
        specifier,
        configured.importer,
      ),
    ).toEqual({ kind: "file", id: target });
  },
);
