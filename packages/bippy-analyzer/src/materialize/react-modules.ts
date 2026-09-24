import { readFileSync, realpathSync } from "node:fs";
import { createRequire, Module } from "node:module";
import { dirname, extname, isAbsolute, relative, sep } from "node:path";
import { compileFunction, constants } from "node:vm";

export interface ReactModulePaths {
  react: string;
  dom: string;
  client: string | null;
  server: string;
}

const loaders = new Map<string, (filePath: string) => unknown>();

export const createReactModuleLoader = (paths: ReactModulePaths) => {
  const cacheKey = JSON.stringify(paths);
  const cachedLoader = loaders.get(cacheKey);
  if (cachedLoader) return cachedLoader;
  const directories = [paths.react, paths.dom].map((filePath) => dirname(realpathSync(filePath)));
  const aliases = new Map<string, string>([
    ["react", paths.react],
    ["react-dom", paths.dom],
    ["react-dom/server", paths.server],
  ]);
  if (paths.client) aliases.set("react-dom/client", paths.client);
  const modules = new Map<string, Module>();
  const runtimeProcess = { ...process, env: { ...process.env, NODE_ENV: "development" } };
  const load = (filePath: string): unknown => {
    const filename = realpathSync(filePath);
    const cached = modules.get(filename);
    if (cached) return cached.exports;
    const requireFromFile = createRequire(filename);
    const loaded = new Module(filename);
    loaded.filename = filename;
    loaded.paths = requireFromFile.resolve.paths("react") ?? [];
    loaded.require = (specifier) => {
      const alias = aliases.get(specifier);
      if (alias !== undefined) return load(alias);
      const resolved = requireFromFile.resolve(specifier);
      const isLocal = directories.some((directory) => {
        const relativePath = relative(directory, resolved);
        return (
          !isAbsolute(relativePath) && relativePath !== ".." && !relativePath.startsWith(`..${sep}`)
        );
      });
      return isLocal && [".js", ".cjs"].includes(extname(resolved))
        ? load(resolved)
        : requireFromFile(specifier);
    };
    const requireModule = Object.assign(loaded.require, requireFromFile);
    modules.set(filename, loaded);
    try {
      // HACK: act requires coherent development builds; isolate their environment and aliases without changing the app's process or Node module cache.
      const compile = compileFunction(
        readFileSync(filename, "utf8"),
        ["exports", "require", "module", "__filename", "__dirname"],
        {
          filename,
          contextExtensions: [{ process: runtimeProcess }],
          importModuleDynamically: constants.USE_MAIN_CONTEXT_DEFAULT_LOADER,
        },
      );
      compile.call(
        loaded.exports,
        loaded.exports,
        requireModule,
        loaded,
        filename,
        dirname(filename),
      );
      loaded.loaded = true;
      return loaded.exports;
    } catch (error) {
      modules.delete(filename);
      throw error;
    }
  };
  loaders.set(cacheKey, load);
  return load;
};
