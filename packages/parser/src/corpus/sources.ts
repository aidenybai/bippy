import { type Dirent, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { isSourceFilePath } from "../module/parse.js";

const SKIPPED_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  ".next",
  ".turbo",
  ".cache",
  ".vercel",
  "dist",
  "build",
  "out",
  "coverage",
  "storybook-static",
  "__tests__",
  "__mocks__",
  "__snapshots__",
  "__fixtures__",
]);

/** Generated, test and story modules are not the product's component tree. */
const SKIPPED_FILE_PATTERN = /\.(test|spec|stories|story|d)\.[cm]?[jt]sx?$|\.d\.ts$/;

/**
 * Source modules under `directory`, sorted, as paths relative to
 * `rootDirectory`. Test and build output directories are skipped.
 */
export const listSourceFiles = (rootDirectory: string, directory: string): string[] => {
  const files: string[] = [];
  const visit = (currentDirectory: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(currentDirectory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const entryPath = join(currentDirectory, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) visit(entryPath);
      } else if (
        entry.isFile() &&
        isSourceFilePath(entry.name) &&
        !SKIPPED_FILE_PATTERN.test(entry.name)
      ) {
        files.push(relative(rootDirectory, entryPath));
      }
    }
  };
  visit(join(rootDirectory, directory));
  return files.sort();
};
