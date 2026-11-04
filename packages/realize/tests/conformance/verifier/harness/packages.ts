import { existsSync, readFileSync, realpathSync } from "node:fs";
import { createRequire, findPackageJSON } from "node:module";
import { dirname, join } from "node:path";

interface PackageManifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

export const SOURCE_FILE_PATTERN = /\.[cm]?[jt]sx?$/;
export const IMAGE_FILE_PATTERN = /\.(?:png|jpe?g|gif|webp|avif|svg|ico)$/;
export const PACKAGE_SPECIFIER_PATTERN = /^[^./\0]/;
export const PATH_SPECIFIER_PATTERN = /^\.{0,2}\//;

export const stripQuery = (id: string): string => id.split("?")[0] ?? id;

export const isAppSourceModule = (id: string): boolean =>
  !id.includes("/node_modules/") && SOURCE_FILE_PATTERN.test(stripQuery(id));

export const getPackageName = (specifier: string): string =>
  specifier
    .split("/")
    .slice(0, specifier.startsWith("@") ? 2 : 1)
    .join("/");

export const isRequirable = (specifier: string, importer: string): boolean => {
  try {
    createRequire(importer).resolve(specifier);
    return true;
  } catch {
    return false;
  }
};

export const isDependencyDeclared = (appDirectory: string, packageName: string): boolean => {
  const manifestPath = join(appDirectory, "package.json");
  if (!existsSync(manifestPath)) return false;
  const manifest: PackageManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  return [manifest.dependencies, manifest.devDependencies, manifest.peerDependencies].some(
    (dependencies) => dependencies !== undefined && packageName in dependencies,
  );
};

const isDeclared = (appDirectory: string, packageName: string): boolean =>
  !existsSync(join(appDirectory, "package.json")) ||
  isDependencyDeclared(appDirectory, packageName);

export const findPackageDirectory = (packageName: string, importer: string): string | null => {
  try {
    const manifestPath = findPackageJSON(packageName, importer);
    return manifestPath ? realpathSync(dirname(manifestPath)) : null;
  } catch {
    return null;
  }
};

export const resolvePackageDirectory = (
  appDirectory: string,
  packageName: string,
): string | null =>
  isDeclared(appDirectory, packageName)
    ? findPackageDirectory(packageName, join(appDirectory, "package.json"))
    : null;

export const isInstalled = (appDirectory: string, packageName: string): boolean =>
  resolvePackageDirectory(appDirectory, packageName) !== null;
