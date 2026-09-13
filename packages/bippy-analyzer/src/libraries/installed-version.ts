import semver from "semver";
import { readInstalledPackage } from "../graph/installed-package.js";
import { ModuleResolver } from "../graph/module-resolver.js";

/** The version of the project's installed copy of a package; `null` when it is not installed. */
export const readInstalledVersion = (rootDirectory: string, packageName: string): string | null =>
  readInstalledPackage(new ModuleResolver({ rootDirectory }), rootDirectory, packageName)
    ?.version ?? null;

/** Release-line comparison: a `15.3.0-canary.5` install already has 15.3's shapes. */
export const isVersionAtLeast = (version: string, minimum: string): boolean =>
  semver.gte(semver.coerce(version) ?? version, minimum);
