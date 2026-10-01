import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { EngineBuildError } from "./errors.js";

export const getHash = (content: string | Uint8Array): string =>
  createHash("sha256").update(content).digest("hex");

export const getFileHashes = async (
  directory: string,
  prefix = "",
): Promise<Record<string, string>> => {
  const files: Record<string, string> = Object.create(null);
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((left, right) =>
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
  )) {
    const filename = join(directory, entry.name);
    const name = prefix + entry.name;
    if (entry.isDirectory()) Object.assign(files, await getFileHashes(filename, `${name}/`));
    else if (entry.isFile()) files[name] = getHash(await readFile(filename));
    else throw new EngineBuildError(`Non-regular engine input or output: ${filename}`);
  }
  return files;
};

export const getTreeHash = (files: Record<string, string>): string =>
  getHash(
    JSON.stringify(
      Object.entries(files).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)),
    ),
  );
