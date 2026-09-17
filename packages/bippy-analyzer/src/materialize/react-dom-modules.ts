import { readFileSync, realpathSync } from "node:fs";
import { createRequire, Module } from "node:module";
import { dirname, extname, isAbsolute, relative, sep } from "node:path";
import { ReactRuntimeError } from "../errors.js";

export interface ReactDomPaths {
  dom: string;
  client: string;
  server: string;
}

export const createReactDomLoader = (react: unknown, paths: ReactDomPaths) => {
  const directory = dirname(realpathSync(paths.dom));
  const aliases = new Map([
    ["react-dom", paths.dom],
    ["react-dom/client", paths.client],
    ["react-dom/server", paths.server],
  ]);
  const modules = new Map<string, Module>();
  const load = (filePath: string): unknown => {
    const filename = realpathSync(filePath);
    const cached = modules.get(filename);
    if (cached) return cached.exports;
    const requireFromFile = createRequire(filename);
    const loaded = new Module(filename);
    loaded.filename = filename;
    loaded.paths = requireFromFile.resolve.paths("react") ?? [];
    loaded.require = (specifier) => {
      if (specifier === "react") return react;
      const alias = aliases.get(specifier);
      if (alias !== undefined) return load(alias);
      const resolved = requireFromFile.resolve(specifier);
      const relativePath = relative(directory, resolved);
      if (
        !isAbsolute(relativePath) &&
        relativePath !== ".." &&
        !relativePath.startsWith(`..${sep}`) &&
        (extname(resolved) === ".js" || extname(resolved) === ".cjs")
      ) {
        return load(resolved);
      }
      return requireFromFile(specifier);
    };
    modules.set(filename, loaded);
    try {
      // HACK: vendored React DOM expects bundler aliases; keep them local without patching Node's module cache or resolver.
      const compile: unknown = Reflect.get(loaded, "_compile");
      if (typeof compile !== "function")
        throw new ReactRuntimeError("CommonJS compilation is unavailable");
      compile.call(loaded, readFileSync(filename, "utf8"), filename);
      loaded.loaded = true;
      return loaded.exports;
    } catch (error) {
      modules.delete(filename);
      throw error;
    }
  };
  return load;
};
