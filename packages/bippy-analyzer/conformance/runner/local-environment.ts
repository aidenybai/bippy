import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { collect } from "./collect.js";
import type { CollectSummary } from "./collect.js";
import { CACHE_DIRECTORY, CONFORMANCE_DIRECTORY, getSetupInputs } from "./repos.js";
import type { RepoConfig } from "./repos.js";

const SETUP_OUTPUT_BUFFER_BYTES = 64 * 1024 * 1024;
const SETUP_ERROR_TAIL_LENGTH = 4000;

const getSetupKey = (repo: RepoConfig): string => JSON.stringify(getSetupInputs(repo));

const prepare = (repo: RepoConfig, log: (line: string) => void): string => {
  const appDirectory = join(CACHE_DIRECTORY, repo.id);
  const markerFile = join(CACHE_DIRECTORY, `${repo.id}.ready`);
  if (existsSync(markerFile) && readFileSync(markerFile, "utf8") === getSetupKey(repo))
    return appDirectory;
  mkdirSync(CACHE_DIRECTORY, { recursive: true });
  log(`setting up ${repo.id}@${repo.revision.slice(0, 12)}`);
  const result = spawnSync("bash", [join(CONFORMANCE_DIRECTORY, "setup.sh")], {
    env: {
      ...process.env,
      REPOSITORY: repo.repository,
      REVISION: repo.revision,
      APP_DIR: appDirectory,
      INSTALL: repo.install,
      PATCH_FILE: repo.patchFile ?? "",
    },
    encoding: "utf8",
    maxBuffer: SETUP_OUTPUT_BUFFER_BYTES,
  });
  if (result.status !== 0)
    throw new Error(
      `setup failed for ${repo.id}:\n${result.stderr.slice(-SETUP_ERROR_TAIL_LENGTH)}`,
    );
  writeFileSync(markerFile, getSetupKey(repo));
  return appDirectory;
};

export const runLocal = async (
  repo: RepoConfig,
  outputDirectory: string,
  shouldVerify: boolean,
  log: (line: string) => void,
): Promise<CollectSummary> => {
  const appDirectory = prepare(repo, log);
  return collect(
    join(appDirectory, repo.workingDirectory, repo.tsconfig),
    outputDirectory,
    shouldVerify,
  );
};
