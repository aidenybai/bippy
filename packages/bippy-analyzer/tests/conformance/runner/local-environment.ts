import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { collect } from "./collect";
import type { CollectSummary } from "./collect";
import {
  CACHE_DIRECTORY,
  CONFORMANCE_DIRECTORY,
  getSetupEnvironment,
  getSetupInputs,
} from "./repos";
import type { LineLogger, RepoConfig } from "./repos";

const SETUP_OUTPUT_BUFFER_BYTES = 64 * 1024 * 1024;
const SETUP_ERROR_TAIL_LENGTH = 4000;

const getLocalSetupKey = (repo: RepoConfig): string => JSON.stringify(getSetupInputs(repo));

const prepare = (repo: RepoConfig, log: LineLogger): string => {
  const appDirectory = join(CACHE_DIRECTORY, repo.id);
  const markerFile = join(CACHE_DIRECTORY, `${repo.id}.ready`);
  if (existsSync(markerFile) && readFileSync(markerFile, "utf8") === getLocalSetupKey(repo))
    return appDirectory;
  mkdirSync(CACHE_DIRECTORY, { recursive: true });
  log(`setting up ${repo.id}@${repo.revision.slice(0, 12)}`);
  const result = spawnSync("bash", [join(CONFORMANCE_DIRECTORY, "setup.sh")], {
    env: { ...process.env, ...getSetupEnvironment(repo, appDirectory, repo.patchFile) },
    encoding: "utf8",
    maxBuffer: SETUP_OUTPUT_BUFFER_BYTES,
  });
  if (result.status !== 0)
    throw new Error(
      `setup failed for ${repo.id}:\n${result.stderr.slice(-SETUP_ERROR_TAIL_LENGTH)}`,
    );
  writeFileSync(markerFile, getLocalSetupKey(repo));
  return appDirectory;
};

export const runLocal = async (
  repo: RepoConfig,
  outputDirectory: string,
  shouldVerify: boolean,
  log: LineLogger,
): Promise<CollectSummary> => {
  const appDirectory = prepare(repo, log);
  return collect(
    join(appDirectory, repo.workingDirectory, repo.tsconfig),
    outputDirectory,
    shouldVerify,
    repo.setupDirectory,
  );
};
