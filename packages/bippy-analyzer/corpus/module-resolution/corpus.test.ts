import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readlinkSync, writeFileSync } from "node:fs";
import { createRequire, isBuiltin } from "node:module";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, it } from "vite-plus/test";
import ts from "typescript";
import { createModuleResolver } from "../../src/module-resolver.js";
import { createResolver, type ModuleDiscovery, type ProjectConfiguration } from "../../src/core.js";
import { createNodeModuleResolver } from "../../src/node-module-resolver.js";
import { createViteModuleResolver } from "../../src/vite-module-resolver.js";
import { createWebpackModuleResolver } from "../../src/webpack-module-resolver.js";
import { createRollupModuleResolver } from "../../src/rollup-module-resolver.js";
import type { PluginContext } from "rollup";

interface Request {
  specifier: string;
  importer: string;
  kind: "esm" | "commonjs" | "dynamic";
  line: number;
}
interface Outcome {
  kind: string;
  id?: string;
  error?: string;
}
interface SourceCheck {
  scope: string;
  native: Outcome;
  candidate: Outcome;
  matches: boolean;
}
interface Row extends Request {
  native: Outcome;
  core: Outcome;
  matches: boolean;
  sourceCheck?: SourceCheck;
  discovery?: ModuleDiscovery;
}
interface Project {
  id: string;
  repository: string;
  revision: string;
  toolchain: string;
  expectedSourceHash: string;
}
const project: Project = JSON.parse(readFileSync("/project-metadata.json", "utf8"));
const directory = "/project";
const require = createRequire(join(directory, "package.json"));
const tracked: string[] = JSON.parse(readFileSync("/tracked-files.json", "utf8"));
const report: {
  project: Project;
  node: string;
  files: number;
  sourceHash?: string;
  typeOnly: number;
  dynamicUnknown: number;
  rows: Row[];
  status: string;
  error?: string;
  nativeVersion?: string;
  build?: object;
  unsupportedPolicy?: string[];
  implementation: string;
  configurations: Record<string, ProjectConfiguration | { error: string }>;
} = {
  project,
  node: process.version,
  files: 0,
  typeOnly: 0,
  dynamicUnknown: 0,
  rows: [],
  status: "started",
  implementation: process.env.BIPPY_RESOLVER_IMPLEMENTATION ?? "core",
  configurations: {},
};
const referencePlatform = ["vite", "next"].includes(project.toolchain) ? "browser" : "node";
const projectResolver = createResolver({
  rootDirectory: directory,
  mode: ["vite", "next"].includes(project.toolchain) ? "development" : "production",
  allowConfigExecution: true,
});
const getSourceHash = () => {
  const hash = createHash("sha256");
  for (const file of tracked)
    hash
      .update(file)
      .update("\0")
      .update(
        lstatSync(join(directory, file)).isSymbolicLink()
          ? readlinkSync(join(directory, file))
          : readFileSync(join(directory, file)),
      );
  return hash.digest("hex");
};
const requests: Request[] = [];
const digest = createHash("sha256");
for (const file of tracked.filter(
  (file) =>
    /\.[cm]?[jt]sx?$/.test(file) &&
    !/\.d\.[cm]?ts$/.test(file) &&
    (/^(src|app|components|lib|hooks|contexts|store|stores|utils|pages)\//.test(file) ||
      file === "index.js") &&
    !/(^|\/)(__tests__|test|tests|__mocks__)\//.test(file) &&
    !/\.(test|spec)\./.test(file),
)) {
  const importer = join(directory, file);
  const source = readFileSync(importer, "utf8");
  digest.update(file).update("\0").update(source);
  report.files++;
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const record = (specifier: string, kind: Request["kind"], node: ts.Node) =>
    requests.push({
      specifier,
      kind,
      importer,
      line: parsed.getLineAndCharacterOfPosition(node.getStart(parsed)).line + 1,
    });
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      if (
        clause?.isTypeOnly ||
        (clause?.namedBindings &&
          ts.isNamedImports(clause.namedBindings) &&
          !clause.name &&
          clause.namedBindings.elements.length > 0 &&
          clause.namedBindings.elements.every((element) => element.isTypeOnly))
      )
        report.typeOnly++;
      else record(node.moduleSpecifier.text, "esm", node);
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      if (
        node.isTypeOnly ||
        (node.exportClause &&
          ts.isNamedExports(node.exportClause) &&
          node.exportClause.elements.length > 0 &&
          node.exportClause.elements.every((element) => element.isTypeOnly))
      )
        report.typeOnly++;
      else record(node.moduleSpecifier.text, "esm", node);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression &&
      ts.isStringLiteral(node.moduleReference.expression)
    ) {
      if (node.isTypeOnly) report.typeOnly++;
      else record(node.moduleReference.expression.text, "commonjs", node);
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require"))
    ) {
      if (node.arguments[0] && ts.isStringLiteralLike(node.arguments[0]))
        record(
          node.arguments[0].text,
          node.expression.kind === ts.SyntaxKind.ImportKeyword ? "dynamic" : "commonjs",
          node,
        );
      else report.dynamicUnknown++;
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
}
report.sourceHash = digest.digest("hex");
const getIdentity = (outcome: Outcome) => {
  if (outcome.kind === "file" && outcome.id?.startsWith("file:")) {
    const url = new URL(outcome.id);
    return fileURLToPath(url) + url.search + url.hash;
  }
  return outcome.id;
};
const add = (request: Request, native: Outcome, resolveCore: () => Outcome) => {
  const kind = request.kind === "commonjs" ? "require" : "import";
  const discovery =
    report.implementation === "project"
      ? projectResolver.discover(request.specifier, request.importer, { kind })
      : undefined;
  if (discovery) {
    const platforms: Array<"browser" | "node"> = ["browser", "node"];
    for (const platform of platforms) {
      const key = `${relative(directory, dirname(request.importer))}:${platform}:${kind}`;
      if (!report.configurations[key]) {
        try {
          report.configurations[key] = projectResolver.getConfiguration(request.importer, {
            kind,
            platform,
          });
        } catch (error) {
          report.configurations[key] = {
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }
    }
  }
  const core = discovery ? discovery[referencePlatform] : resolveCore();
  report.rows.push({
    ...request,
    importer: relative(directory, request.importer),
    native,
    core,
    discovery,
    matches:
      native.kind !== "unresolved" &&
      native.kind === core.kind &&
      getIdentity(native) === getIdentity(core),
  });
};
const getNativeNodeOutcomes = (requests: Request[]): Outcome[] =>
  JSON.parse(
    execFileSync(
      process.execPath,
      [
        "--experimental-import-meta-resolve",
        "--input-type=module",
        "--eval",
        `import {createRequire,isBuiltin} from 'node:module'; import {pathToFileURL} from 'node:url'; import {statSync} from 'node:fs';
    console.log(JSON.stringify(${JSON.stringify(requests)}.map(request=>{try { const id=request.kind==='commonjs'?createRequire(request.importer).resolve(request.specifier):import.meta.resolve(request.specifier,pathToFileURL(request.importer).href); if(isBuiltin(id)) return {kind:'builtin',id:id.startsWith('node:')?id:'node:'+id}; const url=request.kind==='commonjs'?pathToFileURL(id):new URL(id); if(!statSync(url).isFile()) throw new Error('Not a file'); return {kind:'file',id:url.href}; } catch(error){return {kind:'unresolved',error:error.message};}})));`,
      ],
      { encoding: "utf8", maxBuffer: 8 * 1024 * 1024, timeout: 10000 },
    ),
  );
const sourceError = (error: unknown) =>
  error instanceof Error ? (error.stack ?? error.message) : String(error);

it("compares real project import occurrences with its installed toolchain", async () => {
  try {
    expect(getSourceHash(), "installed source matches the pinned checkout").toBe(
      project.expectedSourceHash,
    );
    process.chdir(directory);
    if (project.toolchain === "vite") {
      const imported = await import(pathToFileURL(require.resolve("vite")).href);
      const vite = imported.createServer ? imported : imported.default;
      report.nativeVersion = require("vite/package.json").version;
      const server = await vite.createServer({
        root: directory,
        logLevel: "silent",
        clearScreen: false,
        server: { middlewareMode: true, watch: null, hmr: false },
        optimizeDeps: { disabled: true, noDiscovery: true, include: [] },
      });
      try {
        const config = server.config.resolve;
        const aliases = config.alias.filter(
          (alias: { find: unknown }) => typeof alias.find === "string",
        );
        report.unsupportedPolicy = config.alias
          .filter((alias: { find: unknown }) => typeof alias.find !== "string")
          .map((alias: { find: unknown }) => String(alias.find));
        const getCore = (kind: Request["kind"]) =>
          createModuleResolver({
            extensions: config.extensions ?? [".mjs", ".js", ".ts", ".jsx", ".tsx", ".json"],
            mainFields: config.mainFields ?? ["browser", "module", "jsnext:main", "jsnext", "main"],
            aliasFields: ["browser"],
            alias: Object.fromEntries(
              aliases.map((alias: { find: string; replacement: string }) => [
                alias.find,
                [alias.replacement],
              ]),
            ),
            aliasPrecedence: "alias",
            conditionNames: [
              "browser",
              "module",
              "development",
              ...(config.conditions ?? []).map((condition: string) =>
                condition === "development|production" ? "development" : condition,
              ),
              kind === "commonjs" ? "require" : "import",
            ],
            extensionAlias: {
              ".js": [".js", ".ts", ".tsx"],
              ".jsx": [".jsx", ".tsx"],
              ".mjs": [".mjs", ".mts"],
              ".cjs": [".cjs", ".cts"],
            },
            symlinks: !config.preserveSymlinks,
          });
        const cores = {
          esm: getCore("esm"),
          commonjs: getCore("commonjs"),
          dynamic: getCore("dynamic"),
        };
        const adapter = createViteModuleResolver(
          server.environments?.client ?? { pluginContainer: server.pluginContainer },
        );
        for (const request of requests)
          add(
            request,
            await adapter.resolve(request.specifier, request.importer, {
              custom: { "node-resolve": { isRequire: request.kind === "commonjs" } },
            }),
            () => cores[request.kind].resolve(request.specifier, request.importer),
          );
      } finally {
        await server.close();
      }
      try {
        await vite.build({ root: directory, logLevel: "silent", build: { write: false } });
        report.build = {
          status: "compiled",
          scope: "native Vite production bundle, no application execution",
        };
      } catch (error) {
        report.build = { status: "failed", error: sourceError(error) };
      }
    } else if (project.toolchain === "node") {
      report.nativeVersion = process.version;
      const esm = createNodeModuleResolver({ kind: "esm" });
      const commonjs = createNodeModuleResolver({ kind: "commonjs" });
      const native = getNativeNodeOutcomes(requests);
      requests.forEach((request, index) =>
        add(request, native[index], () =>
          (request.kind === "commonjs" ? commonjs : esm).resolve(
            request.specifier,
            request.importer,
          ),
        ),
      );
    } else if (project.toolchain === "next") {
      report.nativeVersion = require("next/package.json").version;
      const webpack = require("next/dist/compiled/webpack/webpack");
      const loadConfig = require("next/dist/server/config").default;
      const config = await loadConfig("phase-development-server", directory);
      const configuration = require("next/dist/build/webpack-config");
      const info = await configuration.loadProjectInfo({ dir: directory, config, dev: true });
      const options = await configuration.default(directory, {
        buildId: "resolver-audit",
        encryptionKey: "resolver-audit",
        config,
        compilerType: "client",
        dev: true,
        entrypoints: {},
        pagesDir: existsSync(join(directory, "pages")) ? join(directory, "pages") : undefined,
        appDir: existsSync(join(directory, "app")) ? join(directory, "app") : undefined,
        rewrites: { beforeFiles: [], afterFiles: [], fallback: [] },
        originalRewrites: undefined,
        originalRedirects: undefined,
        runWebpackSpan: require("next/dist/trace").trace("resolver-audit"),
        ...info,
        previewProps: {
          previewModeId: "resolver-audit",
          previewModeEncryptionKey: "resolver-audit",
          previewModeSigningKey: "resolver-audit",
        },
      });
      const compiler = webpack.webpack(options);
      try {
        for (const kind of ["esm", "commonjs"] satisfies Array<"esm" | "commonjs">) {
          const resolver = compiler.resolverFactory.get("normal", { dependencyType: kind });
          const policy = resolver.options;
          const aliases = policy.alias.filter(
            (alias: { name: unknown }) => typeof alias.name === "string",
          );
          const core = createModuleResolver({
            builtinModules: false,
            conditionNames: [...policy.conditionNames],
            extensions: [...policy.extensions],
            mainFields: policy.mainFields.map((field: { name: string[] }) => field.name[0]),
            mainFiles: [...policy.mainFiles],
            aliasFields: [...policy.aliasFields],
            symlinks: policy.symlinks,
            alias: Object.fromEntries(
              aliases.map(
                (alias: {
                  name: string;
                  onlyModule: boolean;
                  alias: string | false | string[];
                }) => [
                  `${alias.name}${alias.onlyModule ? "$" : ""}`,
                  alias.alias === false
                    ? [null]
                    : Array.isArray(alias.alias)
                      ? alias.alias
                      : [alias.alias],
                ],
              ),
            ),
            aliasPrecedence: "alias",
            tsconfig: info.jsConfigPath ? { configFile: info.jsConfigPath } : undefined,
          });
          const adapter = createWebpackModuleResolver(resolver);
          for (const request of requests.filter(
            (request) => (request.kind === "commonjs" ? "commonjs" : "esm") === kind,
          ))
            add(request, await adapter.resolve(request.specifier, request.importer), () =>
              core.resolve(request.specifier, request.importer),
            );
        }
      } finally {
        await new Promise<void>((resolve, reject) =>
          compiler.close((error: unknown) => (error ? reject(error) : resolve())),
        );
      }
      report.build = {
        status: "not-run",
        scope: "Next client webpack resolver only; not an RSC or Turbopack graph",
      };
    } else if (project.toolchain === "rollup") {
      const native = await import(pathToFileURL(require.resolve("rollup")).href);
      report.nativeVersion = native.VERSION;
      const config = (
        await import(pathToFileURL(join(directory, "rollup.config.mjs")).href)
      ).default({});
      const esm = config.find(
        (entry: { output: { format?: string } }) => entry.output.format === "esm",
      );
      const core = createModuleResolver({
        conditionNames: ["import", "node", "default"],
        extensions: [".js", ".ts", ".tsx"],
        mainFields: ["module", "main"],
        tsconfig: { configFile: join(directory, "tsconfig.json") },
      });
      const bundle = await native.rollup({
        ...esm,
        plugins: [
          ...esm.plugins,
          {
            name: "resolver-audit",
            async buildStart(this: PluginContext) {
              const adapter = createRollupModuleResolver(this);
              expect(
                await adapter.resolve("./vanilla.ts", join(directory, "src/index.ts")),
              ).toEqual({ kind: "external", id: "zustand/vanilla" });
              for (const request of requests) {
                const result = await this.resolve(request.specifier, request.importer);
                add(
                  request,
                  result
                    ? { kind: result.external ? "external" : "file", id: result.id }
                    : { kind: "unresolved" },
                  () => core.resolve(request.specifier, request.importer),
                );
              }
            },
          },
        ],
      });
      try {
        const generated = await bundle.generate(esm.output);
        expect(
          generated.output.flatMap((output: { type: string; imports?: string[] }) =>
            output.type === "chunk" ? (output.imports ?? []) : [],
          ),
        ).toEqual(expect.arrayContaining(["zustand/vanilla", "zustand/react"]));
        report.build = {
          status: "compiled",
          scope: "upstream base ESM Rollup configuration, no declarations or postbuild",
        };
      } finally {
        await bundle.close();
      }
    }
    if (report.implementation === "project") {
      const selected = report.rows.filter(
        (row) =>
          row.native.kind === "external" ||
          (row.native.kind === "unresolved" && isBuiltin(row.specifier)),
      );
      const sourceRequests = selected.map((row) => ({
        specifier: row.specifier,
        importer: join(directory, row.importer),
        kind: row.kind,
        line: row.line,
      }));
      const nativeSources = sourceRequests.length ? getNativeNodeOutcomes(sourceRequests) : [];
      selected.forEach((row, index) => {
        if (!row.discovery) throw new Error("Missing project discovery outcomes");
        const candidate = row.discovery.node;
        const native = nativeSources[index];
        row.sourceCheck = {
          scope:
            row.native.kind === "external"
              ? "Node source lookup; not Rollup packaging parity"
              : "Explicit Node context; not automatic source-layer assignment",
          native,
          candidate,
          matches:
            native.kind !== "unresolved" &&
            native.kind === candidate.kind &&
            getIdentity(native) === getIdentity(candidate),
        };
      });
    }
    report.status =
      report.rows.some((row) => !row.matches || row.native.kind === "unresolved") ||
      (report.build && "status" in report.build && report.build.status === "failed")
        ? "nonpass"
        : "matched";
  } catch (error) {
    report.status = "setup-error";
    report.error = sourceError(error);
  } finally {
    writeFileSync(
      `/reports/${project.id}-${process.env.BIPPY_RESOLVER_REPORT_SUFFIX}.json`,
      JSON.stringify(
        { ...report, sourceUnchanged: getSourceHash() === project.expectedSourceHash },
        null,
        2,
      ),
    );
  }
  expect(getSourceHash(), "source remains unchanged after analysis").toBe(
    project.expectedSourceHash,
  );
  expect(report.rows.length).toBeGreaterThan(0);
  expect(
    report.status,
    report.error ??
      JSON.stringify({
        mismatches: report.rows.filter((row) => !row.matches).length,
        unresolved: report.rows.filter((row) => row.native.kind === "unresolved").length,
        build: report.build,
      }),
  ).toBe("matched");
}, 120000);
