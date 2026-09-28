import type { ModuleLoader } from "../../engine/dist/declaration/index.mjs";
import type { SymbolicEngine } from "../symbolic/load-engine.js";
import { ConcreteRuntimeError } from "./errors.js";

export interface JavaScriptModuleArtifact {
  specifier: string;
  source: string;
}

export const snapshotModuleArtifacts = (
  artifacts: readonly JavaScriptModuleArtifact[],
): ReadonlyMap<string, string> => {
  const sources = new Map<string, string>();
  for (const artifact of artifacts) {
    const { specifier, source } = artifact;
    if (typeof specifier !== "string" || typeof source !== "string")
      throw new ConcreteRuntimeError("Module artifacts require string specifiers and sources");
    let url: URL;
    try {
      url = new URL(specifier);
    } catch (cause) {
      throw new ConcreteRuntimeError("Module artifact specifiers must be absolute URLs", { cause });
    }
    if (!["file:", "http:", "https:"].includes(url.protocol))
      throw new ConcreteRuntimeError("Only file, http, and https artifact URLs are supported");
    if (url.href !== specifier || sources.has(specifier))
      throw new ConcreteRuntimeError("Module artifact URLs must be canonical and unique");
    sources.set(specifier, source);
  }
  return sources;
};

export const createArtifactModuleLoader =
  (api: SymbolicEngine["api"], sources: ReadonlyMap<string, string>): ModuleLoader =>
  (referrer, request, _hostDefined, finish) => {
    if (request.Attributes.length) {
      finish(undefined);
      return;
    }
    let specifier: string;
    try {
      const isRelative = /^(\.\.?\/|\/)/u.test(request.Specifier);
      specifier = isRelative
        ? new URL(request.Specifier, referrer.HostDefined?.specifier).href
        : new URL(request.Specifier).href;
    } catch {
      finish(undefined);
      return;
    }
    const source = sources.get(specifier);
    if (source === undefined) {
      finish(undefined);
      return;
    }
    const realm = referrer instanceof api.Realm ? referrer : referrer.Realm;
    if (!(realm instanceof api.ManagedRealm))
      throw new ConcreteRuntimeError("Module artifacts require a managed realm");
    const cache = api.ModuleCache.fromReferer(referrer);
    const key = cache.toCacheKey({ Specifier: specifier, Attributes: [] });
    cache.load(
      key,
      (setCache) => setCache(realm.compileModule(source, { specifier, public: specifier })),
      finish,
    );
  };
