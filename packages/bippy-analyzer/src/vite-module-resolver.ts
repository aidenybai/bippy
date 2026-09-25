import { isBuiltin } from "node:module";
import { isAbsolute } from "node:path";
import type { DevEnvironment } from "vite-plus";
import type { ModuleResolution } from "./module-resolver.js";

export const createViteModuleResolver = (environment: Pick<DevEnvironment, "pluginContainer">) => ({
  resolve: async (specifier: string, fromFile: string): Promise<ModuleResolution> => {
    try {
      const resolved = await environment.pluginContainer.resolveId(specifier, fromFile);
      if (!resolved)
        return { kind: "unresolved", specifier, error: "Vite did not resolve the request" };
      if (
        resolved.id === "__vite-browser-external" ||
        resolved.id.startsWith("__vite-browser-external:")
      )
        return { kind: "ignored", specifier };
      if (isBuiltin(resolved.id))
        return {
          kind: "builtin",
          id: resolved.id.startsWith("node:") ? resolved.id : `node:${resolved.id}`,
        };
      if (resolved.external) return { kind: "external", id: resolved.id };
      return { kind: isAbsolute(resolved.id) ? "file" : "virtual", id: resolved.id };
    } catch (error) {
      return {
        kind: "unresolved",
        specifier,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
});
