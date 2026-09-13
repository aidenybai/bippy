import { existsSync } from "node:fs";
import path from "node:path";

const INSTALL_ROOT_MARKERS = [
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  "pnpm-workspace.yaml",
  ".git",
];

const installRoots = new Map<string, string | null>();

/**
 * The directory whose package manager installed the project at `directory`:
 * the nearest ancestor holding a lockfile, or the repository itself. Node
 * resolution keeps walking above it, so a package found only there belongs to
 * whatever contains the checkout, not to the project.
 */
export const findInstallRoot = (directory: string): string | null => {
  const cached = installRoots.get(directory);
  if (cached !== undefined) return cached;
  let installRoot: string | null = null;
  for (let current = directory; ; current = path.dirname(current)) {
    if (INSTALL_ROOT_MARKERS.some((marker) => existsSync(path.join(current, marker)))) {
      installRoot = current;
      break;
    }
    if (path.dirname(current) === current) break;
  }
  installRoots.set(directory, installRoot);
  return installRoot;
};

export const isInstalledFor = (directory: string, filePath: string): boolean => {
  const installRoot = findInstallRoot(directory);
  if (installRoot === null) return true;
  const relative = path.relative(installRoot, filePath);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`);
};
