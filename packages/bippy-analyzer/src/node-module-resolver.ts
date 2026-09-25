import { createRequire, isBuiltin } from "node:module";
import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { moduleResolve } from "import-meta-resolve";
import { getResolutionError } from "./resolution-error.js";
import type { ModuleResolution } from "./module-resolver.js";

interface NodeEsmResolverOptions {
  kind: "esm";
  conditions?: string[];
  preserveSymlinks?: boolean;
}

interface NodeCommonjsResolverOptions {
  kind: "commonjs";
}

export const createNodeModuleResolver = (
  options: NodeEsmResolverOptions | NodeCommonjsResolverOptions,
) => {
  const policy = structuredClone(options);
  const conditions = new Set([
    "node",
    "import",
    "node-addons",
    "module-sync",
    ...(policy.kind === "esm" ? (policy.conditions ?? []) : []),
  ]);
  return {
    resolve: (specifier: string, fromFile: string): ModuleResolution => {
      if (!isAbsolute(fromFile)) throw new Error("The importing file must be an absolute path");
      try {
        const resolved =
          policy.kind === "commonjs"
            ? createRequire(fromFile).resolve(specifier)
            : moduleResolve(specifier, pathToFileURL(fromFile), conditions, policy.preserveSymlinks)
                .href;
        if (isBuiltin(resolved))
          return {
            kind: "builtin",
            id: resolved.startsWith("node:") ? resolved : `node:${resolved}`,
          };
        if (policy.kind === "commonjs") return { kind: "file", id: pathToFileURL(resolved).href };
        if (resolved.startsWith("file:")) return { kind: "file", id: resolved };
        return { kind: "unresolved", specifier, error: `A loader is required for ${resolved}` };
      } catch (error) {
        return {
          kind: "unresolved",
          specifier,
          error: getResolutionError(error),
        };
      }
    },
  };
};
