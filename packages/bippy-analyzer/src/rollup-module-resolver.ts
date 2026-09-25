import type { PluginContext } from "rollup";
import { getResolutionError } from "./resolution-error.js";
import type { ModuleResolution } from "./module-resolver.js";
import { getPluginModuleResolution } from "./plugin-module-resolution.js";

export const createRollupModuleResolver = (context: Pick<PluginContext, "resolve">) => ({
  resolve: async (
    specifier: string,
    fromFile?: string,
    options?: Parameters<PluginContext["resolve"]>[2],
  ): Promise<ModuleResolution> => {
    try {
      return getPluginModuleResolution(
        await context.resolve(specifier, fromFile, options),
        specifier,
      );
    } catch (error) {
      return {
        kind: "unresolved",
        specifier,
        error: getResolutionError(error),
      };
    }
  },
});
