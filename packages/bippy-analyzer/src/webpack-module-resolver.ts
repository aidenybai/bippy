import { dirname, isAbsolute } from "node:path";
import type { Resolver } from "enhanced-resolve";
import { getResolutionError } from "./resolution-error.js";
import type { ModuleResolution } from "./module-resolver.js";

export interface WebpackResolveRequestOptions {
  context?: Parameters<Resolver["resolve"]>[0];
  resolveContext?: Parameters<Resolver["resolve"]>[3];
}

export const createWebpackModuleResolver = (resolver: Pick<Resolver, "resolve">) => ({
  resolve: (
    specifier: string,
    fromFile: string,
    options: WebpackResolveRequestOptions = {},
  ): Promise<ModuleResolution> => {
    if (!isAbsolute(fromFile)) throw new Error("The importing file must be an absolute path");
    return new Promise((resolve) => {
      const unresolved = (error: unknown) =>
        resolve({
          kind: "unresolved",
          specifier,
          error: getResolutionError(error),
        });
      try {
        resolver.resolve(
          options.context ?? {},
          dirname(fromFile),
          specifier,
          options.resolveContext ?? {},
          (error, result) => {
            if (error) return unresolved(error);
            if (result === false) return resolve({ kind: "ignored", specifier });
            if (!result) return unresolved("Webpack did not resolve the request");
            resolve({ kind: isAbsolute(result) ? "file" : "virtual", id: result });
          },
        );
      } catch (error) {
        unresolved(error);
      }
    });
  },
});
