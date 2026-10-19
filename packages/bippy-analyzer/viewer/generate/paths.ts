import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";

const PACKAGE_NAME = "bippy-analyzer";

const packageSchema = z.object({ name: z.string() });

const readPackageName = (directory: string): string | null => {
  const file = join(directory, "package.json");
  if (!existsSync(file)) return null;
  const parsed = packageSchema.safeParse(JSON.parse(readFileSync(file, "utf8")));
  return parsed.success ? parsed.data.name : null;
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
