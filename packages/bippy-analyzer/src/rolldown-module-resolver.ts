import type { PluginContext, PluginContextResolveOptions } from "rolldown";
import { getResolutionError } from "./resolution-error.js";
import type { ModuleResolution } from "./module-resolver.js";
import { getPluginModuleResolution } from "./plugin-module-resolution.js";

export const createRolldownModuleResolver = (context: Pick<PluginContext, "resolve">) => ({
  resolve: async (
    specifier: string,
    fromFile?: string,
    options?: PluginContextResolveOptions,
  ): Promise<ModuleResolution> => {
    try {
      const resolved = await context.resolve(specifier, fromFile, options);
      if (resolved?.id.startsWith("\0rolldown/empty.js?")) return { kind: "ignored", specifier };
      return getPluginModuleResolution(resolved, specifier);
    } catch (error) {
      return {
        kind: "unresolved",
        specifier,
        error: getResolutionError(error),
      };
    }
  },
});
