import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
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

export const isAppSourceModule = (id: string): boolean =>
  !id.includes("/node_modules/") && SOURCE_FILE_PATTERN.test(id.split("?")[0] ?? id);

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

// HACK: resolving isn't enough, as Node searches every enclosing `node_modules`, where a monorepo
// installs other apps' packages.
const isDeclared = (appDirectory: string, packageName: string): boolean => {
  const manifestPath = join(appDirectory, "package.json");
  if (!existsSync(manifestPath)) return true;
  const manifest: PackageManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  return [manifest.dependencies, manifest.devDependencies, manifest.peerDependencies].some(
    (dependencies) => dependencies !== undefined && packageName in dependencies,
  );
};

// HACK: found by name, since a package's `exports` may not include its `package.json`.
const findInstalledDirectory = (appDirectory: string, packageName: string): string | null => {
  for (let directory = appDirectory; ; directory = dirname(directory)) {
    const packageDirectory = join(directory, "node_modules", packageName);
    if (existsSync(join(packageDirectory, "package.json"))) return packageDirectory;
    if (dirname(directory) === directory) return null;
  }
};

export const resolvePackageDirectory = (
  appDirectory: string,
  packageName: string,
): string | null => {
  if (!isDeclared(appDirectory, packageName)) return null;
  try {
    return dirname(
      createRequire(join(appDirectory, "package.json")).resolve(`${packageName}/package.json`),
    );
  } catch {
    return findInstalledDirectory(appDirectory, packageName);
  }
};

export const isInstalled = (appDirectory: string, packageName: string): boolean =>
  resolvePackageDirectory(appDirectory, packageName) !== null;

export const hasPackageDirectory = (directory: string, packageName: string): boolean =>
  existsSync(join(directory, "node_modules", packageName)) ||
  (dirname(directory) !== directory && hasPackageDirectory(dirname(directory), packageName));
