import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { z } from "zod";

const packageManifestSchema = z.object({ name: z.string(), version: z.string() });

const readPackageManifest = (
  manifestPath: string,
): z.infer<typeof packageManifestSchema> | null => {
  const parsed = packageManifestSchema.safeParse(JSON.parse(readFileSync(manifestPath, "utf8")));
  return parsed.success ? parsed.data : null;
};

/** The manifest of `packageName` as Node resolves it: `<pkg>/package.json` when its exports allow, else the nearest one above its entry. */
const resolvePackageManifest = (
  requireFromRoot: NodeJS.Require,
  packageName: string,
): z.infer<typeof packageManifestSchema> | null => {
  try {
    return readPackageManifest(requireFromRoot.resolve(`${packageName}/package.json`));
  } catch {
    let directory = path.dirname(requireFromRoot.resolve(packageName));
    while (path.dirname(directory) !== directory) {
      const manifestPath = path.join(directory, "package.json");
      const manifest = existsSync(manifestPath) ? readPackageManifest(manifestPath) : null;
      if (manifest?.name === packageName) return manifest;
      directory = path.dirname(directory);
    }
    return null;
  }
};

export interface PackageVersion {
  major: number;
  minor: number;
  patch: number;
}

/** Version of `packageName` as Node resolves it from `rootDirectory`; `null` when it is not installed. */
export const readInstalledPackageVersion = (
  rootDirectory: string,
  packageName: string,
): PackageVersion | null => {
  try {
    const requireFromRoot = createRequire(path.join(rootDirectory, "package.json"));
    const manifest = resolvePackageManifest(requireFromRoot, packageName);
    const match = manifest ? /^(\d+)\.(\d+)\.(\d+)/.exec(manifest.version) : null;
    return match
      ? { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) }
      : null;
  } catch {
    return null;
  }
};

export const isAtLeastVersion = (
  version: PackageVersion | null,
  major: number,
  minor: number,
  patch = 0,
): boolean => {
  if (version === null) return false;
  if (version.major !== major) return version.major > major;
  if (version.minor !== minor) return version.minor > minor;
  return version.patch >= patch;
};
