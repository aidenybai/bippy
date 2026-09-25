import { dirname, isAbsolute } from "node:path";
import type { Resolver } from "enhanced-resolve";
import type { ModuleResolution } from "./module-resolver.js";

export const createWebpackModuleResolver = (resolver: Pick<Resolver, "resolve">) => ({
  resolve: (specifier: string, fromFile: string): Promise<ModuleResolution> => {
    if (!isAbsolute(fromFile)) throw new Error("The importing file must be an absolute path");
    return new Promise((resolve) => {
      const unresolved = (error: unknown) =>
        resolve({
          kind: "unresolved",
          specifier,
          error: error instanceof Error ? error.message : String(error),
        });
      try {
        resolver.resolve({}, dirname(fromFile), specifier, {}, (error, result) => {
          if (error) return unresolved(error);
          if (result === false) return resolve({ kind: "ignored", specifier });
          if (!result) return unresolved("Webpack did not resolve the request");
          resolve({ kind: isAbsolute(result) ? "file" : "virtual", id: result });
        });
      } catch (error) {
        unresolved(error);
      }
    });
  },
});
