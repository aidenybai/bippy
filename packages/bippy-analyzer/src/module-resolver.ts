import { isBuiltin } from "node:module";
import { isAbsolute } from "node:path";
import { ResolverFactory, type NapiResolveOptions } from "oxc-resolver";

export interface ModuleResolverOptions extends NapiResolveOptions {
  conditionNames: string[];
  extensions: string[];
  mainFields: string[];
  aliasPrecedence?: "alias" | "tsconfig";
}

export interface FileResolution {
  kind: "file";
  id: string;
}

export interface BuiltinResolution {
  kind: "builtin";
  id: string;
}

export interface IgnoredResolution {
  kind: "ignored";
  specifier: string;
}

export interface UnresolvedModule {
  kind: "unresolved";
  specifier: string;
  error: string;
}

export interface VirtualResolution {
  kind: "virtual";
  id: string;
}

export interface ExternalResolution {
  kind: "external";
  id: string;
}

export type ModuleResolution =
  | FileResolution
  | BuiltinResolution
  | IgnoredResolution
  | UnresolvedModule
  | VirtualResolution
  | ExternalResolution;

export const createModuleResolver = (options: ModuleResolverOptions) => {
  const { aliasPrecedence = "tsconfig", ...policy } = structuredClone(options);
  const factories = new Map<boolean, ResolverFactory>();
  const resolveModule = (specifier: string, fromFile: string): ModuleResolution => {
    if (!isAbsolute(fromFile)) throw new Error("The importing file must be an absolute path");
    const unresolved = (error: string): UnresolvedModule => ({
      kind: "unresolved",
      specifier,
      error,
    });
    if (!specifier || specifier.includes("\0"))
      return unresolved("Empty or virtual module requests require a loader");
    if (
      /^[a-z][a-z\d+.-]*:/i.test(specifier) &&
      !specifier.startsWith("node:") &&
      !specifier.startsWith("file:") &&
      !isAbsolute(specifier)
    )
      return unresolved("URL schemes require an explicit loader");
    const indices = [specifier.indexOf("?"), specifier.indexOf("#", 1)].filter(
      (index) => index >= 0,
    );
    const requestPath = specifier.slice(0, Math.min(specifier.length, ...indices));
    const aliased =
      aliasPrecedence === "alias" &&
      Object.keys(policy.alias ?? {}).some((name) =>
        name.endsWith("$")
          ? requestPath === name.slice(0, -1)
          : requestPath === name || requestPath.startsWith(`${name}/`),
      );
    try {
      let factory = factories.get(aliased);
      if (!factory) {
        factory = new ResolverFactory({
          nodePath: false,
          ...policy,
          tsconfig: aliased ? undefined : policy.tsconfig,
        });
        factories.set(aliased, factory);
      }
      const result = factory.resolveFileSync(fromFile, specifier);
      if (result.path) return { kind: "file", id: result.path };
      if (result.error?.startsWith("Path is ignored ")) return { kind: "ignored", specifier };
      const builtin =
        result.builtin?.resolved ??
        (result.error === `Cannot find module '${requestPath}'` && isBuiltin(requestPath)
          ? requestPath
          : undefined);
      if (builtin && isBuiltin(builtin) && requestPath === specifier)
        return { kind: "builtin", id: builtin.startsWith("node:") ? builtin : `node:${builtin}` };
      return unresolved(result.error ?? "Module not found");
    } catch (error) {
      return unresolved(error instanceof Error ? error.message : String(error));
    }
  };

  return {
    resolve: resolveModule,
    clearCache: () => {
      for (const factory of factories.values()) factory.clearCache();
      factories.clear();
    },
  };
};
