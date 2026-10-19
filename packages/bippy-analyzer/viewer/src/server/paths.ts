import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const PACKAGE_NAME = "bippy-analyzer";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const readPackageName = (directory: string): string | null => {
  const file = join(directory, "package.json");
  if (!existsSync(file)) return null;
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  return isRecord(parsed) && typeof parsed.name === "string" ? parsed.name : null;
};

const findPackageRoot = (): string => {
  let directory = process.cwd();
  while (readPackageName(directory) !== PACKAGE_NAME) {
    const parent = dirname(directory);
    if (parent === directory) throw new Error(`Run the viewer from inside ${PACKAGE_NAME}`);
    directory = parent;
  }
  return directory;
};

export const packageRoot = findPackageRoot();
export const viewerRoot = resolve(packageRoot, "viewer");
export const fixturesDirectory = resolve(packageRoot, "tests/fixtures");
export const scratchDirectory = resolve(viewerRoot, "scratch");
