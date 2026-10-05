import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { build } from "esbuild";
import type { ModuleGraph } from "../graph/module-graph.js";
import type { StaticRendererOptions } from "../render/types.js";
import { EngineUnsupportedError } from "./unsupported.js";

export interface EngineBundleOptions {
  graph: ModuleGraph;
  options: StaticRendererOptions;
  filePath: string;
  exportName?: string;
}

export interface EngineBundle {
  source: string;
  sourceHash: string;
  modules: number;
}

export const bundleApplication = async ({
  graph,
  options,
  filePath,
  exportName,
}: EngineBundleOptions): Promise<EngineBundle> => {
  const hostPath = resolve(import.meta.dirname, "dom-host.ts");
  const rootsPath = resolve(import.meta.dirname, "dom-roots.ts");
  const entryPath = resolve(options.rootDirectory, "__bippy_engine_entry__.js");
  const client = graph.resolver.resolve("react-dom/client", entryPath);
  if ((client.kind !== "internal" && client.kind !== "external") || !client.filePath)
    throw new EngineUnsupportedError("Cannot resolve project React DOM client");
  const clientPath = client.filePath;
  const definitions: Record<string, string> = { "process.env.NODE_ENV": '"development"' };
  for (const [name, value] of Object.entries(options.defines ?? {})) {
    if (value === null)
      throw new EngineUnsupportedError(`Unset bundler define is not ported: ${name}`);
    definitions[name] = JSON.stringify(value);
  }
  const result = await build({
    stdin: {
      contents: `import * as host from ${JSON.stringify(hostPath)};
        export const owned = [...host.owned, require(${JSON.stringify(clientPath)}).createRoot];
        export const observe = host.observe;
        export const takeErrors = host.takeErrors;
        export const unmount = host.unmount;
        export const start = (props) => {
          const application = require(${JSON.stringify(filePath)});
          ${exportName === undefined ? "" : `host.mount(application[${JSON.stringify(exportName)}], props);`}
        };`,
      sourcefile: entryPath,
      resolveDir: options.rootDirectory,
      loader: "js",
    },
    bundle: true,
    write: false,
    format: "iife",
    globalName: "__bippyEngineApplication",
    platform: "browser",
    target: "es2022",
    jsx: "automatic",
    tsconfig: options.tsconfigPath,
    define: definitions,
    keepNames: true,
    metafile: true,
    logLevel: "silent",
    plugins: [
      {
        name: "bippy-engine-project",
        setup: (builder) => {
          builder.onResolve({ filter: /^react-dom\/client$/ }, () => ({
            path: "client",
            namespace: "bippy-react-client",
          }));
          builder.onLoad({ filter: /.*/, namespace: "bippy-react-client" }, () => ({
            contents: `import {trackRoot} from ${JSON.stringify(rootsPath)};
            import * as client from ${JSON.stringify(clientPath)};
            export * from ${JSON.stringify(clientPath)};
            export const createRoot = (...args) => trackRoot(client.createRoot(...args));
            export const hydrateRoot = (...args) => trackRoot(client.hydrateRoot(...args));`,
            loader: "js",
            resolveDir: options.rootDirectory,
          }));
          builder.onResolve({ filter: /.*/ }, (request) => {
            const from = /^react(?:-dom)?(?:\/|$)/.test(request.path)
              ? entryPath
              : request.importer || entryPath;
            if (request.path.includes("?")) {
              const importer = graph.getModule(from);
              const module = importer && graph.resolveImportedModule(request.path, importer);
              if (module && "file" in module && module.filePath.includes("?"))
                return { path: module.filePath };
              throw new EngineUnsupportedError(
                `No source transform for engine import query: ${request.path}`,
              );
            }
            const resolution = graph.resolver.resolve(
              request.path,
              from,
              request.kind === "require-call" ? "commonjs" : "esm",
            );
            if (resolution.kind === "builtin")
              throw new EngineUnsupportedError(
                `Engine application cannot import native module: ${request.path}`,
              );
            if (resolution.kind === "unresolved" || !resolution.filePath)
              throw new EngineUnsupportedError(`Cannot resolve engine import: ${request.path}`);
            return { path: resolution.filePath };
          });
          builder.onLoad({ filter: /.*/, namespace: "file" }, (request) => {
            const module = graph.getModule(request.path);
            if (!module)
              throw new EngineUnsupportedError(
                `No source transform for engine module: ${request.path}`,
              );
            if (module.file.errors.length) throw new Error(module.file.errors.join("\n"));
            return {
              contents: module.file.sourceText,
              loader: module.file.lang === "json" ? "js" : module.file.lang,
              resolveDir: dirname(request.path),
            };
          });
        },
      },
    ],
  }).catch((error: unknown) => {
    if (error && typeof error === "object") {
      const errors: unknown = Reflect.get(error, "errors");
      if (Array.isArray(errors)) {
        for (const problem of errors) {
          if (!problem || typeof problem !== "object") continue;
          const detail: unknown = Reflect.get(problem, "detail");
          if (detail instanceof EngineUnsupportedError) throw detail;
        }
      }
    }
    throw error;
  });
  if (Object.values(result.metafile.outputs).some((output) => output.imports.length))
    throw new EngineUnsupportedError("Engine application bundle contains external imports");
  const source = `${result.outputFiles[0].text}\n__bippyEngineApplication;`;
  return {
    source,
    sourceHash: createHash("sha256").update(source).digest("hex"),
    modules: Object.keys(result.metafile.inputs).length,
  };
};
