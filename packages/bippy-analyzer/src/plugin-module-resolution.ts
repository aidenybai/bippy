import { isBuiltin } from "node:module";
import { isAbsolute } from "node:path";
import type { ModuleResolution } from "./module-resolver.js";

export interface PluginModuleId {
  id: string;
  external?: boolean | "absolute" | "relative";
}

export const getPluginModuleResolution = (
  resolved: PluginModuleId | null,
  specifier: string,
): ModuleResolution => {
  if (!resolved)
    return { kind: "unresolved", specifier, error: "The toolchain did not resolve the request" };
  if (resolved.external && isBuiltin(resolved.id))
    return {
      kind: "builtin",
      id: resolved.id.startsWith("node:") ? resolved.id : `node:${resolved.id}`,
    };
  if (resolved.external)
    return {
      kind: "external",
      id: resolved.id,
      ...(typeof resolved.external === "string" ? { external: resolved.external } : {}),
    };
  return { kind: isAbsolute(resolved.id) ? "file" : "virtual", id: resolved.id };
};
