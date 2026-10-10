import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface RepoConfig {
  id: string;
  repository: string;
  revision: string;
  workingDirectory: string;
  tsconfig: string;
  install: string;
  patchFile: string | undefined;
}

interface RepoFile {
  repository: string;
  revision: string;
  workingDirectory: string;
  tsconfig: string;
  install: string;
}

export const CONFORMANCE_DIRECTORY = join(import.meta.dirname, "..");
export const PACKAGE_DIRECTORY = join(CONFORMANCE_DIRECTORY, "..");
export const CACHE_DIRECTORY = join(PACKAGE_DIRECTORY, ".conformance");
const REPOS_DIRECTORY = join(CONFORMANCE_DIRECTORY, "repos");

export const loadRepos = (ids: string[]): RepoConfig[] => {
  const allIds = readdirSync(REPOS_DIRECTORY).filter((id) =>
    existsSync(join(REPOS_DIRECTORY, id, "repo.json")),
  );
  const unknownIds = ids.filter((id) => !allIds.includes(id));
  if (unknownIds.length > 0) throw new Error(`Unknown repos: ${unknownIds.join(", ")}`);
  return (ids.length > 0 ? ids : allIds).map((id) => {
    const repoFile: RepoFile = JSON.parse(
      readFileSync(join(REPOS_DIRECTORY, id, "repo.json"), "utf8"),
    );
    const patchFile = join(REPOS_DIRECTORY, id, "custom.patch");
    return { id, ...repoFile, patchFile: existsSync(patchFile) ? patchFile : undefined };
  });
};

export const getSetupInputs = (repo: RepoConfig): string[] => [
  repo.revision,
  repo.install,
  repo.patchFile ? readFileSync(repo.patchFile, "utf8") : "",
];
