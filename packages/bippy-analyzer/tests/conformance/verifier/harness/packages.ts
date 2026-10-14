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

const isDeclared = (appDirectory: string, packageName: string): boolean => {
  const manifestPath = join(appDirectory, "package.json");
  if (!existsSync(manifestPath)) return true;
  const manifest: PackageManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  return [manifest.dependencies, manifest.devDependencies, manifest.peerDependencies].some(
    (dependencies) => dependencies !== undefined && packageName in dependencies,
  );
};

const findUpwards = (
  startDirectory: string,
  isMatch: (directory: string) => boolean,
): string | null => {
  for (let directory = startDirectory; ; directory = dirname(directory)) {
    if (isMatch(directory)) return directory;
    if (dirname(directory) === directory) return null;
  }
};

const findInstalledDirectory = (appDirectory: string, packageName: string): string | null => {
  const installingDirectory = findUpwards(appDirectory, (directory) =>
    existsSync(join(directory, "node_modules", packageName, "package.json")),
  );
  return installingDirectory && join(installingDirectory, "node_modules", packageName);
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

export const hasPackageDirectory = (startDirectory: string, packageName: string): boolean =>
  findUpwards(startDirectory, (directory) =>
    existsSync(join(directory, "node_modules", packageName)),
  ) !== null;
