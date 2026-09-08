import { createRequire } from "node:module";
import path from "node:path";
import { readPackageManifest } from "../package-manifest.js";

/** The version of `packageName` Node resolves from `rootDirectory`, as the framework's own binary would. */
export const readInstalledVersion = (rootDirectory: string, packageName: string): string | null => {
  try {
    const require = createRequire(path.join(rootDirectory, "index.js"));
    return readPackageManifest(require.resolve(`${packageName}/package.json`)).version ?? null;
  } catch {
    return null;
  }
};

export interface PackageVersion {
  major: number;
  minor: number;
}

export const parsePackageVersion = (version: string | null): PackageVersion | null => {
  const [major, minor] = version?.split(".").map(Number) ?? [];
  return major === undefined || minor === undefined || Number.isNaN(major) || Number.isNaN(minor)
    ? null
    : { major, minor };
};

export const isVersionAtLeast = (version: PackageVersion, major: number, minor: number): boolean =>
  version.major > major || (version.major === major && version.minor >= minor);
