import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

export interface RepoConfig {
  id: string;
  repository: string;
  revision: string;
  workingDirectory: string;
  tsconfig: string;
  install: string;
  patchFile: string | null;
  setupDirectory: string | null;
}

const REPO_FILE_SCHEMA = z.object({
  repository: z.string(),
  revision: z.string(),
  workingDirectory: z.string(),
  tsconfig: z.string(),
  install: z.string(),
});

export const CONFORMANCE_DIRECTORY = join(import.meta.dirname, "..");
export const PACKAGE_DIRECTORY = join(CONFORMANCE_DIRECTORY, "../..");
export const CACHE_DIRECTORY = join(PACKAGE_DIRECTORY, ".conformance");
const REPOS_DIRECTORY = join(CONFORMANCE_DIRECTORY, "repos");

export const loadRepos = (ids: string[]): RepoConfig[] => {
  const allIds = readdirSync(REPOS_DIRECTORY).filter((id) =>
    existsSync(join(REPOS_DIRECTORY, id, "repo.json")),
  );
  const unknownIds = ids.filter((id) => !allIds.includes(id));
  if (unknownIds.length > 0) throw new Error(`Unknown repos: ${unknownIds.join(", ")}`);
  return (ids.length > 0 ? ids : allIds).map((id) => {
    const repoFile = REPO_FILE_SCHEMA.parse(
      JSON.parse(readFileSync(join(REPOS_DIRECTORY, id, "repo.json"), "utf8")),
    );
    const patchFile = join(REPOS_DIRECTORY, id, "custom.patch");
    const setupDirectory = join(REPOS_DIRECTORY, id, "verify");
    return {
      id,
      ...repoFile,
      patchFile: existsSync(patchFile) ? patchFile : null,
      setupDirectory: existsSync(setupDirectory) ? setupDirectory : null,
    };
  });
};

export const getSetupInputs = (repo: RepoConfig): string[] => [
  repo.revision,
  repo.install,
  repo.patchFile ? readFileSync(repo.patchFile, "utf8") : "",
  readFileSync(join(CONFORMANCE_DIRECTORY, "setup.sh"), "utf8"),
];

export const getSetupEnvironment = (
  repo: RepoConfig,
  appDirectory: string,
  patchFile: string,
): Record<string, string> => ({
  REPOSITORY: repo.repository,
  REVISION: repo.revision,
  APP_DIR: appDirectory,
  INSTALL: repo.install,
  PATCH_FILE: repo.patchFile ? patchFile : "",
});
