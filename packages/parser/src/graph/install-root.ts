import { existsSync } from "node:fs";
import path from "node:path";

const LOCKFILE_MARKERS = [
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  "pnpm-workspace.yaml",
];

const hasMarker = (directory: string, markers: readonly string[]): boolean =>
  markers.some((marker) => existsSync(path.join(directory, marker)));

const installRoots = new Map<string, string | null>();

/**
 * The directory whose package manager installed the project at `directory`:
 * the outermost ancestor inside the repository holding a lockfile (a workspace
 * member may check in a stale lockfile of its own), or the repository itself.
 * Node resolution keeps walking above it, so a package found only there
 * belongs to whatever contains the checkout, not to the project.
 */
export const findInstallRoot = (directory: string): string | null => {
  const cached = installRoots.get(directory);
  if (cached !== undefined) return cached;
  let installRoot: string | null = null;
  for (let current = directory; ; current = path.dirname(current)) {
    if (hasMarker(current, LOCKFILE_MARKERS)) installRoot = current;
    if (hasMarker(current, [".git"])) {
      installRoot ??= current;
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
