import { readPackageManifest } from "../package-manifest.js";
import type { InstalledPackage } from "../types.js";
import type { ModuleResolver } from "./module-resolver.js";

/** The `package.json` identity of `packageName` as the app resolves it from `rootDirectory`; null when it is not installed. */
export const readInstalledPackage = (
  resolver: ModuleResolver,
  rootDirectory: string,
  packageName: string,
): InstalledPackage | null => {
  const resolution = resolver.resolve(`${packageName}/package.json`, `${rootDirectory}/index.js`);
  if (resolution.kind !== "external" || !resolution.filePath) return null;
  const { name, version } = readPackageManifest(resolution.filePath);
  return name !== undefined && version !== undefined ? { name, version } : null;
};
