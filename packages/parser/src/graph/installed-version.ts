import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { z } from "zod";

const packageManifestSchema = z.object({ version: z.string() });

/** The version of `packageName` the app's own module resolution loads from `rootDirectory`; `null` when it is not installed. */
export const readInstalledVersion = (rootDirectory: string, packageName: string): string | null => {
  try {
    const resolveFromRoot = createRequire(path.join(rootDirectory, "package.json")).resolve;
    const manifestPath = resolveFromRoot(`${packageName}/package.json`);
    return packageManifestSchema.parse(JSON.parse(readFileSync(manifestPath, "utf8"))).version;
  } catch {
    return null;
  }
};

/** Whether `version` (prerelease tags ignored) is at least `minimum`, both `major.minor.patch`. */
export const isVersionAtLeast = (version: string, minimum: string): boolean => {
  const parse = (input: string) => input.split("-")[0].split(".").map(Number);
  const [actual, floor] = [parse(version), parse(minimum)];
  for (let index = 0; index < floor.length; index += 1) {
    const difference = (actual[index] ?? 0) - floor[index];
    if (difference !== 0) return difference > 0;
  }
  return true;
};
