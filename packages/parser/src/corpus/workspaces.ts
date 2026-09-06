import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { dirname, join } from "node:path";

export interface WorkspacePackage {
  name: string;
  /** Absolute package directory. */
  directory: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readJson = (filePath: string): unknown => {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return undefined;
  }
};

const toStringList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

/**
 * The `packages` list of `pnpm-workspace.yaml`. Workspace files only ever
 * use a flat list of quoted or bare strings under that key, so a line reader
 * covers them without a YAML dependency.
 */
const readPnpmWorkspaceGlobs = (rootDirectory: string): string[] => {
  const filePath = join(rootDirectory, "pnpm-workspace.yaml");
  if (!existsSync(filePath)) return [];
  const globs: string[] = [];
  let isInPackages = false;
  for (const line of readFileSync(filePath, "utf8").split("\n")) {
    if (/^packages\s*:/.test(line)) {
      isInPackages = true;
      continue;
    }
    if (isInPackages) {
      const item = /^\s+-\s*(.+?)\s*$/.exec(line);
      if (item) globs.push(item[1].replace(/^["']|["']$/g, ""));
      else if (/^\S/.test(line)) isInPackages = false;
    }
  }
  return globs;
};

/** `workspaces` of the root package.json, in its array or `{ packages }` form. */
const readPackageWorkspaceGlobs = (rootDirectory: string): string[] => {
  const manifest = readJson(join(rootDirectory, "package.json"));
  if (!isRecord(manifest)) return [];
  const { workspaces } = manifest;
  return toStringList(isRecord(workspaces) ? workspaces.packages : workspaces);
};

const listSubdirectories = (directory: string): string[] => {
  try {
    return readdirSync(directory, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules",
      )
      .map((entry) => join(directory, entry.name));
  } catch {
    return [];
  }
};

const listSubdirectoriesDeep = (directory: string): string[] =>
  listSubdirectories(directory).flatMap((child) => [child, ...listSubdirectoriesDeep(child)]);

const toSegmentPattern = (segment: string): RegExp =>
  new RegExp(`^${segment.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*")}$`);

/** Directories matching a workspace glob such as `packages/*`, `apps/**` or `packages/twenty-*`. */
const expandWorkspaceGlob = (rootDirectory: string, glob: string): string[] => {
  let directories = [rootDirectory];
  for (const segment of glob.replace(/^\.\//, "").split("/").filter(Boolean)) {
    if (segment === "**") {
      directories = directories.flatMap((directory) => [
        directory,
        ...listSubdirectoriesDeep(directory),
      ]);
    } else if (segment.includes("*")) {
      const pattern = toSegmentPattern(segment);
      directories = directories.flatMap((directory) =>
        listSubdirectories(directory).filter((child) =>
          pattern.test(child.slice(directory.length + 1)),
        ),
      );
    } else {
      directories = directories.map((directory) => join(directory, segment));
    }
  }
  return [...new Set(directories)].filter((directory) =>
    existsSync(join(directory, "package.json")),
  );
};

/**
 * Packages declared by the root's pnpm, yarn or npm workspace configuration.
 * The first package to claim a name wins, as it does for package managers.
 */
export const findWorkspacePackages = (rootDirectory: string): WorkspacePackage[] => {
  const globs = [
    ...readPnpmWorkspaceGlobs(rootDirectory),
    ...readPackageWorkspaceGlobs(rootDirectory),
  ];
  const excluded = new Set(
    globs
      .filter((glob) => glob.startsWith("!"))
      .flatMap((glob) => expandWorkspaceGlob(rootDirectory, glob.slice(1))),
  );
  const packages = new Map<string, WorkspacePackage>();
  for (const glob of globs) {
    if (glob.startsWith("!")) continue;
    for (const directory of expandWorkspaceGlob(rootDirectory, glob)) {
      if (excluded.has(directory)) continue;
      const manifest = readJson(join(directory, "package.json"));
      if (!isRecord(manifest) || typeof manifest.name !== "string") continue;
      if (!packages.has(manifest.name))
        packages.set(manifest.name, { name: manifest.name, directory });
    }
  }
  return [...packages.values()];
};

/**
 * Symlinks every workspace package under `<linksDirectory>/node_modules`,
 * which is what installing the workspace would have created inside the
 * checkout. Kept outside the checkout so it never collides with a real
 * install. Returns the `node_modules` directory, or `null` when the root
 * declares no workspace.
 */
export const linkWorkspacePackages = (
  rootDirectory: string,
  linksDirectory: string,
): string | null => {
  const packages = findWorkspacePackages(rootDirectory);
  if (packages.length === 0) return null;
  const modulesDirectory = join(linksDirectory, "node_modules");
  for (const workspacePackage of packages) {
    const linkPath = join(modulesDirectory, workspacePackage.name);
    mkdirSync(dirname(linkPath), { recursive: true });
    rmSync(linkPath, { force: true });
    symlinkSync(workspacePackage.directory, linkPath, "dir");
  }
  return modulesDirectory;
};
