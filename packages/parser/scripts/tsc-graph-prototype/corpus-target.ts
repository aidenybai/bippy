import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type CorpusEntry, readCorpusManifest } from "../../src/corpus/manifest.js";

export interface CorpusTarget {
  entry: CorpusEntry;
  cloneDirectory: string;
  rootDirectory: string;
  tsconfigPath: string;
  entryFile: string;
}

export const PACKAGE_DIRECTORY = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

const NEXT_APP_ENTRY_CANDIDATES = [
  "app/page.tsx",
  "src/app/page.tsx",
  "app/layout.tsx",
  "src/app/layout.tsx",
];

const findEntryFile = (entry: CorpusEntry, rootDirectory: string): string => {
  if (entry.static.entry) return path.resolve(rootDirectory, entry.static.entry);
  const appDirectory = entry.static.appDirectory
    ? path.resolve(rootDirectory, entry.static.appDirectory)
    : rootDirectory;
  for (const candidate of NEXT_APP_ENTRY_CANDIDATES) {
    const filePath = path.join(appDirectory, candidate);
    if (existsSync(filePath)) return filePath;
  }
  throw new Error(`${entry.id}: cannot find an entry file under ${rootDirectory}`);
};

export const loadCorpusTargets = (corpusDirectory: string, ids: string[]): CorpusTarget[] => {
  const manifest = readCorpusManifest(path.join(PACKAGE_DIRECTORY, "corpus/manifest.json"));
  return ids.map((id) => {
    const entry = manifest.entries.find((candidate) => candidate.id === id);
    if (!entry) throw new Error(`unknown corpus entry "${id}"`);
    const cloneDirectory = path.join(corpusDirectory, entry.id);
    if (!existsSync(cloneDirectory)) {
      throw new Error(
        `${cloneDirectory} is missing; clone it with: pnpm --filter @bippy/parser corpus -- --static-only --corpus-dir ${corpusDirectory} ${id}`,
      );
    }
    const rootDirectory = path.join(cloneDirectory, entry.static.rootDirectory);
    return {
      entry,
      cloneDirectory,
      rootDirectory,
      tsconfigPath: path.join(rootDirectory, entry.static.tsconfig ?? "tsconfig.json"),
      entryFile: findEntryFile(entry, rootDirectory),
    };
  });
};

export const formatMs = (milliseconds: number): string =>
  milliseconds >= 1000 ? `${(milliseconds / 1000).toFixed(1)}s` : `${Math.round(milliseconds)}ms`;

export const formatMb = (megabytes: number): string => `${Math.round(megabytes)}MB`;
