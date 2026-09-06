import { readFileSync, statSync } from "node:fs";
import { dirname, extname, isAbsolute, join, normalize, resolve } from "node:path";
import { isModuleFilePath, parseModule, SOURCE_EXTENSIONS } from "../module/parse.js";
import type { ParsedModule } from "../module/types.js";
import {
  createModuleResolver,
  getPackageNameFromSpecifier,
  type ModuleResolver,
  type ResolvedModule,
} from "./resolver.js";

export interface ProjectOptions {
  rootDirectory: string;
  /**
   * In-memory sources keyed by absolute or root-relative path. They shadow
   * the file system, which keeps unit tests free of temp directories.
   */
  files?: Record<string, string>;
  alias?: Record<string, string[]>;
  /** Absolute directories searched for bare specifiers ahead of `node_modules`. */
  moduleDirectories?: string[];
  /** Parse dependencies inside `node_modules` when linking components. */
  followExternalModules?: boolean;
}

export interface Project {
  rootDirectory: string;
  followExternalModules: boolean;
  resolvePath: (filePath: string) => string;
  readSource: (filePath: string) => string | null;
  getModule: (filePath: string) => ParsedModule | null;
  resolveSpecifier: (fromFile: string, specifier: string) => ResolvedModule | null;
  getLoadedModules: () => ParsedModule[];
}

const isFile = (filePath: string): boolean => {
  try {
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
};

const resolveOverlaySpecifier = (
  overlay: Map<string, string>,
  fromFile: string,
  specifier: string,
): string | null => {
  if (!specifier.startsWith(".") && !isAbsolute(specifier)) return null;
  const base = normalize(isAbsolute(specifier) ? specifier : join(dirname(fromFile), specifier));
  const candidates = [base];
  if (!extname(base)) {
    for (const extension of SOURCE_EXTENSIONS) candidates.push(base + extension);
    for (const extension of SOURCE_EXTENSIONS) candidates.push(join(base, `index${extension}`));
  } else {
    const withoutExtension = base.slice(0, -extname(base).length);
    for (const extension of SOURCE_EXTENSIONS) candidates.push(withoutExtension + extension);
  }
  for (const candidate of candidates) if (overlay.has(candidate)) return candidate;
  return null;
};

export const createProject = (options: ProjectOptions): Project => {
  const rootDirectory = resolve(options.rootDirectory);
  const resolvePath = (filePath: string): string =>
    normalize(isAbsolute(filePath) ? filePath : join(rootDirectory, filePath));
  const overlay = new Map<string, string>();
  for (const [filePath, sourceText] of Object.entries(options.files ?? {})) {
    overlay.set(resolvePath(filePath), sourceText);
  }
  const moduleCache = new Map<string, ParsedModule | null>();
  let resolver: ModuleResolver | null = null;
  const getResolver = (): ModuleResolver => {
    resolver ??= createModuleResolver({
      rootDirectory,
      alias: options.alias,
      moduleDirectories: options.moduleDirectories,
    });
    return resolver;
  };

  const readSource = (filePath: string): string | null => {
    const absolutePath = resolvePath(filePath);
    const overlaySource = overlay.get(absolutePath);
    if (overlaySource !== undefined) return overlaySource;
    if (!isFile(absolutePath)) return null;
    try {
      return readFileSync(absolutePath, "utf8");
    } catch {
      return null;
    }
  };

  const getModule = (filePath: string): ParsedModule | null => {
    const absolutePath = resolvePath(filePath);
    if (moduleCache.has(absolutePath)) return moduleCache.get(absolutePath) ?? null;
    const sourceText = isModuleFilePath(absolutePath) ? readSource(absolutePath) : null;
    const parsed = sourceText === null ? null : parseModule(absolutePath, sourceText);
    moduleCache.set(absolutePath, parsed);
    return parsed;
  };

  const resolveSpecifier = (fromFile: string, specifier: string): ResolvedModule | null => {
    const absoluteFrom = resolvePath(fromFile);
    const overlayPath = resolveOverlaySpecifier(overlay, absoluteFrom, specifier);
    if (overlayPath) return { path: overlayPath, isExternal: false, packageName: null };
    if (overlay.size > 0 && overlay.has(absoluteFrom) && !specifier.startsWith(".")) {
      const resolved = getResolver().resolve(absoluteFrom, specifier);
      if (resolved) return resolved;
      return {
        path: specifier,
        isExternal: true,
        packageName: getPackageNameFromSpecifier(specifier),
      };
    }
    return getResolver().resolve(absoluteFrom, specifier);
  };

  return {
    rootDirectory,
    followExternalModules: options.followExternalModules ?? true,
    resolvePath,
    readSource,
    getModule,
    resolveSpecifier,
    getLoadedModules: () =>
      [...moduleCache.values()].filter((parsed): parsed is ParsedModule => parsed !== null),
  };
};
