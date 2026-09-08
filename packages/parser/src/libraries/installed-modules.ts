import { createRequire } from "node:module";
import path from "node:path";

const isModuleNamespace = (module: object): boolean =>
  Object.prototype.toString.call(module) === "[object Module]";

export const getDefaultExport = (module: object): unknown =>
  isModuleNamespace(module) || Reflect.get(module, "__esModule") === true
    ? Reflect.get(module, "default")
    : module;

const RESOLUTION_ERROR_CODES = new Set([
  "MODULE_NOT_FOUND",
  "ERR_MODULE_NOT_FOUND",
  "ERR_PACKAGE_PATH_NOT_EXPORTED",
]);

const isResolutionError = (error: unknown): boolean =>
  error instanceof Error &&
  "code" in error &&
  typeof error.code === "string" &&
  RESOLUTION_ERROR_CODES.has(error.code);

/** The project's own installed copy of a package, loaded as the runtime would; `null` when it is not installed. */
export class InstalledModules {
  private readonly requireFromRoot: NodeJS.Require;
  private readonly modules = new Map<string, object | null>();

  constructor(rootDirectory: string) {
    this.requireFromRoot = createRequire(path.join(rootDirectory, "package.json"));
  }

  /** `specifier` as the project resolves it, or as `dependentSpecifier`'s installed copy resolves it when given. */
  load(specifier: string, dependentSpecifier?: string): object | null {
    const cacheKey = dependentSpecifier ? `${dependentSpecifier}\u0000${specifier}` : specifier;
    const cached = this.modules.get(cacheKey);
    if (cached !== undefined) return cached;
    const module = this.requireInstalled(specifier, dependentSpecifier);
    this.modules.set(cacheKey, module);
    return module;
  }

  private requireInstalled(specifier: string, dependentSpecifier?: string): object | null {
    let loaded: unknown;
    try {
      const require = dependentSpecifier
        ? createRequire(this.requireFromRoot.resolve(dependentSpecifier))
        : this.requireFromRoot;
      loaded = require(specifier);
    } catch (error) {
      if (isResolutionError(error)) return null;
      throw error;
    }
    return (typeof loaded === "object" && loaded !== null) || typeof loaded === "function"
      ? loaded
      : null;
  }
}

const installedModulesByRoot = new Map<string, InstalledModules>();

export const getInstalledModules = (rootDirectory: string): InstalledModules => {
  let installed = installedModulesByRoot.get(rootDirectory);
  if (!installed) {
    installed = new InstalledModules(rootDirectory);
    installedModulesByRoot.set(rootDirectory, installed);
  }
  return installed;
};
