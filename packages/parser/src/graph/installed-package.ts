import { existsSync } from "node:fs";
import path from "node:path";
import { readPackageManifest } from "../package-manifest.js";
import type { InstalledPackage, ModuleResolution } from "../types.js";
import type { ModuleResolver } from "./module-resolver.js";

const resolvedFilePath = (resolution: ModuleResolution): string | null =>
  resolution.kind === "external" ? resolution.filePath : null;

/** The nearest `package.json` above `filePath` that declares `packageName`; an `exports` map may hide `<name>/package.json` itself. */
const findOwningManifest = (filePath: string, packageName: string): InstalledPackage | null => {
  for (let directory = path.dirname(filePath); ; directory = path.dirname(directory)) {
    const manifestPath = path.join(directory, "package.json");
    if (existsSync(manifestPath)) {
      const { name, version } = readPackageManifest(manifestPath);
      if (name === packageName) return version !== undefined ? { name, version } : null;
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
  const manifestPath = resolvedFilePath(resolver.resolve(`${packageName}/package.json`, importer));
  if (manifestPath !== null) {
    const { name, version } = readPackageManifest(manifestPath);
    return name !== undefined && version !== undefined ? { name, version } : null;
  }
  const entryPath = resolvedFilePath(resolver.resolve(packageName, importer));
  return entryPath === null ? null : findOwningManifest(entryPath, packageName);
};
