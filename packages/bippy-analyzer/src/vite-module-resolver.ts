import type { DevEnvironment } from "vite-plus";
import { getResolutionError } from "./resolution-error.js";
import type { ModuleResolution } from "./module-resolver.js";
import { getPluginModuleResolution } from "./plugin-module-resolution.js";

export const createViteModuleResolver = (environment: Pick<DevEnvironment, "pluginContainer">) => ({
  resolve: async (
    specifier: string,
    fromFile: string,
    options?: Parameters<DevEnvironment["pluginContainer"]["resolveId"]>[2],
  ): Promise<ModuleResolution> => {
    try {
      const resolved = await environment.pluginContainer.resolveId(specifier, fromFile, options);
      if (
        resolved?.id === "__vite-browser-external" ||
        resolved?.id.startsWith("__vite-browser-external:")
      )
        return { kind: "ignored", specifier };
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
