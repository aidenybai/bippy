import type { ModuleResolution, ModuleResolverOptions } from "../module-resolver.js";

export interface AliasResolutionOptions {
  aliasOrder: string[];
  literalAliases?: boolean;
  recursiveAliases?: boolean;
  options: Pick<ModuleResolverOptions, "alias">;
}

export const resolveAliases = (
  specifier: string,
  configuration: AliasResolutionOptions,
  resolveFile: (request: string, isAliased: boolean) => ModuleResolution,
): ModuleResolution => {
  const resolveAlias = (request: string, visited: Set<string>): ModuleResolution => {
    const indices = [request.indexOf("?"), request.indexOf("#", 1)].filter((index) => index >= 0);
    const suffixIndex = Math.min(request.length, ...indices);
    const pathname = request.slice(0, suffixIndex);
    const suffix = request.slice(suffixIndex);
    for (const name of configuration.aliasOrder) {
      const wildcard = configuration.literalAliases ? -1 : name.indexOf("*");
      let captured: string;
      if (!configuration.literalAliases && name.endsWith("$")) {
        if (pathname !== name.slice(0, -1)) continue;
        captured = "";
      } else if (wildcard >= 0) {
        const prefix = name.slice(0, wildcard);
        const ending = name.slice(wildcard + 1);
        if (
          !pathname.startsWith(prefix) ||
          !pathname.endsWith(ending) ||
          pathname.length < prefix.length + ending.length
        )
          continue;
        captured = pathname.slice(prefix.length, pathname.length - ending.length);
      } else {
        if (pathname !== name && !pathname.startsWith(`${name}/`)) continue;
        captured = pathname.slice(name.length);
      }
      if (visited.has(name))
        return { kind: "unresolved", specifier, error: `Circular alias: ${name}` };
      const ancestors = new Set(visited);
      ancestors.add(name);
      let failure: ModuleResolution = {
        kind: "unresolved",
        specifier,
        error: `Alias has no targets: ${name}`,
      };
      for (const target of configuration.options.alias?.[name] ?? []) {
        if (target === null || target === undefined) return { kind: "ignored", specifier };
        const mapped =
          (wildcard >= 0 ? target.replaceAll("*", captured) : target + captured) + suffix;
        const result =
          mapped === request || configuration.recursiveAliases === false
            ? resolveFile(mapped, true)
            : resolveAlias(mapped, ancestors);
        if (result.kind !== "unresolved") return result;
        failure = { ...result, specifier };
      }
      return failure;
    }
    return resolveFile(request, visited.size > 0);
  };
  return resolveAlias(specifier, new Set());
};
