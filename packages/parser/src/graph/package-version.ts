import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { z } from "zod";

const PACKAGE_VERSION = z.object({ version: z.string() });

export const readPackageVersion = (packageJsonPath: string): string | null => {
  try {
    const parsed = PACKAGE_VERSION.safeParse(JSON.parse(readFileSync(packageJsonPath, "utf8")));
    return parsed.success ? parsed.data.version : null;
  } catch {
    return null;
  }
};

/** The version of `packageName` Node resolves from `rootDirectory`, as the framework's own binary would. */
export const readInstalledVersion = (rootDirectory: string, packageName: string): string | null => {
  try {
    const require = createRequire(path.join(rootDirectory, "index.js"));
    return readPackageVersion(require.resolve(`${packageName}/package.json`));
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

export const isVersionAtLeast = (
  version: PackageVersion,
  major: number,
  minor: number,
): boolean => version.major > major || (version.major === major && version.minor >= minor);
