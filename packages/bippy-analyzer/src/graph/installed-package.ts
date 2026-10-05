import { existsSync } from "node:fs";
import path from "node:path";
import { readPackageManifest } from "../package-manifest.js";
import type { InstalledPackage } from "../types.js";
import { isInstalledFor } from "./install-root.js";
import type { ModuleResolver } from "./module-resolver.js";
import type { ModuleResolution } from "./module-types.js";

const resolvedFilePath = (rootDirectory: string, resolution: ModuleResolution): string | null =>
  resolution.kind === "external" &&
  resolution.filePath !== null &&
  isInstalledFor(rootDirectory, resolution.filePath)
    ? resolution.filePath
    : null;

/** The nearest `package.json` above `filePath` that declares `packageName`; an `exports` map may hide `<name>/package.json` itself. */
const findOwningManifest = (filePath: string, packageName: string): InstalledPackage | null => {
  for (let directory = path.dirname(filePath); ; directory = path.dirname(directory)) {
    const manifestPath = path.join(directory, "package.json");
    if (existsSync(manifestPath)) {
      const { name, version, bundledVersions } = readPackageManifest(manifestPath);
      if (
        name !== undefined &&
        (name === packageName || bundledVersions?.[packageName] !== undefined)
      )
        return version !== undefined ? { name, version, bundledVersions } : null;
    }
    if (path.dirname(directory) === directory) return null;
  }
};

/** The `package.json` identity of `packageName` as the app resolves it from `rootDirectory`; null when it is not installed. */
export const readInstalledPackage = (
  resolver: ModuleResolver,
  rootDirectory: string,
  packageName: string,
): InstalledPackage | null => {
  const importer = `${rootDirectory}/index.js`;
  const manifestPath = resolvedFilePath(
    rootDirectory,
    resolver.resolve(`${packageName}/package.json`, importer),
  );
  if (manifestPath !== null) {
    const { name, version, bundledVersions } = readPackageManifest(manifestPath);
    return name !== undefined && version !== undefined ? { name, version, bundledVersions } : null;
  }
  const entryPath = resolvedFilePath(rootDirectory, resolver.resolve(packageName, importer));
  return entryPath === null ? null : findOwningManifest(entryPath, packageName);
};

export const readInstalledPackageVersion = (
  resolver: ModuleResolver,
  rootDirectory: string,
  packageName: string,
): string | null => {
  const installed = readInstalledPackage(resolver, rootDirectory, packageName);
  return installed?.bundledVersions?.[packageName] ?? installed?.version ?? null;
};
