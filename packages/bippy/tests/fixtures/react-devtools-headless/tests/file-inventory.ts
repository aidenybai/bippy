import { readdirSync } from "node:fs";
import { join } from "node:path";

export const getFilesRecursively = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return getFilesRecursively(path);
    return entry.isFile() ? [path] : [];
  });
