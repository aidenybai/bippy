import type { ModuleCacheKey, ModuleCacheKeyObject, ModuleCacheLoader } from '../module.mts';
import {
  AbstractModuleRecord,
  Assert,
  JSStringValue,
  ManagedRealm, ModuleCache, NormalCompletion, OutOfRange, Realm,
  ThrowCompletion,
  ValueOfNormalCompletion,
  type ModuleLoader,
} from '#self';

export type BuiltinModuleSource = string | ((realm: Realm) => AbstractModuleRecord) | Uint8Array;

export interface BuiltinModuleLoaderOptions {
  getModuleCache?: (realm: ManagedRealm) => ModuleCache;
  /** preloaded builtin module */
  builtinModules?: Map<ModuleCacheKeyObject, BuiltinModuleSource>;
  /** dynamically loaded builtin module */
  loadBuiltinModule?: (moduleRequest: ModuleCacheKeyObject, realm: Realm, callback: (result: BuiltinModuleSource | NormalCompletion<BuiltinModuleSource> | ThrowCompletion<JSStringValue>) => void) => void;
  isBuiltinModule?: (specifier: string) => boolean;
}

export function createBuiltinModuleLoader(options: BuiltinModuleLoaderOptions = {}): ModuleLoader {
  const {
    getModuleCache = (realm) => realm.HostDefined.resolverCache,
    builtinModules,
    loadBuiltinModule,
    // starts with ".", "/", "#", or "<scheme>:" are not built-in modules
    isBuiltinModule = (specifier) => !/^(\.|\/|#|\w+:)/.test(specifier),
  } = options;

  const modules = new Map<ModuleCacheKey, BuiltinModuleSource>();
  if (builtinModules) {
    for (const [key, source] of builtinModules) {
      modules.set(ModuleCache.toCacheKey(key), source);
    }
  }

  return (referrer, moduleRequest, _hostDefined, finish, suggestError) => {
    if (!isBuiltinModule(moduleRequest.Specifier)) {
      finish(undefined);
      return;
    }
    const realm = (referrer instanceof Realm ? referrer : referrer.Realm) as ManagedRealm;
    const cache = getModuleCache(realm);
    const requestKey = ModuleCache.toCacheKey(moduleRequest);
    const load: ModuleCacheLoader = (callback) => {
      if (modules.has(requestKey)) {
        next(modules.get(requestKey)!);
      } else if (loadBuiltinModule) {
        loadBuiltinModule(moduleRequest, realm, (result) => {
          if (result instanceof ThrowCompletion) {
            callback(result);
            return;
          }
          const value = ValueOfNormalCompletion(result);
          Assert(typeof value === 'string' || value instanceof Uint8Array || value instanceof AbstractModuleRecord);
          next(value);
        });
      } else {
        suggestError(`Module "${moduleRequest.Specifier}" is not a builtin module`);
        finish(undefined);
      }
    };

    if (cache) {
      cache.load(requestKey, load, finish);
    } else {
      load(finish);
    }

    function next(source: BuiltinModuleSource) {
      if (typeof source === 'string') {
        const moduleCompletion = realm.compileModule(source, { specifier: moduleRequest.Specifier });
        finish(moduleCompletion);
      } else if (source instanceof Uint8Array) {
        finish(realm.createBytesModule(source));
      } else if (typeof source === 'function') {
        const moduleRecord = source(realm);
        finish(NormalCompletion(moduleRecord));
      } else throw OutOfRange.exhaustive(source);
    }
  };
}
