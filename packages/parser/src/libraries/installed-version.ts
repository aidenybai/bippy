import { z } from "zod";
import { getInstalledModules } from "./installed-modules.js";

const packageManifestSchema = z.object({ version: z.string() });

/** The version of the project's installed copy of a package; `null` when it is not installed. */
export const readInstalledVersion = (rootDirectory: string, packageName: string): string | null => {
  const manifest = getInstalledModules(rootDirectory).load(`${packageName}/package.json`);
  const parsed = packageManifestSchema.safeParse(manifest);
  return parsed.success ? parsed.data.version : null;
};

export const isVersionAtLeast = (version: string, major: number, minor: number): boolean => {
  const [installedMajor = 0, installedMinor = 0] = version.split(".").map(Number);
  return installedMajor > major || (installedMajor === major && installedMinor >= minor);
};
